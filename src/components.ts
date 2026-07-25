import { defineComponent, defineEvent } from '@domecs/core'
import type { Entity, FieldKind, WorldSnapshot } from '@domecs/core'

export type EditorPanelId = 'entity-tree' | 'inspector' | 'prefabs' | 'scripts' | 'timeline' | 'viewport'
export type PlaybackMode = 'paused' | 'playing' | 'stepping'
export type GuestRefRole = 'selected' | 'hovered' | 'highlight'
export type ViewSlot = 'chrome' | 'tree' | 'inspector' | 'library' | 'timeline' | 'viewport' | 'overlay'

function finite(name: string, value: number): true | string {
  return Number.isFinite(value) ? true : `${name} must be finite`
}

function nonNegativeInteger(name: string, value: number): true | string {
  return Number.isInteger(value) && value >= 0 ? true : `${name} must be a non-negative integer`
}

export const StudioRoot = defineComponent<{
  title: string
  guestTitle: string
  editorEntityCount: number
  guestEntityCount: number
  renderedChrome: number
  renderedGuestViews: number
  reflectedComponentTypes: number
  pluginInstalled: boolean
}>('StudioRoot', {
  defaults: {
    title: 'DOMECS Studio',
    guestTitle: 'Demo Scene',
    editorEntityCount: 0,
    guestEntityCount: 0,
    renderedChrome: 0,
    renderedGuestViews: 0,
    reflectedComponentTypes: 0,
    pluginInstalled: false,
  },
  validate: (value) => nonNegativeInteger('editorEntityCount', value.editorEntityCount),
})

export const EditorPanel = defineComponent<{
  panel: EditorPanelId
  title: string
  order: number
  collapsed: boolean
}>('EditorPanel', {
  defaults: { panel: 'entity-tree', title: '', order: 0, collapsed: false },
})

export const EntityTreeNode = defineComponent<{
  guestEntityId: Entity
  label: string
  depth: number
  componentCount: number
  selected: boolean
  hovered: boolean
}>('EntityTreeNode', {
  defaults: { guestEntityId: -1, label: '', depth: 0, componentCount: 0, selected: false, hovered: false },
  transient: true,
})

export const ComponentInspector = defineComponent<{
  guestEntityId: Entity
  componentName: string
  fieldCount: number
  expanded: boolean
}>('ComponentInspector', {
  defaults: { guestEntityId: -1, componentName: '', fieldCount: 0, expanded: true },
  transient: true,
})

export const InspectorField = defineComponent<{
  guestEntityId: Entity
  componentName: string
  field: string
  fieldType: FieldKind
  valuePreview: string
  dirty: boolean
}>('InspectorField', {
  defaults: {
    guestEntityId: -1,
    componentName: '',
    field: '',
    fieldType: 'string',
    valuePreview: '',
    dirty: false,
  },
  transient: true,
})

export const PrefabAsset = defineComponent<{
  prefabId: string
  name: string
  componentNames: string[]
  lastInstantiatedGuestId: Entity | null
}>('PrefabAsset', {
  defaults: { prefabId: '', name: '', componentNames: [], lastInstantiatedGuestId: null },
})

export const VisualScriptBinding = defineComponent<{
  guestEntityId: Entity
  event: string
  targetComponent: string
  enabled: boolean
}>('VisualScriptBinding', {
  defaults: { guestEntityId: -1, event: 'OnClick', targetComponent: '', enabled: true },
})

export const PlaybackState = defineComponent<{
  mode: PlaybackMode
  speed: number
  stepCount: number
  selectedGuestEntity: Entity | null
  hoveredGuestEntity: Entity | null
}>('PlaybackState', {
  defaults: { mode: 'paused', speed: 1, stepCount: 0, selectedGuestEntity: null, hoveredGuestEntity: null },
  validate: (value) => finite('speed', value.speed),
})

export const TimeTravelScrubber = defineComponent<{
  capacity: number
  length: number
  cursor: number
  currentTick: number
  /** Entities added/removed/changed at the checkpoint last scrubbed to (engine diffSnapshots; computed on scrub only). */
  changedEntities: number
}>('TimeTravelScrubber', {
  defaults: {
    capacity: 3600,
    length: 0,
    cursor: 0,
    currentTick: 0,
    changedEntities: 0,
  },
  validate: (value) => nonNegativeInteger('capacity', value.capacity),
})

export const SceneDocument = defineComponent<{
  name: string
  savedAtTick: number
  serializedBytes: number
  dirty: boolean
  guestEntityCount: number
}>('SceneDocument', {
  defaults: { name: 'demo.scene.json', savedAtTick: 0, serializedBytes: 0, dirty: false, guestEntityCount: 0 },
})

export const GuestReference = defineComponent<{
  role: GuestRefRole
  guestEntityId: Entity | null
}>('GuestReference', {
  defaults: { role: 'selected', guestEntityId: null },
  transient: true,
})

