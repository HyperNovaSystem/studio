import {
  Has,
  createWorld,
  entry,
  type ComponentEntry,
  type ComponentType,
  type Entity,
  type World,
  type WorldOptions,
  type WorldSnapshot,
} from '@domecs/core'
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
  guestSchemas,
  type EditorPanelId,
  type ReflectedComponentSchema,
} from './components.js'
import { createDomecsStudioPlugin, createStudioPluginBridge, type StudioPluginBridge } from './plugin.js'

export interface StudioOptions extends WorldOptions {
  guestWorld?: World
  guestTitle?: string
  guestEntityCount?: number
  ringCapacity?: number
}

export interface StudioRefs {
  editorWorld: World
  guestWorld: World
  studioId: Entity
  playbackId: Entity
  scrubberId: Entity
  sceneDocumentId: Entity
  bridge: StudioPluginBridge
  schemaRegistry: Map<string, ReflectedComponentSchema<any>>
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
  reflectedSchemas(): ReflectedComponentSchema<any>[]
  visibleTree(): ReturnType<World['query']>['entities']
  inspectorFields(): ReturnType<World['query']>['entities']
  memoryRatio(): number
}

interface PrefabDefinition {
  prefabId: string
  name: string
  componentNames: string[]
  create(x: number, y: number): ComponentEntry<any>[]
}

const PANEL_ORDER: Array<{ panel: EditorPanelId; title: string }> = [
  { panel: 'entity-tree', title: 'Entities' },
  { panel: 'inspector', title: 'Inspector' },
  { panel: 'prefabs', title: 'Prefabs' },
  { panel: 'scripts', title: 'Visual Scripts' },
  { panel: 'timeline', title: 'Time Travel' },
  { panel: 'viewport', title: 'Guest Viewport' },
]

const PREFABS: PrefabDefinition[] = [
  {
    prefabId: 'prop.crate',
    name: 'Crate',
    componentNames: ['GuestName', 'GuestTransform', 'GuestSprite', 'GuestPrefabSource', 'GuestRenderable'],
    create: (x, y) => [
      entry(GuestName, { value: 'Crate' }),
      entry(GuestTransform, { x, y, rotation: 0, scale: 1 }),
      entry(GuestSprite, { kind: 'prop', tint: '#b88958', visible: true }),
      entry(GuestPrefabSource, { prefabId: 'prop.crate', label: 'Crate' }),
      entry(GuestRenderable, { slot: 'stage', layer: 2 }),
    ],
  },
  {
    prefabId: 'enemy.spark',
    name: 'Spark Enemy',
    componentNames: ['GuestName', 'GuestTransform', 'GuestSprite', 'GuestHealth', 'GuestScript', 'GuestRenderable'],
    create: (x, y) => [
      entry(GuestName, { value: 'Spark Enemy' }),
      entry(GuestTransform, { x, y, rotation: 0, scale: 1 }),
      entry(GuestSprite, { kind: 'enemy', tint: '#ff6b7a', visible: true }),
      entry(GuestHealth, { hp: 6, max: 6 }),
      entry(GuestScript, { event: 'OnTick', action: 'Patrol', enabled: true }),
      entry(GuestRenderable, { slot: 'stage', layer: 3 }),
    ],
  },
  {
    prefabId: 'trigger.door',
    name: 'Door Trigger',
    componentNames: ['GuestName', 'GuestTransform', 'GuestSprite', 'GuestScript', 'GuestRenderable'],
    create: (x, y) => [
      entry(GuestName, { value: 'Door Trigger' }),
      entry(GuestTransform, { x, y, rotation: 0, scale: 1 }),
      entry(GuestSprite, { kind: 'trigger', tint: '#8ee88e', visible: true }),
      entry(GuestScript, { event: 'OnEnter', action: 'OpenDoor', enabled: true }),
      entry(GuestRenderable, { slot: 'stage', layer: 4 }),
    ],
  },
]

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
    for (const { id, value: transform } of world.entitiesWith(GuestTransform)) {
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
  const bridge = createStudioPluginBridge(options.ringCapacity ?? 3600)
  const schemaRegistry = new Map<string, ReflectedComponentSchema<any>>()
  for (const schema of guestSchemas as ReflectedComponentSchema<any>[]) schemaRegistry.set(schema.name, schema)

  guestWorld.use(createDomecsStudioPlugin(bridge))

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
  const scrubberId = editorWorld.spawn([entry(TimeTravelScrubber, { capacity: bridge.ring.capacity, length: 0, cursor: 0, currentTick: 0, totalChangedComponents: 0, compactBytes: 0, fullSnapshotBytes: 0 })])
  const sceneDocumentId = editorWorld.spawn([entry(SceneDocument, { name: 'demo.scene.json', savedAtTick: 0, serializedBytes: 0, dirty: false, guestEntityCount: 0 })])

  for (const [order, panel] of PANEL_ORDER.entries()) {
    editorWorld.spawn([entry(EditorPanel, { panel: panel.panel, title: panel.title, order, collapsed: false })])
  }
  for (const role of ['selected', 'hovered', 'highlight'] as const) {
    editorWorld.spawn([entry(GuestReference, { role, guestEntityId: null })])
  }
  for (const prefab of PREFABS) {
    editorWorld.spawn([entry(PrefabAsset, { prefabId: prefab.prefabId, name: prefab.name, componentNames: prefab.componentNames, lastInstantiatedGuestId: null })])
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
    schemaRegistry,
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
      return reflectGuestSchemas(guestWorld, schemaRegistry)
    },
    visibleTree() {
      return editorWorld.query(Has(EntityTreeNode)).entities
    },
    inspectorFields() {
      return editorWorld.query(Has(InspectorField)).entities
    },
    memoryRatio() {
      const stats = bridge.ring.stats()
      return stats.fullSnapshotBytes === 0 ? 1 : stats.compactBytes / stats.fullSnapshotBytes
    },
  }

  installEditorSystems(refs)
  syncEditorProjection(refs)
  return refs
}

