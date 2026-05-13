import type { Plugin, World, WorldSnapshot } from 'domecs'
import { SnapshotRingBuffer } from './snapshot-ring.js'

export interface StudioPluginBridge {
  ring: SnapshotRingBuffer
  overlayRenderPasses: number
  snapshotsCaptured: number
  redactedSnapshots: number
}

export function createStudioPluginBridge(capacity = 3600): StudioPluginBridge {
  return {
    ring: new SnapshotRingBuffer(capacity),
    overlayRenderPasses: 0,
    snapshotsCaptured: 0,
    redactedSnapshots: 0,
  }
}

export function redactDevOnlyState(snapshot: WorldSnapshot): WorldSnapshot {
  let redacted = false
  const entities = snapshot.entities
    .map((entity) => {
      if (!('GuestDebugProbe' in entity.components)) return entity
      redacted = true
      const components = { ...entity.components }
      delete components.GuestDebugProbe
      return { ...entity, components }
    })
    .filter((entity) => Object.keys(entity.components).length > 0)
  return redacted ? { ...snapshot, entities } : snapshot
}

export function createDomecsStudioPlugin(bridge: StudioPluginBridge): Plugin {
  return {
    name: 'domecs-studio',
    provides: ['studio-inspector'],
    install(world: World) {
      bridge.ring.push(redactDevOnlyState(world.snapshot()))
      bridge.snapshotsCaptured += 1
      return {
        onRender() {
          bridge.overlayRenderPasses += 1
        },
        onTickEnd(guestWorld) {
          bridge.ring.push(guestWorld.snapshot())
          bridge.snapshotsCaptured += 1
        },
        onSnapshot(snapshot) {
          const before = JSON.stringify(snapshot)
          const next = redactDevOnlyState(snapshot as WorldSnapshot)
          if (JSON.stringify(next) !== before) bridge.redactedSnapshots += 1
          return next
        },
      }
    },
  }
}
