import {
  Has,
  createWorld,
  entry,
  type ComponentDescriptor,
  type ComponentEntry,
  type ComponentType,
  type Entity,
  type FieldKind,
  type World,
  type WorldOptions,
  type WorldSnapshot,
} from '@domecs/core'
import { createSnapshotHistory, diffSnapshots, type SnapshotDiff } from '@domecs/persist'
import { ancestorsOf, composeTransforms, installHierarchy } from '@domecs/scene'
import {
  ApplyPrefabEvent,
  ComponentInspector,
  EditComponentFieldEvent,
  EditorPanel,
  EntityTreeNode,
  GuestDebugProbe,
  GuestHealth,
  GuestName,
  GuestPrefabSource,
  GuestReference,
  GuestRenderable,
  GuestScript,
  GuestSprite,
  GuestTransform,
  HoverGuestEntityEvent,
  InspectorField,
  LoadSceneEvent,
  PlaybackState,
  PrefabAsset,
  SaveSceneEvent,
  SceneDocument,
  ScrubToSnapshotEvent,
  SelectGuestEntityEvent,
  SetPlaybackEvent,
  StepGuestEvent,
  StudioRoot,
  TimeTravelScrubber,
  ViewProjection,
  VisualScriptBinding,
  WorldTransform,
  type EditorPanelId,
} from './components.js'
import { createDomecsStudioPlugin, createStudioPluginBridge, type StudioPluginBridge } from './plugin.js'
import { createCatalog, type Catalog } from './catalog.js'
import { createMemoryProjectStore, createProjectSession, type EntityTypeData, type ProjectSession } from './project.js'

export interface StudioOptions extends WorldOptions {
  guestWorld?: World
  guestTitle?: string
  guestEntityCount?: number
  ringCapacity?: number
  /**
   * Supply an existing project (component/entity-type catalog + scene) to
   * drive the guest world from. When omitted, `createDomecsStudio` builds a
   * default in-memory project whose entityTypes reproduce the historical
   * built-in prefabs (`prop.crate` / `enemy.spark` / `trigger.door`) and
   * whose scene captures whatever is already live in `guestWorld` at
   * startup, so omitting this option preserves prior zero-arg behavior.
   */
  projectSession?: ProjectSession
}

export interface StudioRefs {
  editorWorld: World
  guestWorld: World
  studioId: Entity
  playbackId: Entity
  scrubberId: Entity
  sceneDocumentId: Entity
  bridge: StudioPluginBridge
  catalog: Catalog
  /** The project document backing `catalog` — session.doc/dirty/problems + open/save/saveAs/mutate/undo/redo. Exposed here (rather than a separate mountStudio param) because it already exists as a local in this function; the UI layer reads/mutates project state through it. */
  projectSession: ProjectSession
  projectionEntityIds: Entity[]
  select(guestEntityId: Entity | null): void
  hover(guestEntityId: Entity | null): void
  editField(guestEntityId: Entity, componentName: string, field: string, value: unknown): void
  stepGuest(steps?: number, dt?: number): void
  setPlayback(mode: 'paused' | 'playing' | 'stepping', speed?: number): void
  scrub(cursor: number): void
  applyPrefab(prefabId: string, x?: number, y?: number): Entity | null
  saveScene(name?: string): WorldSnapshot
  sync(): void
  reflectedSchemas(): ComponentDescriptor[]
  visibleTree(): ReturnType<World['query']>['entities']
  inspectorFields(): ReturnType<World['query']>['entities']
  /** A live, read-only view of every guest entity and its components. */
  inspectEntities(): EntityInspection[]
  /** A live, read-only view of one guest entity, or null when it no longer exists. */
  inspectEntity(guestEntityId: Entity): EntityInspection | null
  /**
   * Entity-level diffs between adjacent history checkpoints (engine
   * `diffSnapshots`). On-demand only — `history.snapshots()` returns a
   * defensive copy, so do not call this per frame.
   */
  timelineDiffs(): SnapshotDiff[]
}

export interface ComponentInspection {
  name: string
  descriptor: ComponentDescriptor
  value: Readonly<Record<string, unknown>>
}

export interface EntityInspection {
  id: Entity
  label: string
  components: ComponentInspection[]
}