export const ViewProjection = defineComponent<{
  slot: ViewSlot
  key: string
  guestEntityId: Entity | null
  visible: boolean
  z: number
}>('ViewProjection', {
  defaults: { slot: 'chrome', key: '', guestEntityId: null, visible: true, z: 0 },
  transient: true,
})

export const GuestName = defineComponent<{ value: string }>('GuestName', {
  defaults: { value: '' },
  schema: { fields: { value: { kind: 'string', label: 'Name' } } },
})

export const GuestTransform = defineComponent<{
  x: number
  y: number
  rotation: number
  scale: number
}>('GuestTransform', {
  defaults: { x: 0, y: 0, rotation: 0, scale: 1 },
  schema: {
    fields: {
      x: { kind: 'number', min: -500, max: 500, step: 1 },
      y: { kind: 'number', min: -500, max: 500, step: 1 },
      rotation: { kind: 'number', min: -360, max: 360, step: 1 },
      scale: { kind: 'number', min: 0.1, max: 4, step: 0.1 },
    },
  },
})

// Fully derived from GuestTransform + the guest Parent chain every tick (see
// @domecs/scene's composeTransforms, installed onto guestWorld in
// createDomecsStudio) — never authored directly and never round-tripped
// through save/load, same reasoning as this file's other transient
// components (EntityTreeNode, GuestReference, ...): a stale/hand-authored
// value here would silently fight the system that recomputes it every tick.
export const WorldTransform = defineComponent<{
  x: number
  y: number
  rotation: number
  scale: number
}>('WorldTransform', {
  defaults: { x: 0, y: 0, rotation: 0, scale: 1 },
  transient: true,
})

export const GuestSprite = defineComponent<{
  kind: 'hero' | 'prop' | 'enemy' | 'trigger'
  tint: string
  visible: boolean
}>('GuestSprite', {
  defaults: { kind: 'prop', tint: '#8fd3ff', visible: true },
  schema: {
    fields: {
      kind: { kind: 'enum', options: ['hero', 'prop', 'enemy', 'trigger'] },
      tint: { kind: 'string' },
      visible: { kind: 'boolean' },
    },
  },
})

export const GuestHealth = defineComponent<{
  hp: number
  max: number
}>('GuestHealth', {
  defaults: { hp: 10, max: 10 },
  schema: {
    fields: {
      hp: { kind: 'number', min: 0, step: 1 },
      max: { kind: 'number', min: 1, step: 1 },
    },
  },
})

export const GuestScript = defineComponent<{
  event: string
  action: string
  enabled: boolean
}>('GuestScript', {
  defaults: { event: 'OnStart', action: 'Log', enabled: true },
  schema: {
    fields: {
      event: { kind: 'string' },
      action: { kind: 'string' },
      enabled: { kind: 'boolean' },
    },
  },
})

export const GuestPrefabSource = defineComponent<{
  prefabId: string
  label: string
}>('GuestPrefabSource', {
  defaults: { prefabId: '', label: '' },
  schema: {
    fields: {
      prefabId: { kind: 'string' },
      label: { kind: 'string' },
    },
  },
})

export const GuestDebugProbe = defineComponent<{
  notes: string
  lastEditorUser: string
}>('GuestDebugProbe', {
  defaults: { notes: '', lastEditorUser: 'local-dev' },
  schema: {
    fields: {
      notes: { kind: 'string' },
      lastEditorUser: { kind: 'string' },
    },
  },
})

export const GuestRenderable = defineComponent<{
  slot: 'stage' | 'hud'
  layer: number
}>('GuestRenderable', {
  defaults: { slot: 'stage', layer: 0 },
  schema: {
    fields: {
      slot: { kind: 'enum', options: ['stage', 'hud'] },
      layer: { kind: 'number', step: 1 },
    },
  },
})

export const SelectGuestEntityEvent = defineEvent<{ guestEntityId: Entity | null }>('Studio.SelectGuestEntity')
export const HoverGuestEntityEvent = defineEvent<{ guestEntityId: Entity | null }>('Studio.HoverGuestEntity')
export const EditComponentFieldEvent = defineEvent<{
  guestEntityId: Entity
  componentName: string
  field: string
  value: unknown
}>('Studio.EditComponentField')
export const ApplyPrefabEvent = defineEvent<{ prefabId: string; x?: number; y?: number }>('Studio.ApplyPrefab')
export const SaveSceneEvent = defineEvent<{ name?: string }>('Studio.SaveScene')
export const LoadSceneEvent = defineEvent<{ snapshot: WorldSnapshot }>('Studio.LoadScene')
export const StepGuestEvent = defineEvent<{ steps?: number; dt?: number }>('Studio.StepGuest')
export const SetPlaybackEvent = defineEvent<{ mode: PlaybackMode; speed?: number }>('Studio.SetPlayback')
export const ScrubToSnapshotEvent = defineEvent<{ cursor: number }>('Studio.ScrubToSnapshot')
