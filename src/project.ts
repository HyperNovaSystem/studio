import type { ComponentFieldData, ComponentTypeData, SchemaProblem } from '@domecs/persist'

// -----------------------------------------------------------------------------
// Project document — a Studio-only concept. Unlike a WorldSnapshot (the
// engine's runtime state), a ProjectDocument is the *authoring* format: the
// whole editable project as JSON, including things the engine has no notion
// of (entityTypes/systems/scenes are Studio authoring concepts, not ECS
// primitives). Only componentTypes reuses an engine (@domecs/persist) shape.
// -----------------------------------------------------------------------------

export interface ProjectMeta {
  name: string
  modified: string
}

export interface EntityTypeData {
  name: string
  components: Record<string, Record<string, unknown>>
}

export interface SystemData {
  name: string
  schedule: 'tick' | 'fixed'
  enabled?: boolean
  query: string[]
  when?: string
  actions: { set: string; expr: string }[]
}

export interface SceneEntityData {
  id: number
  type: string | null
  parent: number | null
  overrides: Record<string, Record<string, unknown>>
}

export interface SceneData {
  name: string
  entities: SceneEntityData[]
}

export interface ProjectDocument {
  format: 'domecs-project'
  version: 1
  meta: ProjectMeta
  componentTypes: ComponentTypeData[]
  entityTypes: EntityTypeData[]
  systems: SystemData[]
  scenes: SceneData[]
}

const DEFAULT_PROJECT_NAME = 'untitled'

/** A brand-new, empty project: no component/entity/system authoring yet, one empty "main" scene. */
export function emptyProject(name: string): ProjectDocument {
  return {
    format: 'domecs-project',
    version: 1,
    meta: { name, modified: new Date().toISOString() },
    componentTypes: [],
    entityTypes: [],
    systems: [],
    scenes: [{ name: 'main', entities: [] }],
  }
}

// -----------------------------------------------------------------------------
// Validation — never throws. Structurally invalid entries within the four
// top-level arrays are dropped and reported (with a precise path) rather than
// failing the whole load; only a non-object payload or a wrong format/version
// is fatal (doc: null). meta is defaulted, not fatal, when missing/malformed.
// -----------------------------------------------------------------------------

type Validated<T> = { value: T } | { error: SchemaProblem }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateComponentFieldData(v: unknown, path: string): Validated<ComponentFieldData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.name !== 'string') return { error: { path: `${path}.name`, message: 'expected a string' } }
  if (typeof v.kind !== 'string') return { error: { path: `${path}.kind`, message: 'expected a string' } }

  const out: ComponentFieldData = { name: v.name, kind: v.kind as ComponentFieldData['kind'] }
  if (v.default !== undefined) out.default = v.default
  if (v.min !== undefined) {
    if (typeof v.min !== 'number') return { error: { path: `${path}.min`, message: 'expected a number' } }
    out.min = v.min
  }
  if (v.max !== undefined) {
    if (typeof v.max !== 'number') return { error: { path: `${path}.max`, message: 'expected a number' } }
    out.max = v.max
  }
  if (v.step !== undefined) {
    if (typeof v.step !== 'number') return { error: { path: `${path}.step`, message: 'expected a number' } }
    out.step = v.step
  }
  if (v.options !== undefined) {
    if (!Array.isArray(v.options) || !v.options.every((o) => typeof o === 'string' || typeof o === 'number')) {
      return { error: { path: `${path}.options`, message: 'expected an array of strings/numbers' } }
    }
    out.options = v.options.slice()
  }
  if (v.label !== undefined) {
    if (typeof v.label !== 'string') return { error: { path: `${path}.label`, message: 'expected a string' } }
    out.label = v.label
  }
  if (v.readonly !== undefined) {
    if (typeof v.readonly !== 'boolean') return { error: { path: `${path}.readonly`, message: 'expected a boolean' } }
    out.readonly = v.readonly
  }
  return { value: out }
}

