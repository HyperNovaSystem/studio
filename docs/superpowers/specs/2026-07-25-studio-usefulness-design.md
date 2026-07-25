# DOMECS Studio — Usefulness Roadmap Design

**Date:** 2026-07-25
**Status:** Approved in brainstorm; umbrella spec for four phased sub-projects.
**Repos:** this repo (studio) and `../domecs` (engine — engine-first policy).

## Goal

Turn Studio from a fixed demo into a usable editor: project file I/O; CRUD for
component types, entity types, entities, components, and systems; a true
parent-child scene hierarchy; and an interactive WYSIWYG viewport.

## Decisions (fixed)

- **Authoring model: data-defined.** Component types are schema data fed to
  `defineComponent` at load. Systems are constrained data (query + expression
  actions) interpreted by the engine. No arbitrary user JS, no `eval`.
- **Project files: File System Access API.** Real `.json` files opened/saved
  via `showOpenFilePicker`/`showSaveFilePicker` with a retained handle for
  in-place save; localStorage autosave as crash backup; download/upload
  fallback where FSA is unavailable.
- **Hierarchy: parent-child scene graph.** `Parent` component, transform
  composition down the tree, drag-to-reparent, cascade delete.
- **WYSIWYG first cut: select + drag-move + spawn + delete.** Rotation/scale
  via inspector only. No camera/zoom, no gizmos, no marquee select.
- **Engine-first.** Engine capabilities land in `../domecs` packages and are
  consumed here; nothing engine-shaped is built app-side as a workaround.
- **Structure: four phased sub-projects**, each with its own implementation
  plan, in order. Each phase lands usable and tested before the next starts.

## Phase 1 — Project I/O + data model

### File format

Single `.domecs.json` document, versioned for `@domecs/persist` `migrate`:

```jsonc
{
  "format": "domecs-project", "version": 1,
  "meta": { "name": "...", "modified": "..." },
  "componentTypes": [
    { "name": "Health", "fields": [{ "name": "hp", "kind": "number", "default": 100 }] }
  ],
  "entityTypes": [
    { "name": "Goblin", "components": { "Health": { "hp": 30 }, "GuestTransform": {} } }
  ],
  "systems": [
    { "name": "decay", "schedule": "tick", "query": ["Health"],
      "actions": [{ "set": "Health.hp", "expr": "Health.hp - dt * 1" }] }
  ],
  "scenes": [
    { "name": "main", "entities": [
      { "id": 1, "type": "Goblin", "parent": null, "overrides": { "GuestTransform": { "x": 40 } } }
    ] }
  ]
}
```

- Built-in component types (GuestTransform, GuestSprite, …) are reserved
  names: always registered, never stored, cannot be shadowed by user types.
- Scene entities are prefab instances: `type` + `overrides` (+ `parent`,
  whose runtime semantics arrive in phase 2; the field exists from v1).
- `systems` entries exist in the format from v1; they run only after phase 3.
  Until then Studio lists them read-only (raw JSON editing allowed).
- Field kinds mirror the engine `FieldKind` set.

### Engine deliverable (`@domecs/persist`)

- `serializeComponentType(type) → schema data` and
  `registerComponentTypes(data) → ComponentType[]` (data → `defineComponent`).
- Project-file validation + `migrate` wiring for `domecs-project` documents.

### Studio architecture

- **`src/project.ts`** — in-memory `ProjectFile`, dirty flag,
  `newProject/openProject/saveProject/saveProjectAs`, behind a `ProjectStore`
  interface with `fileSystemStore` (FSA, retained handle) and
  `localStorageStore` (periodic autosave + restore-on-boot prompt) impls.
  Feature-detect FSA; fall back to download/upload.
- **`src/catalog.ts`** — the only path from file to world: registers
  componentTypes, builds the prefab registry from entityTypes (replacing the
  hardcoded `PREFABS` in `studio.ts`), instantiates the active scene into the
  guest world. Edits flow through catalog APIs, which mutate the in-memory
  project and mark it dirty. Reload = tear down guest world, rebuild.
- **CRUD panels** (extending the existing panel system + `ui.ts`):
  component types (add/rename/delete; add/remove/retype fields; delete-in-use
  warns with usage count and strips instances), entity types (create from
  component picklist, edit defaults, delete with instance-handling prompt),
  systems (list, enable toggle, raw JSON edit), scene entities (tree gains
  add-from-type, delete, duplicate).
- **Undo** — guest-world edits: existing snapshot history. Project-level
  edits (schemas, types): separate undo stack of project-file JSON snapshots.
- **Errors** — load-time validation reports per-item problems in a problems
  strip; never hard-fail the whole file. Unknown component names in scenes
  are preserved as raw data and flagged; user data is never dropped.
- **Testing** — `ProjectStore` injected; fakes only, vitest stays node-env.
  Round-trip test: build project → serialize → load → equivalent worlds.

## Phase 2 — Engine hierarchy (`@domecs/scene`)

New package `../domecs/packages/domecs-scene`, following the existing
satellite-package pattern:

- `Parent` component `{ entity: Entity | null }` via `defineComponent`, so it
  snapshots, persists, and time-travels through existing machinery.
- Function API over a world: `setParent` (rejects cycles — parent must not be
  a descendant of child), `childrenOf`, `ancestorsOf`, `rootsOf`. Backed by a
  cached child-index resource rebuilt from Parent change signals;
  `childrenOf` is O(children).
- `despawnTree` for cascade delete. Orphan policy: a plain `despawn` of a
  parent reparents children to root (`null`) — never a dangling dead id —
  enforced by a plugin-installed cleanup system.
- Transform-agnostic composition: `composeTransforms(Local, World, composeFn)`
  plugin factory installs a system that walks roots→leaves each tick writing
  world transforms. Studio supplies `GuestTransform` (local) and a new
  `WorldTransform` (computed); the DOM renders from `WorldTransform`.
- Scene-file `parent` maps directly onto the `Parent` component.
- Studio: tree panel renders real nesting (indent by depth); drag row onto
  row = `setParent`; drag to root strip = unparent; delete = `despawnTree`
  after confirm.
- Tests: cycle rejection, orphan policy, parent-before-child compose order,
  snapshot round-trip with hierarchy; studio-side tree render + reparent.

## Phase 3 — Data-defined systems runtime (`@domecs/rules`)

New package interpreting the `systems` entries of the project file:

- Definition: `{ name, schedule: 'tick'|'fixed', query: [componentNames],
  when?: expr, actions: [{ set: 'Comp.field', expr }] }`.
- Expression grammar (deliberately tiny): literals, `Comp.field` refs, `dt`,
  `time`, arithmetic `+ - * / %`, comparisons, `&& || !`, ternary, and a
  whitelisted function set (`min max clamp abs sin cos floor random`).
  Hand-rolled Pratt parser → AST at registration; interpreted per entity per
  tick. The capability ceiling is explicit and documented.
- API: `compileRule(def, resolveComponent)` returns errors-as-data (rule
  name, position, message) or a compiled rule; `installRules(world, defs,
  resolver)` registers each as a normal `world.system` with a `Has(...)`
  query, `when` guard, and `set` actions with `markChanged`. A rule that
  fails to compile is disabled and its error shown in the problems strip.
- Determinism: `random` routes through the world RNG so replay and time
  travel stay reproducible.
- Performance: interpreted AST is sufficient at exemplar scale;
  compile-to-closure is noted as future work, not built now.
- Studio: Systems panel becomes a real editor — name/schedule form, query
  checkbox list over known component types, action rows with a field picker
  and expression input with live parse feedback, enable toggle, reorder.
  Edits recompile immediately against the guest world.
- Tests: parser precedence/errors/positions, interpreter semantics, seeded
  determinism, install/uninstall on definition change, project round-trip.

## Phase 4 — WYSIWYG viewport

- **Prerequisite: keyed stage patching.** Replace the `.stage` innerHTML dump
  with per-entity keyed DOM patching (`entityId → element` map; in-place
  style updates) so nodes survive gestures. Evaluate `@domecs/dom` for this
  first; if unsuitable, hand-roll a small patcher and record the gap in
  `../domecs/doc/FINDINGS_studio.md`. This closes the known
  clicks-drop-during-playback deficiency.
- **Picking:** sprites carry `data-entity`; `pointerdown` resolves the entity
  via `closest('[data-entity]')`; empty-stage click deselects; selection
  outline + hover highlight (PlaybackState already tracks both).
- **Drag-move:** pointer capture; client delta → stage coordinates (single
  scale factor); writes the local `GuestTransform`, adjusted for the parent's
  world transform so children drag correctly under composition. `markChanged`
  per move; a history checkpoint only on pointerup — one undo step per drag.
- **Spawn:** palette lists entityTypes; drag onto stage spawns at the drop
  point via `catalog.spawnFromType(type, x, y)`; plain click spawns at stage
  center; the new entity is auto-selected.
- **Delete/duplicate:** `Delete` = `despawnTree` on the selection (confirm if
  it has children); `Ctrl+D` duplicates the subtree with an offset.
- **Edit-during-play is allowed** — live tweaking is the point; the drag
  writes each frame and systems see the moved value. No pause logic.
- Tests: coordinate math and the drag state machine are pure and unit-tested
  with faked pointer events; the patcher uses the fake-host pattern from
  `test/ui.test.ts`; spawn/delete via catalog tests.

## Cross-cutting

- **Order and gating:** phases run 1→4; each phase's engine work lands and is
  released/linked in `../domecs` before its studio work starts. A phase is
  done when its tests pass and the feature is usable in the running app.
- **Findings discipline:** engine gaps discovered mid-phase go to
  `../domecs/doc/FINDINGS_studio.md`; app deficiencies to `FINDINGS.md`.
- **TDD** throughout, per repo conventions.

## Out of scope (this roadmap)

Camera/zoom/pan, gizmo handles, marquee select, nested-prefab override
tracking, hierarchical state machines, user-written JS systems,
multi-scene simultaneous editing, collaboration.
