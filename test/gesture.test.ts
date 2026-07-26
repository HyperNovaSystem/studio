import { describe, expect, it } from 'vitest'
import { clientToWorld, createDragState } from '../src/gesture.js'

describe('clientToWorld', () => {
  it('converts a client point to world coordinates using the stage rect, per style.css', () => {
    // Pinned concrete example, derived from the real .stage/.sprite rules in
    // src/style.css (see gesture.ts's doc comment): `.stage` establishes the
    // containing block, `.sprite` is `left: 50%; top: 50%; transform:
    // translate(var(--x), var(--y)) ...` with `--x`/`--y` set to plain px
    // offsets — so a sprite's screen position is the stage's own center plus
    // its GuestTransform x/y, unscaled.
    const stageRect = { left: 100, top: 50, width: 400, height: 300 }

    // Stage center in screen space is (100 + 200, 50 + 150) = (300, 200).
    expect(clientToWorld(stageRect, 300, 200)).toEqual({ x: 0, y: 0 })

    // A point 20px right and 10px down from center.
    expect(clientToWorld(stageRect, 320, 210)).toEqual({ x: 20, y: 10 })

    // A point up and to the left of center.
    expect(clientToWorld(stageRect, 80, 20)).toEqual({ x: -220, y: -180 })
  })

  it('round-trips: stage-center-relative offset in equals the same offset out, regardless of stage position', () => {
    const stageRect = { left: 733, top: -41, width: 600, height: 240 }
    const centerX = stageRect.left + stageRect.width / 2
    const centerY = stageRect.top + stageRect.height / 2
    expect(clientToWorld(stageRect, centerX + 15, centerY - 7)).toEqual({ x: 15, y: -7 })
  })
})

describe('createDragState', () => {
  it('starts with nothing being dragged', () => {
    const drag = createDragState()
    expect(drag.draggingEntity).toBeNull()
  })

  it('begin() records the entity, starting pointer world position, and starting transform', () => {
    const drag = createDragState()
    drag.begin(5, { x: 10, y: 20 }, { x: 100, y: 200 })

    expect(drag.draggingEntity).toBe(5)
    expect(drag.startWorld).toEqual({ x: 10, y: 20 })
    expect(drag.startTransform).toEqual({ x: 100, y: 200 })
  })

  it('moveTo() offsets the starting transform by the pointer delta since begin(), not incrementally', () => {
    const drag = createDragState()
    drag.begin(5, { x: 10, y: 20 }, { x: 100, y: 200 })

    // Pointer moved +5x, +0y from the start.
    expect(drag.moveTo({ x: 15, y: 20 })).toEqual({ x: 105, y: 200 })
    // A second move is still relative to the ORIGINAL start, not the
    // previous moveTo() result — dragging back to +0x,+5y from start yields
    // +0x,+5y on the transform, not a cumulative +5x,+5y.
    expect(drag.moveTo({ x: 10, y: 25 })).toEqual({ x: 100, y: 205 })
  })

  it('end() resets to the not-dragging state', () => {
    const drag = createDragState()
    drag.begin(5, { x: 10, y: 20 }, { x: 100, y: 200 })
    drag.end()

    expect(drag.draggingEntity).toBeNull()
    expect(drag.startWorld).toEqual({ x: 0, y: 0 })
    expect(drag.startTransform).toEqual({ x: 0, y: 0 })
  })

  it('moveTo() is a harmless no-op when nothing is being dragged', () => {
    const drag = createDragState()
    expect(drag.moveTo({ x: 999, y: 999 })).toEqual({ x: 0, y: 0 })
  })

  it('a second begin() after end() starts a fresh, independent drag', () => {
    const drag = createDragState()
    drag.begin(1, { x: 0, y: 0 }, { x: 0, y: 0 })
    drag.end()
    drag.begin(2, { x: 50, y: 50 }, { x: -30, y: 40 })

    expect(drag.draggingEntity).toBe(2)
    expect(drag.moveTo({ x: 60, y: 45 })).toEqual({ x: -20, y: 35 })
  })
})