function validateComponentTypeData(v: unknown, path: string): Validated<ComponentTypeData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.name !== 'string') return { error: { path: `${path}.name`, message: 'expected a string' } }
  if (!Array.isArray(v.fields)) return { error: { path: `${path}.fields`, message: 'expected an array' } }

  const fields: ComponentFieldData[] = []
  for (let j = 0; j < v.fields.length; j++) {
    const r = validateComponentFieldData(v.fields[j], `${path}.fields[${j}]`)
    if ('error' in r) return { error: r.error }
    fields.push(r.value)
  }
  if (v.transient !== undefined && typeof v.transient !== 'boolean') {
    return { error: { path: `${path}.transient`, message: 'expected a boolean' } }
  }

  const out: ComponentTypeData = { name: v.name, fields }
  if (v.transient !== undefined) out.transient = v.transient
  return { value: out }
}

function validateEntityTypeData(v: unknown, path: string): Validated<EntityTypeData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.name !== 'string') return { error: { path: `${path}.name`, message: 'expected a string' } }
  if (!isPlainObject(v.components)) return { error: { path: `${path}.components`, message: 'expected an object' } }
  for (const [key, val] of Object.entries(v.components)) {
    if (!isPlainObject(val)) return { error: { path: `${path}.components.${key}`, message: 'expected an object' } }
  }
  return { value: { name: v.name, components: v.components as Record<string, Record<string, unknown>> } }
}

function validateSystemData(v: unknown, path: string): Validated<SystemData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.name !== 'string') return { error: { path: `${path}.name`, message: 'expected a string' } }
  if (v.schedule !== 'tick' && v.schedule !== 'fixed') {
    return { error: { path: `${path}.schedule`, message: 'expected "tick" or "fixed"' } }
  }
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') {
    return { error: { path: `${path}.enabled`, message: 'expected a boolean' } }
  }
  if (!Array.isArray(v.query) || !v.query.every((q) => typeof q === 'string')) {
    return { error: { path: `${path}.query`, message: 'expected an array of strings' } }
  }
  if (v.when !== undefined && typeof v.when !== 'string') {
    return { error: { path: `${path}.when`, message: 'expected a string' } }
  }
  if (!Array.isArray(v.actions)) return { error: { path: `${path}.actions`, message: 'expected an array' } }

  const actions: { set: string; expr: string }[] = []
  for (let j = 0; j < v.actions.length; j++) {
    const a = v.actions[j]
    if (!isPlainObject(a) || typeof a.set !== 'string') {
      return { error: { path: `${path}.actions[${j}].set`, message: 'expected a string' } }
    }
    if (typeof a.expr !== 'string') {
      return { error: { path: `${path}.actions[${j}].expr`, message: 'expected a string' } }
    }
    actions.push({ set: a.set, expr: a.expr })
  }

  const out: SystemData = { name: v.name, schedule: v.schedule, query: v.query.slice(), actions }
  if (v.enabled !== undefined) out.enabled = v.enabled
  if (v.when !== undefined) out.when = v.when
  return { value: out }
}

function validateSceneEntityData(v: unknown, path: string): Validated<SceneEntityData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.id !== 'number') return { error: { path: `${path}.id`, message: 'expected a number' } }
  if (v.type !== null && typeof v.type !== 'string') {
    return { error: { path: `${path}.type`, message: 'expected a string or null' } }
  }
  if (v.parent !== null && typeof v.parent !== 'number') {
    return { error: { path: `${path}.parent`, message: 'expected a number or null' } }
  }
  if (!isPlainObject(v.overrides)) return { error: { path: `${path}.overrides`, message: 'expected an object' } }
  for (const [key, val] of Object.entries(v.overrides)) {
    if (!isPlainObject(val)) return { error: { path: `${path}.overrides.${key}`, message: 'expected an object' } }
  }
  return {
    value: {
      id: v.id,
      type: v.type as string | null,
      parent: v.parent as number | null,
      overrides: v.overrides as Record<string, Record<string, unknown>>,
    },
  }
}