const PANEL_ORDER: Array<{ panel: EditorPanelId; title: string }> = [
  { panel: 'entity-tree', title: 'Entities' },
  { panel: 'inspector', title: 'Inspector' },
  { panel: 'prefabs', title: 'Prefabs' },
  { panel: 'scripts', title: 'Visual Scripts' },
  { panel: 'timeline', title: 'Time Travel' },
  { panel: 'viewport', title: 'Guest Viewport' },
]

// Built-in guest component types the catalog needs resolvable by name before
// any live entity uses them (e.g. GuestPrefabSource, which historically only
// registered once a prefab was first instantiated). Force-registering them
// up front via World.has() lets entityType/scene component references
// resolve immediately, regardless of what's currently live in the world.
const RESERVED_GUEST_COMPONENT_TYPES: ComponentType<unknown>[] = [
  GuestName,
  GuestTransform,
  GuestSprite,
  GuestHealth,
  GuestScript,
  GuestPrefabSource,
  GuestDebugProbe,
  GuestRenderable,
]

// entityTypes reproducing the historical prop.crate / enemy.spark /
// trigger.door prefabs exactly (same names/components/defaults), so a
// zero-arg createDomecsStudio() keeps behaving identically to the old
// hardcoded PREFABS array. entityType.name doubles as the prefabId that
// StudioRefs.applyPrefab()/catalog.spawnFromType() take.
const DEFAULT_ENTITY_TYPES: EntityTypeData[] = [
  {
    name: 'prop.crate',
    components: {
      GuestName: { value: 'Crate' },
      GuestTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
      GuestSprite: { kind: 'prop', tint: '#b88958', visible: true },
      GuestPrefabSource: { prefabId: 'prop.crate', label: 'Crate' },
      GuestRenderable: { slot: 'stage', layer: 2 },
    },
  },
  {
    name: 'enemy.spark',
    components: {
      GuestName: { value: 'Spark Enemy' },
      GuestTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
      GuestSprite: { kind: 'enemy', tint: '#ff6b7a', visible: true },
      GuestHealth: { hp: 6, max: 6 },
      GuestScript: { event: 'OnTick', action: 'Patrol', enabled: true },
      GuestRenderable: { slot: 'stage', layer: 3 },
    },
  },
  {
    name: 'trigger.door',
    components: {
      GuestName: { value: 'Door Trigger' },
      GuestTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
      GuestSprite: { kind: 'trigger', tint: '#8ee88e', visible: true },
      GuestScript: { event: 'OnEnter', action: 'OpenDoor', enabled: true },
      GuestRenderable: { slot: 'stage', layer: 4 },
    },
  },
]

function createDefaultProjectSession(): ProjectSession {
  const session = createProjectSession(createMemoryProjectStore())
  session.mutate((doc) => {
    for (const entityType of DEFAULT_ENTITY_TYPES) doc.entityTypes.push(entityType)
  })
  return session
}

