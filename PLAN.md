# DOMECS Studio — Usefulness Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Before coding a milestone, expand it into a bite-sized TDD task plan (superpowers:writing-plans format, saved to `docs/superpowers/plans/`) and get owner approval. Steps use checkbox syntax for tracking.

**Goal:** Turn Studio into a usable editor: project file I/O, full CRUD (component types, entity types, entities, systems), parent-child scene hierarchy, WYSIWYG viewport.

**Architecture:** Data-defined authoring (schemas and rule-systems as JSON, no eval); engine capabilities land first in `../domecs` packages (`@domecs/persist` additions, new `@domecs/scene`, new `@domecs/rules`); Studio consumes them through `src/project.ts` (file I/O) and `src/catalog.ts` (file→world), extending the existing panel/`ui.ts` system.

**Tech Stack:** TypeScript, Vite, Vitest (node env, fakes — no jsdom), `@domecs/core|dom|persist`, File System Access API.

**Spec:** `docs/superpowers/specs/2026-07-25-studio-usefulness-design.md` — authoritative. Do not invent fields or APIs not in the spec.

## Ground Rules

1. Spec is authoritative; this plan sequences it. Conflicts → stop, ask owner.
2. Red/green TDD. A milestone is done only when `npm test` passes in every touched repo (`tsc --noEmit && vitest run`).
3. Commit per task; milestone commits prefixed `M<n>:`. Never commit failing tests.
4. Engine-first: a phase's engine milestone must be complete (and studio's `node_modules/@domecs/*` updated via workspace link or version bump) before its studio milestone starts.
5. Findings discipline: engine gaps → `../domecs/doc/FINDINGS_studio.md`; app deficiencies → `FINDINGS.md`. Record as you go, not at the end.
6. Never drop user data: unknown/invalid project-file content is preserved and flagged, never silently discarded.
7. Lean scope: anything under the spec's "Out of scope" heading is off-limits even if easy.
8. Before task work: pull Augment/Reqall context; after: upsert WORK/TODO records (repo convention).

## Global Constraints

- Project file: single JSON document, `format: "domecs-project"`, `version: 1`, top-level keys `meta, componentTypes, entityTypes, systems, scenes` (spec §Phase 1).
- Built-in component types are reserved names — always registered, never stored in the file, cannot be shadowed.
- Expression language: literals, `Comp.field`, `dt`, `time`, `+ - * / %`, comparisons, `&& || !`, ternary, fns `min max clamp abs sin cos floor random` — nothing else. No `eval`/`new Function` anywhere.
- `random` must route through the world RNG (determinism for time travel).
- Vitest stays `environment: 'node'`; browser APIs (FSA, DOM) always behind injected interfaces with fakes.
- History checkpoints: one per user gesture (e.g. per drag), not per frame.

---

## Phase 1 — Project I/O + data model

### M0: Engine — schema serialization + project document (`../domecs`, `@domecs/persist`)

**Files:** create `packages/domecs-persist/src/schema.ts`, `packages/domecs-persist/src/project.ts` + tests; modify `packages/domecs-persist/src/index.ts` (exports).

**Produces (binding interfaces):**
```ts
interface ComponentTypeData { name: string; fields: { name: string; kind: FieldKind; default?: unknown }[] }
function serializeComponentType(type: ComponentType<any>, descriptor: ComponentDescriptor): ComponentTypeData
function registerComponentTypes(data: ComponentTypeData[], reserved: ReadonlySet<string>): { types: ComponentType<any>[]; problems: SchemaProblem[] }
interface SchemaProblem { path: string; message: string }     // e.g. "componentTypes[2].fields[0].kind"
interface ComponentTypeData { name: string; transient?: boolean; fields: { name: string; kind: FieldKind; default?: unknown; min?: number; max?: number; step?: number; options?: (string|number)[]; label?: string; readonly?: boolean }[] }
```
`ComponentType`, `ComponentDescriptor`, `FieldKind`, `FieldSchema` are the real types from `@domecs/core` `src/types.ts` (already defined — do not redeclare). `registerComponentTypes` builds each `ComponentType` via `defineComponent(name, { schema: { fields }, defaults })`; a name colliding with `reserved` is a `SchemaProblem`, not a throw, and that entry is skipped (the rest still register). This is the ONLY engine deliverable for M0 — no "project document" concept (entityTypes/systems/scenes are Studio authoring concepts, not engine primitives; see M1).

**Acceptance:** `serializeComponentType` on a `defineComponent`d type with an explicit `schema` round-trips through `registerComponentTypes` to an equivalent, usable `ComponentType` (its `.create()` produces the same shape); reserved-name collision → `SchemaProblem`, not throw, other entries still register; unknown `FieldKind` value → `SchemaProblem` with a path, not throw; engine repo tests green (`pnpm --filter @domecs/persist test` from `../domecs`).

### M1: Studio — project document + state + stores (`src/project.ts`)

**Files:** create `src/project.ts`, `test/project.test.ts`.