function validateSceneData(v: unknown, path: string): Validated<SceneData> {
  if (!isPlainObject(v)) return { error: { path, message: 'expected an object' } }
  if (typeof v.name !== 'string') return { error: { path: `${path}.name`, message: 'expected a string' } }
  if (!Array.isArray(v.entities)) return { error: { path: `${path}.entities`, message: 'expected an array' } }

  const entities: SceneEntityData[] = []
  for (let j = 0; j < v.entities.length; j++) {
    const r = validateSceneEntityData(v.entities[j], `${path}.entities[${j}]`)
    if ('error' in r) return { error: r.error }
    entities.push(r.value)
  }
  return { value: { name: v.name, entities } }
}

function salvageArray<T>(
  value: unknown,
  key: string,
  validate: (v: unknown, path: string) => Validated<T>,
  problems: SchemaProblem[],
): T[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) problems.push({ path: key, message: 'expected an array; defaulted to empty' })
    return []
  }
  const out: T[] = []
  for (let i = 0; i < value.length; i++) {
    const result = validate(value[i], `${key}[${i}]`)
    if ('error' in result) problems.push(result.error)
    else out.push(result.value)
  }
  return out
}

function normalizeMeta(v: unknown): { meta: ProjectMeta; problem?: SchemaProblem } {
  if (isPlainObject(v) && typeof v.name === 'string' && typeof v.modified === 'string') {
    return { meta: { name: v.name, modified: v.modified } }
  }
  return {
    meta: { name: DEFAULT_PROJECT_NAME, modified: new Date().toISOString() },
    problem: { path: 'meta', message: 'missing or invalid meta; defaulted' },
  }
}

/**
 * Turns an arbitrary JSON value into a `ProjectDocument`, never throwing.
 *
 * Fatal (doc: null) only when the payload isn't even an object, or its
 * `format`/`version` don't match — those are the two things that make a
 * document unrecognizable as *any* version of this format. Everything else
 * is salvaged: each of the four top-level arrays is walked independently,
 * structurally invalid entries are dropped and reported at a precise path
 * (e.g. "entityTypes[2].name"), and valid entries elsewhere are kept. `meta`
 * is defaulted (not fatal) when missing/malformed.
 */
export function validateProject(json: unknown): { doc: ProjectDocument | null; problems: SchemaProblem[] } {
  if (!isPlainObject(json)) {
    return { doc: null, problems: [{ path: '', message: 'project document must be a JSON object' }] }
  }
  if (json.format !== 'domecs-project') {
    return {
      doc: null,
      problems: [{ path: 'format', message: `expected format "domecs-project", got ${JSON.stringify(json.format)}` }],
    }
  }
  if (json.version !== 1) {
    return { doc: null, problems: [{ path: 'version', message: `expected version 1, got ${JSON.stringify(json.version)}` }] }
  }

  const problems: SchemaProblem[] = []
  const { meta, problem: metaProblem } = normalizeMeta(json.meta)
  if (metaProblem) problems.push(metaProblem)

  const componentTypes = salvageArray(json.componentTypes, 'componentTypes', validateComponentTypeData, problems)
  const entityTypes = salvageArray(json.entityTypes, 'entityTypes', validateEntityTypeData, problems)
  const systems = salvageArray(json.systems, 'systems', validateSystemData, problems)
  const scenes = salvageArray(json.scenes, 'scenes', validateSceneData, problems)

  const doc: ProjectDocument = { format: 'domecs-project', version: 1, meta, componentTypes, entityTypes, systems, scenes }
  return { doc, problems }
}

// -----------------------------------------------------------------------------
// Stores — where a ProjectDocument comes from / goes to. `autosave`/`restore`
// are a separate, always-available crash-recovery channel from `open`/`save`/
// `saveAs`, which represent the user's actual file.
// -----------------------------------------------------------------------------

