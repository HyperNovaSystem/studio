import { ok, type Plugin, type WorldSnapshot } from '@domecs/core'
import type { SnapshotHistory } from '@domecs/persist'

export interface StudioPluginBridge {
  /**
   * Engine snapshot history over the guest world. Attached by
   * `createDomecsStudio` AFTER the plugin is installed, so the initial
   * checkpoint (`captureInitial`) flows through the plugin's `onSnapshot`
   * redaction hook.
   */
  history: SnapshotHistory | null
  overlayRenderPasses: number
  snapshotsCaptured: number
  redactedSnapshots: number
}

export function createStudioPluginBridge(): StudioPluginBridge {
  return {
    history: null,
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
    install() {
      return ok({
        onRender() {
          bridge.overlayRenderPasses += 1
        },
        onTickEnd() {
          if (!bridge.history) return
          bridge.history.push()
          bridge.snapshotsCaptured += 1
        },
        onSnapshot(snapshot: WorldSnapshot) {
          const before = JSON.stringify(snapshot)
          const next = redactDevOnlyState(snapshot)
          if (JSON.stringify(next) !== before) bridge.redactedSnapshots += 1
          return next
        },
      })
    },
  }
}
