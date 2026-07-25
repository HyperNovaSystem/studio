import type { StudioRefs } from '../studio.js'
import type { UiState } from './state.js'

/**
 * Everything a panel's render/handle functions need. `render` is the
 * memoized, DOM-write-guarded `render()` from `mountStudio` — panels call it
 * after a mutation (directly for sync ones, inside a `.then()` for the async
 * project I/O calls) rather than writing to the DOM themselves.
 */
export interface PanelContext {
  studio: StudioRefs
  ui: UiState
  render: () => void
}

/**
 * Every guest-world/catalog mutation triggered from a panel happens outside
 * `StudioRefs`'s own event-driven systems (select/step/prefab/...), so the
 * editor-side projection (tree rows, inspector, counts) is not rebuilt
 * automatically — call this instead of a bare `render()` after any catalog
 * call, direct `guestWorld` spawn/despawn, or session open/save/new.
 */
export function syncAndRender(ctx: PanelContext): void {
  ctx.studio.sync()
  ctx.render()
}