export interface ProjectStore {
  open(): Promise<{ json: unknown; name: string } | null>
  save(doc: ProjectDocument): Promise<boolean>
  saveAs(doc: ProjectDocument): Promise<boolean>
  autosave(doc: ProjectDocument): void
  restore(): ProjectDocument | null
}

/**
 * In-memory `ProjectStore` for tests.
 *
 * - `open()` "once" semantics: the *first* call resolves the fixed `initial`
 *   value (or `null` if none was given); every subsequent call resolves
 *   `null`, as if the user cancelled the file picker. This lets a single
 *   store simulate both "open this fixture" and "user cancelled" within one
 *   test without extra setup.
 * - `save`/`saveAs` record the last document passed to them on `savedDoc` /
 *   `savedAsDoc` (not part of the `ProjectStore` interface — extra,
 *   test-only introspection so a test can assert what got saved without
 *   round-tripping through a session).
 * - `autosave`/`restore` round-trip through a single in-memory slot,
 *   independent of `open`/`save`/`saveAs`.
 */
export function createMemoryProjectStore(initial?: { json: unknown; name: string } | null) {
  let openedOnce = false
  let savedDoc: ProjectDocument | null = null
  let savedAsDoc: ProjectDocument | null = null
  let autosaveSlot: ProjectDocument | null = null

  const store = {
    async open(): Promise<{ json: unknown; name: string } | null> {
      if (openedOnce) return null
      openedOnce = true
      return initial ?? null
    },
    async save(doc: ProjectDocument): Promise<boolean> {
      savedDoc = structuredClone(doc)
      return true
    },
    async saveAs(doc: ProjectDocument): Promise<boolean> {
      savedAsDoc = structuredClone(doc)
      return true
    },
    autosave(doc: ProjectDocument): void {
      autosaveSlot = structuredClone(doc)
    },
    restore(): ProjectDocument | null {
      return autosaveSlot ? structuredClone(autosaveSlot) : null
    },
    get savedDoc(): ProjectDocument | null {
      return savedDoc
    },
    get savedAsDoc(): ProjectDocument | null {
      return savedAsDoc
    },
  }
  return store
}

/** Structural subset of the Web Storage API this adapter needs — injected, never read from `globalThis`. */
export interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const DEFAULT_AUTOSAVE_SLOT = 'domecs-studio:autosave'

function bestEffortName(json: unknown, fallback: string): string {
  if (isPlainObject(json) && isPlainObject(json.meta) && typeof json.meta.name === 'string') return json.meta.name
  return fallback
}

/**
 * `ProjectStore` backed by an injected Web-Storage-like object (so it's
 * testable in a plain Node/vitest environment with a hand-rolled fake —
 * `localStorage`/`window` are never referenced directly).
 *
 * Web Storage has no notion of "files", just keys — so this store treats
 * `slot` as a single key used consistently by every method: `open()` reads
 * it, `save()`/`saveAs()` both write it (there's no separate "save as"
 * location), and `autosave()`/`restore()` read/write the same key as a
 * crash-recovery mirror of the last save. `autosave()` writes synchronously,
 * per the caller-controlled-cadence contract, and — like every method here —
 * never throws; storage failures (quota, corrupt JSON, missing key) are
 * swallowed and reported as `false`/`null`.
 */
export function createLocalStorageProjectStore(storage: WebStorageLike, slot: string = DEFAULT_AUTOSAVE_SLOT): ProjectStore {
  function readRaw(): string | null {
    try {
      return storage.getItem(slot)
    } catch {
      return null
    }
  }
  function writeRaw(text: string): boolean {
    try {
      storage.setItem(slot, text)
      return true
    } catch {
      return false
    }
  }

  return {
    async open(): Promise<{ json: unknown; name: string } | null> {
      const raw = readRaw()
      if (raw === null) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      return { json: parsed, name: bestEffortName(parsed, slot) }
    },
    async save(doc: ProjectDocument): Promise<boolean> {
      return writeRaw(JSON.stringify(doc))
    },
    async saveAs(doc: ProjectDocument): Promise<boolean> {
      return writeRaw(JSON.stringify(doc))
    },
    autosave(doc: ProjectDocument): void {
      writeRaw(JSON.stringify(doc))
    },
    restore(): ProjectDocument | null {
      const raw = readRaw()
      if (raw === null) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      return validateProject(parsed).doc
    },
  }
}

