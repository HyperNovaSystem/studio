import {
  entry,
  type ComponentDescriptor,
  type ComponentEntry,
  type ComponentType,
  type Entity,
  type World,
} from '@domecs/core'
import { registerComponentTypes, type ComponentTypeData, type SchemaProblem } from '@domecs/persist'
import { Parent, setParent } from '@domecs/scene'
import type { EntityTypeData, ProjectSession, SceneData } from './project.js'

/**
 * Built-in guest component names — the ones `src/components.ts` defines and
 * `createDomecsStudio` primes into the guest world directly. User-authored
 * `componentTypes` in a project document must never be allowed to shadow
 * these (checked via `registerComponentTypes`'s `reserved` param).
 */
export const RESERVED_COMPONENT_NAMES: ReadonlySet<string> = new Set([
  'GuestName',
  'GuestTransform',
  'GuestSprite',
  'GuestHealth',
  'GuestScript',
  'GuestPrefabSource',
  'GuestDebugProbe',
  'GuestRenderable',
])

export interface Catalog {
  /**
   * Tears down every entity in the guest world, re-registers
   * `session.doc.componentTypes` (skipping reserved/duplicate/malformed
   * entries), validates every entityType's component references, and
   * instantiates the active scene (`session.doc.scenes[0]`). Never throws —
   * defects are collected and returned as {@link SchemaProblem}s; the
   * offending reference is skipped for materialization but left intact in
   * `session.doc`.
   */
  reload(): SchemaProblem[]
  /** Spawns a new guest entity from a named entityType, positioned at (x, y). Returns null for an unknown type name. */
  spawnFromType(typeName: string, x: number, y: number): Entity | null
  /** Every component type currently known to the guest world (built-ins + registered custom types), reflected. */
  registeredTypes(): ComponentDescriptor[]
  /** The project's entityType catalog, as authored. */
  entityTypes(): EntityTypeData[]
  upsertComponentType(data: ComponentTypeData): SchemaProblem[]
  /** Removes a component type and strips references to it from every entityType. Usage is counted before the mutation. */
  deleteComponentType(name: string): { usageCount: number }
  upsertEntityType(data: EntityTypeData): SchemaProblem[]
  /**
   * Removes an entityType. `'strip'` converts its scene instances to
   * `type: null`, inlining their fully-resolved components as overrides so
   * nothing visually changes. `'despawn'` removes those scene instances
   * entirely.
   */
  deleteEntityType(name: string, mode: 'strip' | 'despawn'): void
  /** Snapshots the live guest world back into `session.doc.scenes[0]` (or a scene matched by `name`). */
  captureScene(name?: string): void
  /**
   * Resolve a component name to its live `ComponentType`, via the exact same
   * `componentTypeByName` map `reload()` maintains internally (built-ins +
   * registered custom types) — no second resolution mechanism. Returns
   * `undefined` for a name reload() has never registered. This is the
   * resolver `@domecs/rules`'s `installRules`/`compileRule` need.
   */
  resolveComponentType(name: string): ComponentType<unknown> | undefined
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr && bArr) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const aRec = a as Record<string, unknown>
  const bRec = b as Record<string, unknown>
  const aKeys = Object.keys(aRec)
  const bKeys = Object.keys(bRec)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRec, key) && deepEqual(aRec[key], bRec[key]))
}

function sameComponentSet(
  declared: Record<string, Record<string, unknown>>,
  live: Record<string, unknown>,
): boolean {
  const declaredKeys = Object.keys(declared).sort()
  const liveKeys = Object.keys(live).sort()
  if (declaredKeys.length !== liveKeys.length) return false
  for (let i = 0; i < declaredKeys.length; i++) if (declaredKeys[i] !== liveKeys[i]) return false
  return declaredKeys.every((key) => deepEqual(declared[key], live[key]))
}