export function createDemoGuestWorld(options: { seed?: WorldOptions['seed']; headless?: boolean; entityCount?: number } = {}): World {
  const world = createWorld({ seed: options.seed ?? 7, headless: options.headless !== false })
  const count = options.entityCount ?? 24

  world.spawn([
    entry(GuestName, { value: 'Player' }),
    entry(GuestTransform, { x: 0, y: 0, rotation: 0, scale: 1 }),
    entry(GuestSprite, { kind: 'hero', tint: '#8fd3ff', visible: true }),
    entry(GuestHealth, { hp: 20, max: 20 }),
    entry(GuestScript, { event: 'OnStart', action: 'FocusCamera', enabled: true }),
    entry(GuestRenderable, { slot: 'stage', layer: 10 }),
    entry(GuestDebugProbe, { notes: 'local-only selection cache', lastEditorUser: 'designer' }),
  ])

  for (let i = 1; i < count; i++) {
    const kind = i % 7 === 0 ? 'trigger' : i % 3 === 0 ? 'enemy' : 'prop'
    const components: ComponentEntry<any>[] = [
      entry(GuestName, { value: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${i}` }),
      entry(GuestTransform, { x: (i % 8) * 36 - 120, y: Math.floor(i / 8) * 34 - 64, rotation: 0, scale: 1 }),
      entry(GuestSprite, { kind, tint: kind === 'enemy' ? '#ff6b7a' : kind === 'trigger' ? '#8ee88e' : '#d9bb78', visible: true }),
      entry(GuestRenderable, { slot: 'stage', layer: kind === 'enemy' ? 5 : 2 }),
    ]
    if (kind === 'enemy') components.push(entry(GuestHealth, { hp: 4 + (i % 4), max: 8 }))
    if (kind !== 'prop') components.push(entry(GuestScript, { event: kind === 'trigger' ? 'OnEnter' : 'OnTick', action: kind === 'trigger' ? 'SetFlag' : 'Patrol', enabled: true }))
    world.spawn(components)
  }

  world.system('demo.guest.motion', { schedule: 'tick', query: [GuestTransform, GuestSprite] }, () => {
    for (const { id, value: transform } of world.iterEntitiesWith(GuestTransform)) {
      const sprite = world.getComponent(id, GuestSprite)
      if (!sprite || sprite.kind === 'hero') continue
      transform.rotation = Math.round((transform.rotation + 15 * (world.time.scaledDelta || 1 / 60)) * 1000) / 1000
      world.markChanged(id, GuestTransform)
    }
  })

  return world
}

export function createDomecsStudio(options: StudioOptions = {}): StudioRefs {
  const editorWorld = createWorld({ seed: options.seed ?? 106, headless: options.headless !== false })
  const guestWorld = options.guestWorld ?? createDemoGuestWorld({ seed: options.seed ?? 106, headless: true, entityCount: options.guestEntityCount })
  const ringCapacity = options.ringCapacity ?? 3600
  const bridge = createStudioPluginBridge()

  // Force-register every built-in guest component type before the catalog
  // touches this world, so entityType/scene component references resolve by
  // name even before any live entity uses them (World.has() registers a type
  // without requiring an alive entity or an existing component value).
  for (const type of RESERVED_GUEST_COMPONENT_TYPES) guestWorld.has(-1, type)

  const usingDefaultProject = options.projectSession === undefined
  const projectSession = options.projectSession ?? createDefaultProjectSession()
  const catalog = createCatalog(projectSession, guestWorld)
  if (usingDefaultProject) {
    // No project supplied: whatever's already live in guestWorld (the demo
    // content just created above, or a caller-supplied guestWorld) becomes
    // the default project's starting scene, so reload() below reproduces it
    // instead of wiping it out. Done BEFORE the studio plugin is installed so
    // its onSnapshot redaction hook (which strips GuestDebugProbe) does not
    // apply to this internal round-trip.
    catalog.captureScene()
  }
  catalog.reload()

  guestWorld.use(createDomecsStudioPlugin(bridge))
  guestWorld.use(installHierarchy())
  guestWorld.use(
    composeTransforms(GuestTransform, WorldTransform, (parentWorld, local) =>
      parentWorld
        ? {
            x: parentWorld.x + local.x,
            y: parentWorld.y + local.y,
            rotation: parentWorld.rotation + local.rotation,
            scale: parentWorld.scale * local.scale,
          }
        : { ...local },
    ),
  )

  // Created AFTER use(plugin) so the initial checkpoint flows through the
  // plugin's onSnapshot redaction hook. Engine default limit is 50 — pass the
  // app's capacity explicitly.
  const history = createSnapshotHistory(guestWorld, { limit: ringCapacity, captureInitial: true })
  bridge.history = history
  bridge.snapshotsCaptured += 1

  // name -> ComponentType, cached from the guest world's registry. Used by
  // the field-editor system below to resolve an arbitrary component name
  // (from an EditComponentFieldEvent) back to its live ComponentType.
  const componentTypeByName = new Map<string, ComponentType<unknown>>()
  const resolveComponentType = (name: string): ComponentType<unknown> | undefined => {
    if (!componentTypeByName.has(name)) {
      for (const type of guestWorld.componentTypes()) componentTypeByName.set(type.name, type)
    }
    return componentTypeByName.get(name)
  }
  resolveComponentType('GuestName')

  const studioId = editorWorld.spawn([
    entry(StudioRoot, {
      title: 'DOMECS Studio',
      guestTitle: options.guestTitle ?? 'Demo Scene',
      editorEntityCount: 0,
      guestEntityCount: 0,
      renderedChrome: 0,
      renderedGuestViews: 0,
      reflectedComponentTypes: 0,
      pluginInstalled: true,
    }),
  ])
  const playbackId = editorWorld.spawn([entry(PlaybackState, { mode: 'paused', speed: 1, stepCount: 0, selectedGuestEntity: null, hoveredGuestEntity: null })])
  const scrubberId = editorWorld.spawn([entry(TimeTravelScrubber, { capacity: ringCapacity, length: history.length, cursor: history.index, currentTick: 0, changedEntities: 0 })])
  const sceneDocumentId = editorWorld.spawn([entry(SceneDocument, { name: 'demo.scene.json', savedAtTick: 0, serializedBytes: 0, dirty: false, guestEntityCount: 0 })])

  for (const [order, panel] of PANEL_ORDER.entries()) {
    editorWorld.spawn([entry(EditorPanel, { panel: panel.panel, title: panel.title, order, collapsed: false })])
  }
  for (const role of ['selected', 'hovered', 'highlight'] as const) {
    editorWorld.spawn([entry(GuestReference, { role, guestEntityId: null })])
  }
  for (const entityType of catalog.entityTypes()) {
    const displayName = (entityType.components.GuestName?.value as string | undefined) ?? entityType.name
    editorWorld.spawn([
      entry(PrefabAsset, {
        prefabId: entityType.name,
        name: displayName,
        componentNames: Object.keys(entityType.components),
        lastInstantiatedGuestId: null,
      }),
    ])
  }
  for (let i = 0; i < 150; i++) {
    editorWorld.spawn([entry(ViewProjection, { slot: 'chrome', key: `chrome-widget-${i}`, guestEntityId: null, visible: true, z: i })])
  }

  const refs: StudioRefs = {
    editorWorld,
    guestWorld,
    studioId,
    playbackId,
    scrubberId,
    sceneDocumentId,
    bridge,
    catalog,
    projectSession,
    projectionEntityIds: [],
    select(guestEntityId) {
      editorWorld.emit(SelectGuestEntityEvent, { guestEntityId })
      editorWorld.step(1 / 60)
    },
    hover(guestEntityId) {
      editorWorld.emit(HoverGuestEntityEvent, { guestEntityId })
      editorWorld.step(1 / 60)
    },
    editField(guestEntityId, componentName, field, value) {
      editorWorld.emit(EditComponentFieldEvent, { guestEntityId, componentName, field, value })
      editorWorld.step(1 / 60)
    },
    stepGuest(steps = 1, dt = 1 / 60) {
      editorWorld.emit(StepGuestEvent, { steps, dt })
      editorWorld.step(1 / 60)
    },
    setPlayback(mode, speed) {
      editorWorld.emit(SetPlaybackEvent, { mode, speed })
      editorWorld.step(1 / 60)
    },
    scrub(cursor) {
      editorWorld.emit(ScrubToSnapshotEvent, { cursor })
      editorWorld.step(1 / 60)
    },
    applyPrefab(prefabId, x = 0, y = 0) {
      const before = new Set(snapshotEntityIds(guestWorld.snapshot()))
      editorWorld.emit(ApplyPrefabEvent, { prefabId, x, y })
      editorWorld.step(1 / 60)
      for (const id of snapshotEntityIds(guestWorld.snapshot())) if (!before.has(id)) return id
      return null
    },
    saveScene(name) {
      editorWorld.emit(SaveSceneEvent, { name })
      editorWorld.step(1 / 60)
      return guestWorld.snapshot()
    },
    sync() {
      syncEditorProjection(refs)
    },
    reflectedSchemas() {
      return reflectGuestSchemas(guestWorld)
    },
    visibleTree() {
      return editorWorld.query(Has(EntityTreeNode)).entities
    },
    inspectorFields() {
      return editorWorld.query(Has(InspectorField)).entities
    },
    inspectEntities() {
      return guestWorld.snapshot().entities.map((entity) => inspectGuestEntity(guestWorld, entity.id)!).filter(Boolean)
    },
    inspectEntity(guestEntityId) {
      return inspectGuestEntity(guestWorld, guestEntityId)
    },
    timelineDiffs() {
      const snapshots = history.snapshots()
      const diffs: SnapshotDiff[] = []
      for (let i = 1; i < snapshots.length; i++) diffs.push(diffSnapshots(snapshots[i - 1]!, snapshots[i]!))
      return diffs
    },
  }

  installEditorSystems(refs, resolveComponentType)
  syncEditorProjection(refs)
  return refs
}

function inspectGuestEntity(world: World, id: Entity): EntityInspection | null {
  const types = world.archetype(id)
  if (types.length === 0) return null
  const components = types.map((type): ComponentInspection => {
    const value = world.getComponent(id, type as ComponentType<Record<string, unknown>>)!
    return {
      name: type.name,
      descriptor: world.describeComponent(type),
      // Do not expose the world's mutable component object through the
      // introspection API. Editors may display this value; mutations still go
      // through editField so validation/change tracking remains centralized.
      value: structuredClone(value),
    }
  })
  return {
    id,
    label: world.getComponent(id, GuestName)?.value ?? `Entity ${id}`,
    components,
  }
}

function installEditorSystems(refs: StudioRefs, resolveComponentType: (name: string) => ComponentType<unknown> | undefined): void {
  const { editorWorld, guestWorld } = refs

  editorWorld.system('studio.selection', { schedule: 'event', triggers: [SelectGuestEntityEvent, HoverGuestEntityEvent] }, ({ events }) => {
    const playback = editorWorld.getComponent(refs.playbackId, PlaybackState)!
    for (const event of events.of(SelectGuestEntityEvent)) playback.selectedGuestEntity = event.guestEntityId
    for (const event of events.of(HoverGuestEntityEvent)) playback.hoveredGuestEntity = event.guestEntityId
    editorWorld.markChanged(refs.playbackId, PlaybackState)
    for (const { id, value } of editorWorld.iterEntitiesWith(GuestReference)) {
      if (value.role === 'selected') value.guestEntityId = playback.selectedGuestEntity
      if (value.role === 'hovered') value.guestEntityId = playback.hoveredGuestEntity
      if (value.role === 'highlight') value.guestEntityId = playback.hoveredGuestEntity ?? playback.selectedGuestEntity
      editorWorld.markChanged(id, GuestReference)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.inspect.edit', { schedule: 'event', triggers: [EditComponentFieldEvent] }, ({ events }) => {
    for (const event of events.of(EditComponentFieldEvent)) {
      const type = resolveComponentType(event.componentName) as ComponentType<Record<string, unknown>> | undefined
      if (!type) continue
      const descriptor = guestWorld.describeComponent(type)
      if (descriptor.fieldsSource !== 'schema') continue
      const component = guestWorld.getComponent(event.guestEntityId, type)
      if (!component) continue
      component[event.field] = coerceFieldValue(event.value, descriptor.fields[event.field]?.kind)
      guestWorld.markChanged(event.guestEntityId, type)
      markSceneDirty(refs)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.prefab', { schedule: 'event', triggers: [ApplyPrefabEvent] }, ({ events }) => {
    for (const event of events.of(ApplyPrefabEvent)) {
      const id = refs.catalog.spawnFromType(event.prefabId, event.x ?? 0, event.y ?? 0)
      if (id === null) continue
      for (const { id: editorId, value } of editorWorld.iterEntitiesWith(PrefabAsset)) {
        if (value.prefabId !== event.prefabId) continue
        value.lastInstantiatedGuestId = id
        editorWorld.markChanged(editorId, PrefabAsset)
      }
      markSceneDirty(refs)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.scene.io', { schedule: 'event', triggers: [SaveSceneEvent, LoadSceneEvent] }, ({ events }) => {
    for (const event of events.of(LoadSceneEvent)) {
      guestWorld.restore(event.snapshot)
      markSceneDirty(refs, false)
    }
    for (const event of events.of(SaveSceneEvent)) {
      const snapshot = guestWorld.snapshot()
      const doc = editorWorld.getComponent(refs.sceneDocumentId, SceneDocument)!
      doc.name = event.name ?? doc.name
      doc.savedAtTick = snapshot.tick
      doc.serializedBytes = JSON.stringify(snapshot).length
      doc.guestEntityCount = snapshot.entities.length
      doc.dirty = false
      editorWorld.markChanged(refs.sceneDocumentId, SceneDocument)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.transport', { schedule: 'event', triggers: [StepGuestEvent, SetPlaybackEvent, ScrubToSnapshotEvent] }, ({ events }) => {
    const playback = editorWorld.getComponent(refs.playbackId, PlaybackState)!
    for (const event of events.of(SetPlaybackEvent)) {
      playback.mode = event.mode
      if (event.speed !== undefined) playback.speed = event.speed
    }
    for (const event of events.of(StepGuestEvent)) {
      const steps = event.steps ?? 1
      for (let i = 0; i < steps; i++) guestWorld.step(event.dt ?? 1 / 60)
      playback.stepCount += steps
      playback.mode = 'paused'
      markSceneDirty(refs)
    }
    for (const event of events.of(ScrubToSnapshotEvent)) {
      const history = refs.bridge.history
      if (!history || history.length === 0) continue
      const cursor = Math.max(0, Math.min(event.cursor, history.length - 1))
      while (history.index > cursor && history.undo()) { /* walk back */ }
      while (history.index < cursor && history.redo()) { /* walk forward */ }
      const scrubber = editorWorld.getComponent(refs.scrubberId, TimeTravelScrubber)!
      const snapshots = history.snapshots()
      const index = history.index
      if (index > 0) {
        const diff = diffSnapshots(snapshots[index - 1]!, snapshots[index]!)
        scrubber.changedEntities = diff.addedEntities.length + diff.removedEntities.length + diff.changedEntities.length
      } else {
        scrubber.changedEntities = 0
      }
      editorWorld.markChanged(refs.scrubberId, TimeTravelScrubber)
      playback.mode = 'paused'
      markSceneDirty(refs)
    }
    editorWorld.markChanged(refs.playbackId, PlaybackState)
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.playback.tick', { schedule: 'tick' }, ({ time }) => {
    const playback = editorWorld.getComponent(refs.playbackId, PlaybackState)!
    if (playback.mode !== 'playing') return
    guestWorld.step((time.scaledDelta || 1 / 60) * playback.speed)
    playback.stepCount += 1
    editorWorld.markChanged(refs.playbackId, PlaybackState)
    syncEditorProjection(refs)
  })
}

function syncEditorProjection(refs: StudioRefs): void {
  const { editorWorld, guestWorld } = refs
  for (const id of refs.projectionEntityIds.splice(0)) editorWorld.despawn(id)

  const playback = editorWorld.getComponent(refs.playbackId, PlaybackState)!
  const snapshot = guestWorld.snapshot()
  const selected = playback.selectedGuestEntity ?? snapshot.entities[0]?.id ?? null
  if (playback.selectedGuestEntity === null && selected !== null) {
    playback.selectedGuestEntity = selected
    editorWorld.markChanged(refs.playbackId, PlaybackState)
  }

  for (const entity of snapshot.entities) {
    const name = guestWorld.getComponent(entity.id, GuestName)?.value ?? `Entity ${entity.id}`
    const projectionId = editorWorld.spawn([
      entry(EntityTreeNode, {
        guestEntityId: entity.id,
        label: name,
        depth: ancestorsOf(guestWorld, entity.id).length,
        componentCount: Object.keys(entity.components).length,
        selected: entity.id === selected,
        hovered: entity.id === playback.hoveredGuestEntity,
      }),
      entry(ViewProjection, { slot: 'tree', key: `tree-${entity.id}`, guestEntityId: entity.id, visible: true, z: entity.id }),
    ])
    refs.projectionEntityIds.push(projectionId)
  }

  if (selected !== null) {
    for (const type of guestWorld.archetype(selected)) {
      const descriptor = guestWorld.describeComponent(type)
      if (descriptor.fieldsSource !== 'schema') continue
      const component = guestWorld.getComponent(selected, type as ComponentType<Record<string, unknown>>)
      if (!component) continue
      const inspectorId = editorWorld.spawn([
        entry(ComponentInspector, { guestEntityId: selected, componentName: type.name, fieldCount: Object.keys(descriptor.fields).length, expanded: true }),
        entry(ViewProjection, { slot: 'inspector', key: `component-${selected}-${type.name}`, guestEntityId: selected, visible: true, z: 0 }),
      ])
      refs.projectionEntityIds.push(inspectorId)
      for (const [field, fieldSchema] of Object.entries(descriptor.fields)) {
        const fieldId = editorWorld.spawn([
          entry(InspectorField, {
            guestEntityId: selected,
            componentName: type.name,
            field,
            fieldType: fieldSchema.kind,
            valuePreview: previewValue(component[field]),
            dirty: false,
          }),
          entry(ViewProjection, { slot: 'inspector', key: `field-${selected}-${type.name}-${field}`, guestEntityId: selected, visible: true, z: 1 }),
        ])
        refs.projectionEntityIds.push(fieldId)
      }
    }
  }

  for (const { id, value: renderable } of guestWorld.iterEntitiesWith(GuestRenderable)) {
    const sprite = guestWorld.getComponent(id, GuestSprite)
    if (!sprite?.visible) continue
    const viewportId = editorWorld.spawn([
      entry(ViewProjection, { slot: 'viewport', key: `guest-view-${id}`, guestEntityId: id, visible: true, z: renderable.layer }),
    ])
    refs.projectionEntityIds.push(viewportId)
  }

  // Rebuild script bindings before computing stats so editorEntityCount and
  // renderedChrome reflect the fully built projection.
  rebuildVisualScriptBindings(refs, selected)

  const root = editorWorld.getComponent(refs.studioId, StudioRoot)!
  const history = refs.bridge.history
  const viewCount = editorWorld.query(Has(ViewProjection)).size
  // describe().entityCount is an O(1)-ish manifest read — no full serialization.
  // guestEntityCount stays snapshot-derived: the guest snapshot is redacted, so
  // the counts can legitimately differ from the live world.
  root.editorEntityCount = editorWorld.describe().entityCount
  root.guestEntityCount = snapshot.entities.length
  root.renderedChrome = viewCount
  root.renderedGuestViews = guestWorld.query(Has(GuestRenderable)).size
  root.reflectedComponentTypes = reflectGuestSchemas(guestWorld).length
  root.pluginInstalled = true
  editorWorld.markChanged(refs.studioId, StudioRoot)

  // Checkpoint count + cursor only — both O(1) reads. Changed-entity counts
  // come from timelineDiffs()/scrub on demand, never per frame.
  const scrubber = editorWorld.getComponent(refs.scrubberId, TimeTravelScrubber)!
  scrubber.length = history?.length ?? 0
  scrubber.cursor = history?.index ?? -1
  scrubber.currentTick = snapshot.tick
  editorWorld.markChanged(refs.scrubberId, TimeTravelScrubber)

  const doc = editorWorld.getComponent(refs.sceneDocumentId, SceneDocument)!
  doc.guestEntityCount = snapshot.entities.length
  editorWorld.markChanged(refs.sceneDocumentId, SceneDocument)
}

function rebuildVisualScriptBindings(refs: StudioRefs, selected: Entity | null): void {
  for (const { id } of refs.editorWorld.iterEntitiesWith(VisualScriptBinding)) refs.editorWorld.despawn(id)
  if (selected === null) return
  const script = refs.guestWorld.getComponent(selected, GuestScript)
  if (!script) return
  refs.editorWorld.spawn([
    entry(VisualScriptBinding, {
      guestEntityId: selected,
      event: script.event,
      targetComponent: 'GuestScript',
      enabled: script.enabled,
    }),
    entry(ViewProjection, { slot: 'library', key: `script-${selected}`, guestEntityId: selected, visible: true, z: 0 }),
  ])
}

function reflectGuestSchemas(world: World): ComponentDescriptor[] {
  return world
    .componentTypes()
    .map((type) => world.describeComponent(type))
    .filter((descriptor) => descriptor.fieldsSource === 'schema')
}

function snapshotEntityIds(snapshot: WorldSnapshot): Entity[] {
  return snapshot.entities.map((entity) => entity.id)
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function coerceFieldValue(value: unknown, kind?: FieldKind): unknown {
  if (kind === 'number') return typeof value === 'number' ? value : Number(value)
  if (kind === 'boolean') return value === true || value === 'true'
  if (kind === 'string' || kind === 'enum') return String(value)
  return value
}

function markSceneDirty(refs: StudioRefs, dirty = true): void {
  const doc = refs.editorWorld.getComponent(refs.sceneDocumentId, SceneDocument)!
  doc.dirty = dirty
  refs.editorWorld.markChanged(refs.sceneDocumentId, SceneDocument)
}