// Minimal local ambient types for the (still non-standard-in-TS-DOM-lib) File
// System Access API entry points. `FileSystemFileHandle` itself IS declared
// by lib.dom.d.ts (for drag-and-drop); only the global picker functions are
// missing, so only those get a local shape here.
interface FilePickerAcceptOption {
  description?: string
  accept: Record<string, string[]>
}
interface OpenFilePickerOptions {
  types?: FilePickerAcceptOption[]
}
interface SaveFilePickerOptions {
  types?: FilePickerAcceptOption[]
  suggestedName?: string
}
interface FileSystemAccessWindow {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}

/**
 * Browser glue: File System Access API when available (Chromium), otherwise
 * a download-link / `<input type=file>` fallback. Feature-detected once at
 * construction via a `typeof window` guard, so constructing this store is
 * safe even outside a browser (e.g. importing this module in a Node test) —
 * only *calling* its methods requires a real DOM, which is why this is
 * covered by a construction-only smoke test, not exercised end-to-end here.
 *
 * `restore()` always returns `null`: this store's "document" IS the open
 * file handle, so `autosave()` best-effort writes straight through to it
 * when one is open; there is no separate crash-recovery slot to restore
 * from (that would need e.g. IndexedDB, out of scope for M1).
 */
export function createFileSystemProjectStore(): ProjectStore {
  const hasFSAccess =
    typeof window !== 'undefined' && typeof (window as unknown as FileSystemAccessWindow).showOpenFilePicker === 'function'

  let fileHandle: FileSystemFileHandle | null = null

  async function writeToHandle(handle: FileSystemFileHandle, doc: ProjectDocument): Promise<boolean> {
    try {
      const writable = await handle.createWritable()
      await writable.write(JSON.stringify(doc, null, 2))
      await writable.close()
      return true
    } catch {
      return false
    }
  }

  async function openViaPicker(): Promise<{ json: unknown; name: string } | null> {
    try {
      const picker = (window as unknown as FileSystemAccessWindow).showOpenFilePicker!
      const [handle] = await picker({ types: [{ description: 'DOMECS Project', accept: { 'application/json': ['.json'] } }] })
      if (!handle) return null
      const file = await handle.getFile()
      const text = await file.text()
      fileHandle = handle
      return { json: JSON.parse(text), name: handle.name }
    } catch {
      return null
    }
  }

  async function openViaInput(): Promise<{ json: unknown; name: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.style.display = 'none'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        input.remove()
        if (!file) {
          resolve(null)
          return
        }
        file
          .text()
          .then((text) => resolve({ json: JSON.parse(text), name: file.name }))
          .catch(() => resolve(null))
      })
      document.body.appendChild(input)
      input.click()
    })
  }

  async function saveAsViaPicker(doc: ProjectDocument): Promise<boolean> {
    try {
      const picker = (window as unknown as FileSystemAccessWindow).showSaveFilePicker!
      const handle = await picker({
        suggestedName: `${doc.meta.name}.json`,
        types: [{ description: 'DOMECS Project', accept: { 'application/json': ['.json'] } }],
      })
      fileHandle = handle
      return writeToHandle(handle, doc)
    } catch {
      return false
    }
  }

  function saveAsViaDownload(doc: ProjectDocument): boolean {
    try {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${doc.meta.name}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      return true
    } catch {
      return false
    }
  }

  return {
    open(): Promise<{ json: unknown; name: string } | null> {
      return hasFSAccess ? openViaPicker() : openViaInput()
    },
    async save(doc: ProjectDocument): Promise<boolean> {
      if (hasFSAccess && fileHandle) return writeToHandle(fileHandle, doc)
      return this.saveAs(doc)
    },
    async saveAs(doc: ProjectDocument): Promise<boolean> {
      return hasFSAccess ? saveAsViaPicker(doc) : saveAsViaDownload(doc)
    },
    autosave(doc: ProjectDocument): void {
      if (hasFSAccess && fileHandle) void writeToHandle(fileHandle, doc)
    },
    restore(): ProjectDocument | null {
      return null
    },
  }
}