export function createCatalog(session: ProjectSession, guestWorld: World): Catalog {
  // Refreshed on every reload(): built-ins/already-known guest types, unioned
  // with whatever this reload's registerComponentTypes() pass produced.
  let componentTypeByName = new Map<string, ComponentType<unknown>>()

  function buildEntries(
    defaults: Record<string, Record<string, unknown>>,
    overrides: Record<string, Record<string, unknown>>,
  ): ComponentEntry<any>[] {
    const names = new Set<string>([...Object.keys(defaults), ...Object.keys(overrides)])
    const entries: ComponentEntry<any>[] = []
    for (const name of names) {
      const type = componentTypeByName.get(name)
      if (!type) continue // unknown component name — reload() already reported this as a SchemaProblem
      const value: Record<string, unknown> = { ...(defaults[name] ?? {}), ...(overrides[name] ?? {}) }
      entries.push(entry(type as ComponentType<Record<string, unknown>>, value))
    }
    return entries
  }

  function activeScene(): SceneData | undefined {
    return session.doc.scenes[0]
  }

  function reload(): SchemaProblem[] {
    for (const liveEntity of guestWorld.snapshot().entities) guestWorld.despawn(liveEntity.id)

    const { types: registered, problems } = registerComponentTypes(session.doc.componentTypes, RESERVED_COMPONENT_NAMES)

    const resolved = new Map<string, ComponentType<unknown>>()
    for (const type of guestWorld.componentTypes()) resolved.set(type.name, type)
    for (const type of registered) {
      // registerComponentTypes() calls defineComponent() fresh on every call,
      // producing a new object identity even for an unchanged name. The
      // engine rejects a second distinct ComponentType object under a name
      // already registered in this World (world.ts: "two distinct
      // ComponentType objects share the name"), so once a custom type's name
      // has been registered here (this reload or an earlier one), keep using
      // that live object rather than the freshly-defined one. This means a
      // reload() that only changes an existing custom type's field shape
      // (same name, edited fields) does not actually update the live
      // registration — see ../domecs/doc/FINDINGS_studio.md.
      if (resolved.has(type.name)) continue
      resolved.set(type.name, type)
      // Prime into the guest world even with zero live users, so
      // registeredTypes() reflects every defined component type, not only
      // ones currently in use.
      guestWorld.has(-1, type)
    }
    componentTypeByName = resolved

    const entityTypes = session.doc.entityTypes
    for (let i = 0; i < entityTypes.length; i++) {
      const entityType = entityTypes[i]!
      for (const name of Object.keys(entityType.components)) {
        if (!resolved.has(name)) {
          problems.push({ path: `entityTypes[${i}].components["${name}"]`, message: `unknown component type "${name}"` })
        }
      }
    }

    const scene = activeScene()
    if (scene) {
      // scene.entities' own array index is this scene's doc-local id space
      // (see captureScene()): stable and self-consistent within one document,
      // independent of the live world's ever-incrementing Entity ids, which
      // are reassigned fresh on every reload(). First pass spawns every
      // entity WITHOUT its Parent (so a forward reference to a not-yet-spawned
      // parent can never matter), recording docIndex -> the live id it landed
      // on; second pass resolves each doc-local `parent` index through that
      // map and applies it via setParent().
      const docIndexToLiveId = new Map<number, Entity>()
      for (let i = 0; i < scene.entities.length; i++) {
        const sceneEntity = scene.entities[i]!
        let defaults: Record<string, Record<string, unknown>> = {}
        if (sceneEntity.type !== null) {
          const entityType = entityTypes.find((et) => et.name === sceneEntity.type)
          if (entityType) {
            defaults = entityType.components
          } else {
            problems.push({ path: `scenes[0].entities[${i}].type`, message: `unknown entity type "${sceneEntity.type}"` })
          }
        }
        const liveId = guestWorld.spawn(buildEntries(defaults, sceneEntity.overrides))
        docIndexToLiveId.set(i, liveId)
      }
      for (let i = 0; i < scene.entities.length; i++) {
        const sceneEntity = scene.entities[i]!
        if (sceneEntity.parent === null) continue
        const result = setParent(guestWorld, docIndexToLiveId.get(i)!, docIndexToLiveId.get(sceneEntity.parent) ?? null)
        if (!result.ok) {
          // A hand-edited/corrupted project file could contain a cycle;
          // setParent never throws for one, so mirror that here — report and
          // leave the entity parentless (root) rather than partially applied.
          problems.push({ path: `scenes[0].entities[${i}].parent`, message: result.reason })
        }
      }
    }

    return problems
  }

  function spawnFromType(typeName: string, x: number, y: number): Entity | null {
    const entityType = session.doc.entityTypes.find((et) => et.name === typeName)
    if (!entityType) return null
    const overrides: Record<string, Record<string, unknown>> =
      'GuestTransform' in entityType.components ? { GuestTransform: { x, y } } : {}
    return guestWorld.spawn(buildEntries(entityType.components, overrides))
  }

  function registeredTypes(): ComponentDescriptor[] {
    return guestWorld.componentTypes().map((type) => guestWorld.describeComponent(type))
  }

  function entityTypes(): EntityTypeData[] {
    return session.doc.entityTypes
  }

  function upsertComponentType(data: ComponentTypeData): SchemaProblem[] {
    session.mutate((doc) => {
      const idx = doc.componentTypes.findIndex((c) => c.name === data.name)
      if (idx >= 0) doc.componentTypes[idx] = data
      else doc.componentTypes.push(data)
    })
    return reload()
  }

  function deleteComponentType(name: string): { usageCount: number } {
    const usageCount = session.doc.entityTypes.filter((et) => name in et.components).length
    session.mutate((doc) => {
      doc.componentTypes = doc.componentTypes.filter((c) => c.name !== name)
      for (const et of doc.entityTypes) {
        if (name in et.components) delete et.components[name]
      }
    })
    reload()
    return { usageCount }
  }

  function upsertEntityType(data: EntityTypeData): SchemaProblem[] {
    session.mutate((doc) => {
      const idx = doc.entityTypes.findIndex((et) => et.name === data.name)
      if (idx >= 0) doc.entityTypes[idx] = data
      else doc.entityTypes.push(data)
    })
    return reload()
  }

  function deleteEntityType(name: string, mode: 'strip' | 'despawn'): void {
    session.mutate((doc) => {
      const scene = doc.scenes[0]
      if (scene) {
        if (mode === 'despawn') {
          scene.entities = scene.entities.filter((sceneEntity) => sceneEntity.type !== name)
        } else {
          const entityType = doc.entityTypes.find((et) => et.name === name)
          for (const sceneEntity of scene.entities) {
            if (sceneEntity.type !== name) continue
            const merged: Record<string, Record<string, unknown>> = {}
            if (entityType) {
              for (const [componentName, defaults] of Object.entries(entityType.components)) {
                merged[componentName] = { ...defaults, ...(sceneEntity.overrides[componentName] ?? {}) }
              }
            }
            for (const [componentName, override] of Object.entries(sceneEntity.overrides)) {
              if (!(componentName in merged)) merged[componentName] = { ...override }
            }
            sceneEntity.overrides = merged
            sceneEntity.type = null
          }
        }
      }
      doc.entityTypes = doc.entityTypes.filter((et) => et.name !== name)
    })
    reload()
  }

  function resolveComponentType(name: string): ComponentType<unknown> | undefined {
    return componentTypeByName.get(name)
  }

  function captureScene(name?: string): void {
    const snapshot = guestWorld.snapshot()
    // This capture's doc-local id space: array index in snapshot.entities'
    // order (see reload(), which mirrors this exactly). liveEntity.id itself
    // is never stored — it's the live world's own ever-incrementing Entity
    // number, unstable across reloads, not a document-local identifier.
    const liveIdToDocIndex = new Map<Entity, number>()
    snapshot.entities.forEach((liveEntity, i) => liveIdToDocIndex.set(liveEntity.id, i))

    session.mutate((doc) => {
      let scene = name !== undefined ? doc.scenes.find((s) => s.name === name) : doc.scenes[0]
      if (!scene) {
        scene = { name: name ?? 'main', entities: [] }
        doc.scenes.push(scene)
      }
      scene.entities = snapshot.entities.map((liveEntity, i) => {
        const liveComponents = liveEntity.components as Record<string, Record<string, unknown>>
        // Parent is a live Entity reference, not doc-local-stable data — never
        // captured as a component override (that would embed a raw live id
        // that reload() would misinterpret next time round). The hierarchy
        // relationship is captured separately below, as a doc-local index.
        const { Parent: _liveParent, ...componentsSansParent } = liveComponents
        const matched = doc.entityTypes.find((et) => sameComponentSet(et.components, componentsSansParent))

        const parentComponent = guestWorld.getComponent(liveEntity.id, Parent)
        const parentLiveId = parentComponent?.entity ?? null
        // A live Parent should always point at another currently-alive
        // entity in this same snapshot — but never throw if it somehow
        // doesn't; fall back to root (null) instead.
        const parentDocIndex = parentLiveId !== null ? (liveIdToDocIndex.get(parentLiveId) ?? null) : null

        return {
          id: i,
          type: matched ? matched.name : null,
          parent: parentDocIndex,
          overrides: matched ? {} : structuredClone(componentsSansParent),
        }
      })
    })
  }

  return {
    reload,
    spawnFromType,
    registeredTypes,
    entityTypes,
    upsertComponentType,
    deleteComponentType,
    upsertEntityType,
    deleteEntityType,
    captureScene,
    resolveComponentType,
  }
}
