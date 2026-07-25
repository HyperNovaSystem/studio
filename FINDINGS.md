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

## 2026-07-25 — Entity Types panel can show stale component fields for a just-edited custom type

M3's Entity Types panel (`src/panels/entityTypes.ts`) builds its component
picklist and per-field default editors from `catalog.registeredTypes()`,
because unlike the Component Types panel it needs built-in guest components
too (`GuestTransform`, `GuestSprite`, ...), which are never stored in
`session.doc.componentTypes`. `registeredTypes()` reflects the *live* guest
world, and per an existing engine limitation
(`../domecs/doc/FINDINGS_studio.md`, "re-registering an existing
component-type name does not update its live shape"), editing a custom
component type's field shape in the same session does not update its live
registration until the world is rebuilt from scratch. Net effect: after
renaming/retyping/adding a field on a custom component type via the
Component Types panel, the Entity Types panel's picker/defaults for that
*same* type name can still show the old field list until a reload (Open, or
an app restart) rebuilds the world.

The Component Types panel itself is unaffected — it deliberately reads
`session.doc.componentTypes` (the persisted source of record) rather than
`registeredTypes()`, specifically to avoid this staleness for its own
listing; see the doc comment in `src/panels/componentTypes.ts`. Fixing the
Entity Types panel's symptom requires the engine-side fix noted in the
linked finding, so it is not solved app-side here.

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

## 2026-07-25 — WorldTransform is unpopulated until the guest world's first tick

M5 wired `@domecs/scene`'s `composeTransforms(GuestTransform, WorldTransform,
...)` onto `guestWorld` and switched the stage view (`src/ui.ts`) to render
from `WorldTransform` — the composed, parent-aware value — instead of
`GuestTransform`. `composeTransforms` registers its resolver as a
`'tick'`-schedule system (see the linked engine finding), so a guest entity
carries no `WorldTransform` at all until `guestWorld` has actually ticked at
least once since that entity was spawned/restored. `createDomecsStudio()`
never ticks the guest world on its own (only user-driven Step/Play do), so
right after construction or a project Open/reload, every entity's
`WorldTransform` is missing.

Rendering nothing for that gap would be a real regression (today's demo
scene — and any freshly loaded project — paints its sprites immediately, no
tick required). Worked around in `src/ui.ts`'s stage rendering with a
fallback: `getComponent(id, WorldTransform) ?? getComponent(id, GuestTransform)`.
This is exactly correct for a root entity (composeTransforms' own `compose()`
reduces to the local value when `parentWorld` is `null`, tick or not) and
only briefly approximate for an already-parented entity (renders at its
local offset, ignoring the parent's contribution, until the next tick
self-heals it) — a narrower gap than "blank viewport," and one inherent to
any tick-schedule-derived value. See
`../domecs/doc/FINDINGS_studio.md` ("composeTransforms only populates
`World_` on a tick — no way to prime it without advancing `world.time.tick`")
for why this wasn't fixed by priming the world once at construction instead.

## 2026-07-25 — Systems panel: no "create new system" affordance; reorder is per-action only

M7 reworked the Systems panel (`src/panels/systems.ts`) from a raw-JSON
textarea into a real form editor (name/schedule, query checkboxes over
`catalog.registeredTypes()`, action rows with live `parseExpression`-backed
syntax feedback on `when`/each action's `expr`, add/remove/reorder-by-row
action controls) — but it only edits *existing* `doc.systems` entries. There
is still no button to create a brand-new system from the UI (the original
pre-M7 panel had none either — this is a pre-existing gap, not a regression,
just still open); the only way to add one today is `session.mutate` /
`projectSession.mutate` from code (or a hand-edited project file). Also,
"reorder" is scoped to an action row within one system (up/down, swapping
`actions[i]`/`actions[i±1]`) — there is no control to reorder the top-level
system list itself. Both are believed to be small, additive follow-ups
(mirror the Component/Entity Types panels' existing "add new X" form
pattern for the former; a second pair of up/down buttons on the system-row
header for the latter) rather than anything structurally blocked.

See `../domecs/doc/FINDINGS_studio.md` ("`RuleError` has no field-level tag,
so a per-field UI must re-derive attribution itself") for why this panel's
inline `when`/action error messages come from a local `parseExpression` +
hand-rolled `set`-shape check rather than from `compileRule`/
`RulesHandle.update()` directly — those two are still the authoritative,
aggregate source of truth, surfaced through the problems strip
(`src/panels/problems.ts`).