The `.domecs.json` project-document format (`format/version/meta/componentTypes/entityTypes/systems/scenes` — spec §Phase 1) is a **Studio** concept, not an engine one: `entityTypes`/`systems`/`scenes` are editor/authoring ideas the engine has no notion of. Only `componentTypes` round-trips through M0's engine helpers.

**Produces:**
```ts
interface ProjectMeta { name: string; modified: string }
interface EntityTypeData { name: string; components: Record<string, Record<string, unknown>> }
interface SystemData { name: string; schedule: 'tick' | 'fixed'; enabled?: boolean; query: string[]; when?: string; actions: { set: string; expr: string }[] }
interface SceneData { name: string; entities: { id: number; type: string | null; parent: number | null; overrides: Record<string, Record<string, unknown>> }[] }
interface ProjectDocument { format: 'domecs-project'; version: 1; meta: ProjectMeta; componentTypes: ComponentTypeData[]; entityTypes: EntityTypeData[]; systems: SystemData[]; scenes: SceneData[] }
function validateProject(json: unknown): { doc: ProjectDocument | null; problems: SchemaProblem[] }   // never throws; salvages a best-effort doc alongside problems when the shape is close enough
function emptyProject(name: string): ProjectDocument

interface ProjectStore { open(): Promise<{ json: unknown; name: string } | null>; save(doc: ProjectDocument): Promise<boolean>; saveAs(doc: ProjectDocument): Promise<boolean>; autosave(doc: ProjectDocument): void; restore(): ProjectDocument | null }
function createProjectSession(store: ProjectStore): ProjectSession
interface ProjectSession { doc: ProjectDocument; dirty: boolean; problems: SchemaProblem[]; newProject(): void; open(): Promise<boolean>; save(): Promise<boolean>; saveAs(): Promise<boolean>; mutate(fn: (doc: ProjectDocument) => void): void; undo(): void; redo(): void }
```
`mutate` deep-clones-on-write into an undo stack (project-level undo per spec). Stores: `createMemoryProjectStore()` (tests), `createLocalStorageProjectStore(storage)` (autosave + restore), `createFileSystemProjectStore()` (FSA — feature-detected, retained handle, download/upload fallback; untested by unit tests, kept to thin glue).

**Acceptance:** `validateProject` on malformed input returns problems with precise paths and salvages valid items, never throws; session round-trip via memory store; dirty tracking; undo/redo across mutates; autosave debounce (fake timers); restore-on-boot path; studio tests green.

### M2: Studio — catalog: file → world (`src/catalog.ts`)

**Files:** create `src/catalog.ts`, `test/catalog.test.ts`; modify `src/studio.ts` (remove hardcoded `PREFABS`, accept catalog).

**Produces:**
```ts
function createCatalog(session: ProjectSession, guestWorld: World): Catalog
interface Catalog { reload(): SchemaProblem[]; spawnFromType(typeName: string, x: number, y: number): Entity | null; registeredTypes(): ComponentDescriptor[]; entityTypes(): EntityTypeData[]; upsertComponentType(data: ComponentTypeData): SchemaProblem[]; deleteComponentType(name: string): { usageCount: number } ; upsertEntityType(data: EntityTypeData): SchemaProblem[]; deleteEntityType(name: string, mode: 'strip' | 'despawn'): void; captureScene(name?: string): void }
```
`reload()` = tear down guest world entities, `registerComponentTypes` (reserved = built-ins), rebuild prefab registry, instantiate active scene (`type` defaults + `overrides`; unknown component names preserved in doc + returned as problems). All edits go through `session.mutate` (dirty + undo for free).

**Acceptance:** round-trip test — build doc → `reload` → `captureScene` → equivalent doc; spawn/delete honoring defaults+overrides; delete-in-use returns usage count and strips instances; unknown-component preservation verified; existing studio tests still green (prefab tests updated to seed via catalog).

### M3: Studio — I/O + CRUD UI

**Files:** modify `src/ui.ts` (or split panels into `src/panels/*.ts` if >~400 lines each), `src/main.ts`, `src/style.css`; tests via fake-host pattern in `test/ui.test.ts`.

**Deliverable:** toolbar (New/Open/Save/Save As, dirty marker, project name); problems strip rendering `session.problems`; Component Types panel (list/add/rename/delete, field add/remove/retype, delete-in-use confirm with usage count); Entity Types panel (create from component picklist, edit defaults, delete prompt strip-vs-despawn); Systems panel (list, enable toggle, raw JSON textarea with validate-on-blur); tree panel gains add-from-type / delete / duplicate.

**Acceptance:** every CRUD action reachable by rendered controls and covered by a fake-host interaction test; save→open round-trip through localStorage store works in-app; `npm test` green. **Phase-1 exit:** manual smoke — create type, create entityType, spawn, edit, save, reload page, restore.

---

## Phase 2 — Hierarchy

### M4: Engine — `@domecs/scene` (`../domecs/packages/domecs-scene`, new package)

