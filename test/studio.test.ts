import { describe, expect, it } from 'vitest'
import { Has } from '@domecs/core'
import {
  ComponentInspector,
  EditorPanel,
  EntityTreeNode,
  GuestDebugProbe,
  GuestHealth,
  GuestName,
  GuestReference,
  GuestTransform,
  InspectorField,
  PlaybackState,
  PrefabAsset,
  SceneDocument,
  StudioRoot,
  TimeTravelScrubber,
  ViewProjection,
  VisualScriptBinding,
  createDemoGuestWorld,
  createDomecsStudio,
} from '../src/index.js'

describe('DOMECS Studio exemplar', () => {
  it('runs an editor world and a guest world side-by-side without shared mutable state', () => {
    const studio = createDomecsStudio({ seed: 1, headless: true, guestEntityCount: 32 })

    expect(studio.editorWorld).not.toBe(studio.guestWorld)
    expect(studio.editorWorld.query(Has(StudioRoot)).size).toBe(1)
    expect(studio.editorWorld.query(Has(EditorPanel)).size).toBe(6)
    expect(studio.editorWorld.query(Has(EntityTreeNode)).size).toBe(32)
    expect(studio.guestWorld.query(Has(GuestName)).size).toBe(32)

    const root = studio.editorWorld.getComponent(studio.studioId, StudioRoot)!
    expect(root.pluginInstalled).toBe(true)
    expect(root.editorEntityCount).toBeGreaterThanOrEqual(200)
    expect(root.guestEntityCount).toBe(32)
    expect(studio.editorWorld.componentTypes().map((type) => type.name)).toContain('StudioRoot')
    expect(studio.guestWorld.componentTypes().map((type) => type.name)).toContain('GuestTransform')
  })

  it('reflects guest component schemas and builds inspector widgets from field metadata', () => {
    const studio = createDomecsStudio({ seed: 2, headless: true, guestEntityCount: 12 })
    const firstGuest = studio.guestWorld.snapshot().entities[0]!.id

    studio.select(firstGuest)

    const schemas = studio.reflectedSchemas()
    expect(schemas.map((schema) => schema.name)).toContain('GuestTransform')
    expect(schemas.find((schema) => schema.name === 'GuestTransform')?.fields.x?.type).toBe('number')
    expect(studio.editorWorld.query(Has(ComponentInspector)).size).toBeGreaterThan(0)
    expect(studio.editorWorld.query(Has(InspectorField)).size).toBeGreaterThan(5)

    studio.editField(firstGuest, 'GuestTransform', 'x', 123)
    expect(studio.guestWorld.getComponent(firstGuest, GuestTransform)?.x).toBe(123)
    const doc = studio.editorWorld.getComponent(studio.sceneDocumentId, SceneDocument)!
    expect(doc.dirty).toBe(true)
  })

  it('keeps selection, hover, and highlight as editor-side components referencing guest entities', () => {
    const studio = createDomecsStudio({ seed: 3, headless: true, guestEntityCount: 8 })
    const ids = studio.guestWorld.snapshot().entities.map((entity) => entity.id)
    const selected = ids[1]!
    const hovered = ids[2]!

    studio.select(selected)
    studio.hover(hovered)

    const refs = Array.from(studio.editorWorld.entitiesWith(GuestReference)).map(({ value }) => value)
    expect(refs.find((ref) => ref.role === 'selected')?.guestEntityId).toBe(selected)
    expect(refs.find((ref) => ref.role === 'hovered')?.guestEntityId).toBe(hovered)
    expect(refs.find((ref) => ref.role === 'highlight')?.guestEntityId).toBe(hovered)
    expect(studio.visibleTree().some((row) => {
      const treeNode = row.EntityTreeNode as { selected: boolean; guestEntityId: number }
      return treeNode.selected && treeNode.guestEntityId === selected
    })).toBe(true)
  })

  it('installs as a guest-world plugin with render and snapshot lifecycle hooks', () => {
    const guestWorld = createDemoGuestWorld({ seed: 4, headless: true, entityCount: 10 })
    const studio = createDomecsStudio({ seed: 4, headless: true, guestWorld, ringCapacity: 16 })

    expect(() => guestWorld.capability('studio-inspector')).not.toThrow()
    const beforeRender = studio.bridge.overlayRenderPasses
    guestWorld.step(1 / 60)
    expect(studio.bridge.overlayRenderPasses).toBeGreaterThan(beforeRender)
    expect(studio.bridge.snapshotsCaptured).toBeGreaterThanOrEqual(2)

    const serialized = JSON.stringify(guestWorld.snapshot())
    expect(guestWorld.query(Has(GuestDebugProbe)).size).toBe(1)
    expect(serialized).not.toContain('GuestDebugProbe')
    expect(studio.bridge.redactedSnapshots).toBeGreaterThanOrEqual(1)
  })

  it('uses a bounded diff snapshot ring for time-travel scrubbing', () => {
    const studio = createDomecsStudio({ seed: 5, headless: true, guestEntityCount: 18, ringCapacity: 8 })
    const tracked = studio.guestWorld.snapshot().entities[0]!.id

    for (let i = 0; i < 20; i++) studio.stepGuest(1, 1 / 60)

    const scrubber = studio.editorWorld.getComponent(studio.scrubberId, TimeTravelScrubber)!
    expect(scrubber.length).toBe(8)
    expect(scrubber.fullSnapshotBytes).toBeGreaterThan(scrubber.compactBytes)
    expect(studio.memoryRatio()).toBeLessThan(1)

    studio.editField(tracked, 'GuestTransform', 'x', 321)
    studio.stepGuest(1, 1 / 60)
    expect(studio.guestWorld.getComponent(tracked, GuestTransform)?.x).toBeGreaterThanOrEqual(321)

    studio.scrub(0)
    expect(studio.guestWorld.getComponent(tracked, GuestTransform)?.x).not.toBe(321)
  })

  it('supports prefab library, visual script binding, scene save, and viewport projections', () => {
    const studio = createDomecsStudio({ seed: 6, headless: true, guestEntityCount: 6 })
    const newId = studio.applyPrefab('enemy.spark', 77, -12)
    expect(newId).toEqual(expect.any(Number))

    studio.select(newId)
    expect(studio.guestWorld.getComponent(newId!, GuestHealth)?.max).toBe(6)
    expect(studio.editorWorld.query(Has(PrefabAsset)).size).toBeGreaterThanOrEqual(3)
    expect(studio.editorWorld.query(Has(VisualScriptBinding)).size).toBe(1)
    expect(studio.editorWorld.query(Has(ViewProjection)).size).toBeLessThanOrEqual(500)

    const snapshot = studio.saveScene('playground.scene.json')
    const doc = studio.editorWorld.getComponent(studio.sceneDocumentId, SceneDocument)!
    expect(doc.name).toBe('playground.scene.json')
    expect(doc.serializedBytes).toBe(JSON.stringify(snapshot).length)
    expect(doc.dirty).toBe(false)
  })

  it('play, pause, and step controls advance only the hosted guest simulation', () => {
    const studio = createDomecsStudio({ seed: 7, headless: true, guestEntityCount: 10 })
    const beforeGuestTick = studio.guestWorld.time.tick
    const beforeEditorTick = studio.editorWorld.time.tick

    studio.stepGuest(3, 1 / 60)
    expect(studio.guestWorld.time.tick).toBe(beforeGuestTick + 3)
    expect(studio.editorWorld.time.tick).toBe(beforeEditorTick + 1)

    studio.setPlayback('playing', 2)
    studio.editorWorld.step(1 / 60)
    const playback = studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!
    expect(playback.stepCount).toBeGreaterThanOrEqual(4)
    expect(studio.guestWorld.time.tick).toBeGreaterThan(beforeGuestTick + 3)
  })
})
