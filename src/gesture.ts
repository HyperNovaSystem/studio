import type { Entity } from '@domecs/core'

/**
 * The subset of `DOMRect` the coordinate math needs — deliberately not the
 * real `DOMRect` type, so callers (and tests) can pass a plain object
 * without a real DOM.
 */
export interface StageRect {
  left: number
  top: number
  width: number
  height: number
}

export interface WorldPoint {
  x: number
  y: number
}

/**
 * Converts a pointer event's client (viewport) coordinates into the same
 * coordinate space `GuestTransform.x`/`.y` (and the derived
 * `WorldTransform.x`/`.y`) use — derived from the actual `.stage`/`.sprite`
 * rules in `src/style.css`, not guessed:
 *
 * ```css
 * .stage { position: relative; ... }
 * .sprite {
 *   position: absolute; left: 50%; top: 50%;
 *   transform: translate(var(--x), var(--y)) rotate(var(--r));
 * }
 * ```
 *
 * `src/stage.ts` sets `--x`/`--y` to `${transform.x}px` / `${transform.y}px`
 * directly (no additional scale factor anywhere in the chain). `.stage` is
 * `position: relative`, so it is the containing block its `left/top: 50%`
 * children percentages resolve against. A sprite's on-screen reference
 * point is therefore:
 *
 * ```
 * screenX = stageRect.left + stageRect.width  / 2 + transform.x
 * screenY = stageRect.top  + stageRect.height / 2 + transform.y
 * ```
 *
 * Inverting for an arbitrary client point gives world coordinates directly:
 * subtract the stage's top-left and its half-extent (the CSS `50%` center
 * offset). world (0, 0) is therefore exactly the stage's geometric center —
 * used elsewhere (`src/ui.ts`'s viewport "spawn at center" control) as the
 * literal spawn point, no separate "center" concept needed.
 */
export function clientToWorld(stageRect: StageRect, clientX: number, clientY: number): WorldPoint {
  return {
    x: clientX - stageRect.left - stageRect.width / 2,
    y: clientY - stageRect.top - stageRect.height / 2,
  }
}

/**
 * Pure, DOM-independent drag state machine. Tracks which guest entity (if
 * any) is currently being dragged, the pointer's world position and the
 * entity's local `GuestTransform` position both captured at `begin()`, so
 * `moveTo()` can report the transform the entity SHOULD become as an
 * offset from those two fixed starting points — not incrementally from the
 * previous `moveTo()` call, and not a snap-to-pointer assignment (which
 * would ignore where within the sprite the user actually grabbed it).
 *
 * Framework-free by design (no DOM types anywhere in this file) so it is
 * trivially unit-testable — see `test/gesture.test.ts`.
 */
export interface DragState {
  readonly draggingEntity: Entity | null
  readonly startWorld: WorldPoint
  readonly startTransform: WorldPoint
  /** Begin a drag: records the pointer's starting world position and the entity's starting local transform. */
  begin(entity: Entity, startWorld: WorldPoint, startTransform: WorldPoint): void
  /**
   * Given the pointer's CURRENT world position, returns the local transform
   * the dragged entity should have. A no-op (returns the last known
   * `startTransform`) when nothing is being dragged. Does not mutate any
   * component itself — the caller (`src/ui.ts`) writes the result into
   * `GuestTransform`.
   */
  moveTo(currentWorld: WorldPoint): WorldPoint
  /** End the drag, resetting all tracked state. Idempotent when nothing is being dragged. */
  end(): void
}

export function createDragState(): DragState {
  let draggingEntity: Entity | null = null
  let startWorld: WorldPoint = { x: 0, y: 0 }
  let startTransform: WorldPoint = { x: 0, y: 0 }

  return {
    get draggingEntity(): Entity | null {
      return draggingEntity
    },
    get startWorld(): WorldPoint {
      return startWorld
    },
    get startTransform(): WorldPoint {
      return startTransform
    },
    begin(entity, world, transform): void {
      draggingEntity = entity
      startWorld = world
      startTransform = transform
    },
    moveTo(currentWorld): WorldPoint {
      if (draggingEntity === null) return { ...startTransform }
      return {
        x: startTransform.x + (currentWorld.x - startWorld.x),
        y: startTransform.y + (currentWorld.y - startWorld.y),
      }
    },
    end(): void {
      draggingEntity = null
      startWorld = { x: 0, y: 0 }
      startTransform = { x: 0, y: 0 }
    },
  }
}