**Produces:** `Parent` component `{ entity: Entity | null }`; `setParent(world, child, parent)` (cycle-reject), `childrenOf(world, entity)`, `ancestorsOf(world, entity)`, `rootsOf(world)`. Correction after reading the real `WorldSignals` (`@domecs/core` `world.ts`): there is no per-component "changed" signal, only `componentAdded`/`componentRemoved` — a signal-cached child index would miss in-place `Parent` mutations (`markChanged` without add/remove). Drop the cache: `childrenOf`/`ancestorsOf`/`rootsOf` compute directly off `world.iterEntitiesWith(Parent)` each call, same cheap-recompute style already used elsewhere in this codebase (e.g. `studio.ts`'s `resolveComponentType`) — fine at exemplar scale, no correctness risk from stale caching. `despawnTree(world, entity)`; orphan policy (despawned parent → children reparent to root/`null`) via a plugin-installed cleanup system (`Plugin`/`definePlugin` from `@domecs/core`, `install(world)` registers the systems, mirrors the pattern in `packages/domecs-dom`); `composeTransforms(Local, World, composeFn)` plugin factory walking roots→leaves per tick.

**Acceptance:** cycle rejection, orphan policy, parent-before-child compose order, snapshot round-trip with hierarchy (Parent is ordinary component data, so this should fall out of the existing snapshot machinery for free — verify, don't assume); engine tests green (`pnpm --filter @domecs/scene test` from `../domecs`). No publish step needed for dev — new package resolves via the same `main: ./src/index.ts` + pnpm-workspace symlink pattern M0 already confirmed works.

### M5: Studio — hierarchical tree + WorldTransform

**Files:** modify `src/components.ts` (add `WorldTransform`), `src/studio.ts` (install scene plugin + composeTransforms), tree panel, `src/catalog.ts` (scene `parent` ⇄ `Parent`).

**Acceptance:** tree renders nesting; drag row→row reparents (cycle attempt rejected with visible notice); drag-to-root unparents; delete = confirmed `despawnTree`; DOM renders from `WorldTransform`; project save/load preserves hierarchy; tests green.

---

## Phase 3 — Data-defined systems

### M6: Engine — `@domecs/rules` (`../domecs/packages/domecs-rules`, new package)

**Produces:** Pratt parser → AST for the constrained grammar (Global Constraints); `compileRule(def: SystemData, resolve: (name: string) => ComponentType<any> | null): { rule: CompiledRule | null; errors: RuleError[] }` with `RuleError { rule: string; position: number; message: string }`; `installRules(world, defs, resolve): RulesHandle` (`update(defs)`, `uninstall()`) registering each rule as a normal `world.system` (Has-query, `when` guard, `set` + `markChanged`); `random` via world RNG.

**Acceptance:** parser precedence/error-position tests; interpreter semantics (clamp, dt scaling); seeded determinism (two runs identical); update/uninstall swap without leaking systems; engine tests green.

### M7: Studio — systems editor

**Files:** Systems panel rework in ui/panels; `src/catalog.ts` gains `applySystems()` calling `installRules`/`update` on the guest world after every systems mutation.

**Acceptance:** form editor (name, schedule, query checkboxes over `registeredTypes()`, action rows with field picker + expr input, live parse feedback, enable toggle, reorder); a rule edit visibly changes running guest behavior next tick; compile errors shown inline + problems strip, rule stays disabled; round-trip through project file; tests green.

---

## Phase 4 — WYSIWYG viewport

### M8: Studio — keyed stage patcher

**Files:** create `src/stage.ts` + tests (fake-host pattern); modify `src/ui.ts` to delegate `.stage` to it.

**Produces:** `mountStage(host: HTMLElement, studio: StudioRefs): { patch(): void }` — `entityId → element` map; create/remove/update style props in place; sprites carry `data-entity`. Evaluate `@domecs/dom` first; if unsuitable, hand-roll and record why in `../domecs/doc/FINDINGS_studio.md`. Closes the FINDINGS follow-up on mid-play click loss.

**Acceptance:** patch of unchanged world touches zero nodes; moved entity updates style only (same element identity); add/remove reconciles; clicks land during playback; tests green.

### M9: Studio — pick / drag / spawn / delete

**Files:** create `src/gesture.ts` (pure drag state machine + coord math) + tests; wire pointer handlers in stage/ui; palette panel.

**Acceptance:** pointerdown selects (outline), empty-stage click deselects; pointer-captured drag writes local `GuestTransform` compensating parent `WorldTransform`, one history checkpoint per drag (pointerup); palette drag/click spawns via `catalog.spawnFromType` (auto-select); `Delete` = confirmed `despawnTree`, `Ctrl+D` duplicates subtree with offset; dragging while playing works; tests green. **Roadmap exit:** full manual smoke of spec Goal sentence.

---

## Milestone → task-plan expansion

Each milestone above is deliberately interface-level. The executing agent MUST, per milestone: (1) write a bite-sized task plan (failing test → run → implement → run → commit granularity, actual code in steps) to `docs/superpowers/plans/2026-MM-DD-m<n>-<name>.md`; (2) get owner approval; (3) execute with fresh-subagent-per-task or inline checkpoints. Interfaces in **Produces** blocks are binding — later milestones compile against them.