// -----------------------------------------------------------------------------
// Session — the editable, undoable view of a ProjectDocument over a store.
// -----------------------------------------------------------------------------

export interface ProjectSession {
  readonly doc: ProjectDocument
  readonly dirty: boolean
  readonly problems: SchemaProblem[]
  newProject(): void
  open(): Promise<boolean>
  save(): Promise<boolean>
  saveAs(): Promise<boolean>
  mutate(fn: (doc: ProjectDocument) => void): void
  undo(): void
  redo(): void
}

/**
 * Creates a `ProjectSession` over `store`, starting with a fresh empty
 * project (so `.doc` is always defined, never requiring an explicit
 * `newProject()`/`open()` call first).
 *
 * Undo/redo mirrors the engine's `createSnapshotHistory` ring: a single
 * array of checkpoints plus a cursor. `mutate()` clones the doc at the
 * cursor, applies the callback, truncates any orphaned redo branch, and
 * appends. `dirty` is tracked by *object identity* against the checkpoint
 * that was last successfully saved (or loaded) rather than by an index
 * number — an index can be revisited after truncation (a new mutate can
 * land back on the same numeric position a truncated branch used to
 * occupy) but a specific document object can't, so identity is the only
 * comparison that stays correct across undo -> mutate -> truncate cycles.
 */
export function createProjectSession(store: ProjectStore): ProjectSession {
  let history: ProjectDocument[] = [emptyProject(DEFAULT_PROJECT_NAME)]
  let cursor = 0
  let savedDocRef: ProjectDocument | null = history[0]!
  let problems: SchemaProblem[] = []

  function resetTo(doc: ProjectDocument, probs: SchemaProblem[]): void {
    history = [doc]
    cursor = 0
    savedDocRef = doc
    problems = probs
  }

  return {
    get doc(): ProjectDocument {
      return history[cursor]!
    },
    get dirty(): boolean {
      return history[cursor] !== savedDocRef
    },
    get problems(): SchemaProblem[] {
      return problems
    },
    newProject(): void {
      resetTo(emptyProject(DEFAULT_PROJECT_NAME), [])
    },
    async open(): Promise<boolean> {
      const opened = await store.open()
      if (opened === null) return false

      const { doc, problems: probs } = validateProject(opened.json)
      // A fatally invalid payload still can't leave `.doc` null (the
      // interface guarantees a usable ProjectDocument) — fall back to an
      // empty project stamped with the picked file's name, and surface the
      // fatal problem so the caller can warn the user instead of silently
      // pretending the load produced real content.
      resetTo(doc ?? emptyProject(opened.name), probs)
      return true
    },
    async save(): Promise<boolean> {
      const current = history[cursor]!
      const ok = await store.save(current)
      if (ok) savedDocRef = current
      return ok
    },
    async saveAs(): Promise<boolean> {
      const current = history[cursor]!
      const ok = await store.saveAs(current)
      if (ok) savedDocRef = current
      return ok
    },
    mutate(fn: (doc: ProjectDocument) => void): void {
      const clone = structuredClone(history[cursor]!)
      fn(clone)
      if (cursor < history.length - 1) history.length = cursor + 1
      history.push(clone)
      cursor = history.length - 1
    },
    undo(): void {
      if (cursor <= 0) return
      cursor--
    },
    redo(): void {
      if (cursor >= history.length - 1) return
      cursor++
    },
  }
}
