import type { Entity } from '@domecs/core'
import { GuestSprite, GuestTransform, WorldTransform } from './components.js'
import type { StudioRefs } from './studio.js'

export interface StageHandle {
  /**
   * Diff the live guest world against what was last painted and make the
   * minimum DOM changes necessary: create an element only for an entity that
   * newly qualifies, remove one only for an entity that no longer does, and
   * otherwise update just the style custom properties / class of the SAME
   * element instance. An entity whose sprite/transform values are unchanged
   * since the last call is never touched at all. This is what lets
   * mid-gesture pointer/click state on any sprite node survive a guest tick
   * — see FINDINGS.md, "A keyed/targeted patch of the .stage subtree...".
   */
  patch(): void
}

interface SpriteState {
  el: HTMLElement
  kind: string
  x: number
  y: number
  r: number
  tint: string
}

/**
 * Keyed DOM patcher for the `.stage` sprite subtree.
 *
 * `renderStudioHtml`/`mountStudio` render `.stage` as an empty
 * `[data-stage-mount]` placeholder only (no sprite markup ever appears in
 * that string) — this module owns everything inside it via a
 * `Map<Entity, HTMLElement>` of currently-mounted sprite nodes, keyed by
 * guest entity id.
 *
 * `stageHost` must be the CURRENT, live `.stage` container. If the caller's
 * own outer rewrite later destroys that container (a plain
 * `element.innerHTML = html` reassignment, as `mountStudio` does whenever
 * anything outside the stage changes), every element this instance created
 * is discarded along with it — this instance's Map would then be patching
 * detached nodes. The caller is responsible for calling `mountStage` again
 * against the fresh container in that case (see `mountStudio`'s
 * `ensureStageMounted`), not for reusing a stale instance.
 */
export function mountStage(stageHost: HTMLElement, studio: StudioRefs): StageHandle {
  const doc = stageHost.ownerDocument!
  const sprites = new Map<Entity, SpriteState>()

  function patch(): void {
    const seen = new Set<Entity>()

    for (const entity of studio.guestWorld.snapshot().entities) {
      const sprite = studio.guestWorld.getComponent(entity.id, GuestSprite)
      if (!sprite?.visible) continue
      // Render-ready value: composed down the guest Parent chain every tick
      // by @domecs/scene's composeTransforms (see studio.ts), not the
      // entity's own local GuestTransform. composeTransforms only runs on
      // the 'tick' schedule, so a just-spawned/just-loaded entity has no
      // WorldTransform yet until the guest world's next step — fall back to
      // the local GuestTransform then rather than rendering nothing (exactly
      // right for a root entity, since composeTransforms' own compose()
      // reduces to local when parentWorld is null; only briefly approximate
      // for an already-parented entity, self-healing on the next tick). Same
      // fallback renderStudioHtml used before this milestone extracted the
      // stage subtree — see FINDINGS.md, "WorldTransform is unpopulated
      // until the guest world's first tick".
      const transform = studio.guestWorld.getComponent(entity.id, WorldTransform) ?? studio.guestWorld.getComponent(entity.id, GuestTransform)
      if (!transform) continue

      seen.add(entity.id)
      const state = sprites.get(entity.id)
      if (!state) {
        const el = doc.createElement('div')
        el.dataset.entity = String(entity.id)
        el.className = `sprite ${sprite.kind}`
        el.style.setProperty('--x', `${transform.x}px`)
        el.style.setProperty('--y', `${transform.y}px`)
        el.style.setProperty('--r', `${transform.rotation}deg`)
        el.style.setProperty('--tint', sprite.tint)
        stageHost.appendChild(el)
        sprites.set(entity.id, { el, kind: sprite.kind, x: transform.x, y: transform.y, r: transform.rotation, tint: sprite.tint })
        continue
      }

      // Never recreate the element — its identity must survive from one
      // patch() call to the next, or mid-drag mouse capture / mid-click
      // state on it is lost exactly like the full-innerHTML rewrite this
      // module replaces. Only touch the specific style property / class
      // that actually changed.
      if (state.kind !== sprite.kind) {
        state.el.className = `sprite ${sprite.kind}`
        state.kind = sprite.kind
      }
      if (state.x !== transform.x) {
        state.el.style.setProperty('--x', `${transform.x}px`)
        state.x = transform.x
      }
      if (state.y !== transform.y) {
        state.el.style.setProperty('--y', `${transform.y}px`)
        state.y = transform.y
      }
      if (state.r !== transform.rotation) {
        state.el.style.setProperty('--r', `${transform.rotation}deg`)
        state.r = transform.rotation
      }
      if (state.tint !== sprite.tint) {
        state.el.style.setProperty('--tint', sprite.tint)
        state.tint = sprite.tint
      }
    }

    // Anything left in `sprites` that wasn't `seen` this pass no longer
    // qualifies (despawned, sprite hidden, or visible:false) — remove it
    // from both the DOM and the map. Every entity id not touched at all
    // above (still seen, still unchanged) is left completely alone.
    for (const [id, state] of sprites) {
      if (seen.has(id)) continue
      state.el.remove()
      sprites.delete(id)
    }
  }

  return { patch }
}
