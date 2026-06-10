# Studio — Findings

App-level deficiencies and deliberate behavior changes in this repo. Engine
(`@domecs/*`) findings belong in the domecs repo's root `FINDINGS.md` ledger.

## 2026-06-10 — snapshot ring replaced by `createSnapshotHistory` (Reqall #2681 item #15)

Two deliberate semantic changes landed with the migration from the app-local
`SnapshotRingBuffer` to the engine's `createSnapshotHistory` (`@domecs/persist`):

1. **Linear undo: push-after-scrub truncates the redo branch.** The old ring
   kept appending after a `scrub(cursor)` back in time — the scrubbed-past
   entries stayed in the ring and new ticks were appended after them. The
   engine history has standard linear-history semantics: stepping the guest
   after scrubbing backwards drops every checkpoint after the cursor before
   appending the new one. Pinned by the time-travel test (`truncated.length`
   = 2 after scrub-to-0 + step).

2. **Diff-compaction byte-stats demo removed.** The ring stored per-entry
   diffs plus periodic base checkpoints and exposed `compactBytes` /
   `fullSnapshotBytes` / `memoryRatio()` to demonstrate diff compaction. The
   engine history stores full snapshots and has no byte stats, so
   `TimeTravelScrubber.compactBytes/fullSnapshotBytes`, the main.ts byte
   readout, and `StudioRefs.memoryRatio()` are gone. Replacements: checkpoint
   count/cursor (`history.length` / `history.index`, O(1), safe per frame) and
   on-demand changed-entity counts via the engine's `diffSnapshots` over
   adjacent `history.snapshots()` entries (`StudioRefs.timelineDiffs()`,
   compute-on-scrub only — `snapshots()` returns a defensive copy).
