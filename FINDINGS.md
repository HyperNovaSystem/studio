# Studio — Findings

App-level deficiencies and deliberate behavior changes in this repo. Engine
(`@domecs/*`) findings belong in the domecs repo's root `FINDINGS.md` ledger.

## 2026-07-25 — UI was unclickable: full innerHTML rewrite every frame

`main.ts` subscribed `render` to `editorWorld.signals.tickEnd` and then called
`startLoop()`. `render` reassigned `app.innerHTML` unconditionally, so the whole
shell was destroyed and rebuilt ~60×/s. The element under the pointer was
replaced between `mousedown` and `mouseup`, so the browser never fired a
`click` — every button and row was inert, with no console error. Focused
inputs also lost caret/selection immediately.

Fix: extracted the view into `src/ui.ts`. `renderStudioHtml(studio)` is a pure
string builder; `mountStudio(app, studio)` memoizes the last markup and skips
the DOM write when it is unchanged, and restores focus to the `[data-edit]` /
`[data-scrub]` control across a real rewrite. Pinned by `test/ui.test.ts`
(30 idle renders → 1 DOM write; a real state change → a second write).

Follow-up worth doing: even the guarded rewrite is a full innerHTML swap, so
mid-gesture clicks can still be lost while the guest is *playing* (sprites move
every tick). A keyed/targeted patch of just the `.stage` subtree would remove
the remaining window.

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