function installEditorSystems(refs: StudioRefs): void {
  const { editorWorld, guestWorld } = refs

  editorWorld.system('studio.selection', { schedule: 'event', triggers: [SelectGuestEntityEvent, HoverGuestEntityEvent] }, ({ events }) => {
    const playback = editorWorld.getComponent(refs.playbackId, PlaybackState)!
    for (const event of events.of(SelectGuestEntityEvent)) playback.selectedGuestEntity = event.guestEntityId
    for (const event of events.of(HoverGuestEntityEvent)) playback.hoveredGuestEntity = event.guestEntityId
    editorWorld.markChanged(refs.playbackId, PlaybackState)
    for (const { id, value } of editorWorld.entitiesWith(GuestReference)) {
      if (value.role === 'selected') value.guestEntityId = playback.selectedGuestEntity
      if (value.role === 'hovered') value.guestEntityId = playback.hoveredGuestEntity
      if (value.role === 'highlight') value.guestEntityId = playback.hoveredGuestEntity ?? playback.selectedGuestEntity
      editorWorld.markChanged(id, GuestReference)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.inspect.edit', { schedule: 'event', triggers: [EditComponentFieldEvent] }, ({ events }) => {
    for (const event of events.of(EditComponentFieldEvent)) {
      const schema = refs.schemaRegistry.get(event.componentName)
      if (!schema) continue
      const type = schema.component as ComponentType<Record<string, unknown>>
      const component = guestWorld.getComponent(event.guestEntityId, type)
      if (!component) continue
      component[event.field] = coerceFieldValue(event.value, schema.fields[event.field]?.type)
      guestWorld.markChanged(event.guestEntityId, type)
      markSceneDirty(refs)
    }
    syncEditorProjection(refs)
  })

  editorWorld.system('studio.prefab', { schedule: 'event', triggers: [ApplyPrefabEvent] }, ({ events }) => {
    for (const event of events.of(ApplyPrefabEvent)) {
      const prefab = PREFABS.find((candidate) => candidate.prefabId === event.prefabId)
      if (!prefab) continue
      const id = guestWorld.spawn(prefab.create(event.x ?? 0, event.y ?? 0))
      for (const { id: editorId, value } of editorWorld.entitiesWith(PrefabAsset)) {
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
      const snapshot = refs.bridge.ring.seek(event.cursor)
      guestWorld.restore(snapshot)
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
        depth: 0,
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
      const schema = refs.schemaRegistry.get(type.name)
      if (!schema) continue
      const component = guestWorld.getComponent(selected, schema.component as ComponentType<Record<string, unknown>>)
      if (!component) continue
      const inspectorId = editorWorld.spawn([
        entry(ComponentInspector, { guestEntityId: selected, componentName: type.name, fieldCount: Object.keys(schema.fields).length, expanded: true }),
        entry(ViewProjection, { slot: 'inspector', key: `component-${selected}-${type.name}`, guestEntityId: selected, visible: true, z: 0 }),
      ])
      refs.projectionEntityIds.push(inspectorId)
      for (const [field, fieldSchema] of Object.entries(schema.fields)) {
        const fieldId = editorWorld.spawn([
          entry(InspectorField, {
            guestEntityId: selected,
            componentName: type.name,
            field,
            fieldType: fieldSchema.type,
            valuePreview: previewValue(component[field]),
            dirty: false,
          }),
          entry(ViewProjection, { slot: 'inspector', key: `field-${selected}-${type.name}-${field}`, guestEntityId: selected, visible: true, z: 1 }),
        ])
        refs.projectionEntityIds.push(fieldId)
      }
    }
  }

  for (const { id, value: renderable } of guestWorld.entitiesWith(GuestRenderable)) {
    const sprite = guestWorld.getComponent(id, GuestSprite)
    if (!sprite?.visible) continue
    const viewportId = editorWorld.spawn([
      entry(ViewProjection, { slot: 'viewport', key: `guest-view-${id}`, guestEntityId: id, visible: true, z: renderable.layer }),
    ])
    refs.projectionEntityIds.push(viewportId)
  }

  const root = editorWorld.getComponent(refs.studioId, StudioRoot)!
  const stats = refs.bridge.ring.stats()
  const viewCount = editorWorld.query(Has(ViewProjection)).size
  root.editorEntityCount = editorWorld.snapshot().entities.length
  root.guestEntityCount = snapshot.entities.length
  root.renderedChrome = viewCount
  root.renderedGuestViews = guestWorld.query(Has(GuestRenderable)).size
  root.reflectedComponentTypes = reflectGuestSchemas(guestWorld, refs.schemaRegistry).length
  root.pluginInstalled = true
  editorWorld.markChanged(refs.studioId, StudioRoot)

  const scrubber = editorWorld.getComponent(refs.scrubberId, TimeTravelScrubber)!
  scrubber.capacity = stats.capacity
  scrubber.length = stats.length
  scrubber.cursor = stats.cursor
  scrubber.currentTick = snapshot.tick
  scrubber.totalChangedComponents = stats.totalChangedComponents
  scrubber.compactBytes = stats.compactBytes
  scrubber.fullSnapshotBytes = stats.fullSnapshotBytes
  editorWorld.markChanged(refs.scrubberId, TimeTravelScrubber)

  const doc = editorWorld.getComponent(refs.sceneDocumentId, SceneDocument)!
  doc.guestEntityCount = snapshot.entities.length
  editorWorld.markChanged(refs.sceneDocumentId, SceneDocument)

  rebuildVisualScriptBindings(refs, selected)
}

function rebuildVisualScriptBindings(refs: StudioRefs, selected: Entity | null): void {
  for (const { id } of refs.editorWorld.entitiesWith(VisualScriptBinding)) refs.editorWorld.despawn(id)
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

function reflectGuestSchemas(world: World, registry: Map<string, ReflectedComponentSchema<any>>): ReflectedComponentSchema<any>[] {
  return world.componentTypes().flatMap((type) => {
    const schema = registry.get(type.name)
    return schema ? [schema] : []
  })
}

function snapshotEntityIds(snapshot: WorldSnapshot): Entity[] {
  return snapshot.entities.map((entity) => entity.id)
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function coerceFieldValue(value: unknown, fieldType?: string): unknown {
  if (fieldType === 'number') return typeof value === 'number' ? value : Number(value)
  if (fieldType === 'boolean') return value === true || value === 'true'
  if (fieldType === 'string' || fieldType === 'enum') return String(value)
  return value
}

function markSceneDirty(refs: StudioRefs, dirty = true): void {
  const doc = refs.editorWorld.getComponent(refs.sceneDocumentId, SceneDocument)!
  doc.dirty = dirty
  refs.editorWorld.markChanged(refs.sceneDocumentId, SceneDocument)
}
