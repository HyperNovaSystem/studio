import { describe, expect, it, vi } from 'vitest'
import { createWorld } from '@domecs/core'
import { setParent } from '@domecs/scene'
import { createDomecsStudio } from '../src/studio.js'
import { mountStudio } from '../src/ui.js'
import { GuestTransform, PlaybackState } from '../src/components.js'

interface Listener { (event: unknown): void }

// -----------------------------------------------------------------------------
// Fake host for pointer/keyboard gesture wiring (M9), extending the pattern
// test/ui.test.ts and test/stage.test.ts already established for M8 (no
// jsdom anywhere in this codebase — see vitest env: 'node'). Two additions
// over those fakes, both needed specifically for gesture wiring:
//
//   1. `getBoundingClientRect()` on every element, so `ui.ts`'s
//      `stageRectOf()` (-> gesture.ts's `clientToWorld`) has something real
//      to call. Configurable per test via `setRect`.
//   2. A `closest()` that actually WALKS the parent chain (not just
//      self-match), because a sprite element is a CHILD of the
//      `[data-stage-mount]` container, and both "resolve the sprite via
//      closest('[data-entity]')" and "empty-stage click via
//      closest('[data-stage-mount]')" need real ancestor walking to be
//      exercised meaningfully (ui.test.ts's/panels.test.ts's `fakeElement`
//      only ever matched itself, since every click target there WAS the
//      exact control under test).
// -----------------------------------------------------------------------------

class FakeStyle {
  private props = new Map<string, string>()
  setProperty(name: string, value: string): void {
    this.props.set(name, value)
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? ''
  }
}

class FakeRect {
  constructor(
    public left: number,
    public top: number,
    public width: number,
    public height: number,
  ) {}
}

class FakeElement {
  className = ''
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  parentNode: FakeElement | null = null
  style = new FakeStyle()
  focusCalls = 0
  private rect = new FakeRect(0, 0, 0, 0)

  constructor(public tagName: string, public ownerDocument: FakeDocument) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }

  remove(): void {
    this.parentNode?.removeChild(this)
  }

  focus(): void {
    this.focusCalls += 1
  }

  setRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = new FakeRect(rect.left, rect.top, rect.width, rect.height)
  }

  getBoundingClientRect(): FakeRect {
    return this.rect
  }

  // A real `Element.closest` checks the element itself, then walks
  // `parentElement` upward. Supports the plain `[data-x]` / `[data-x="y"]`
  // selectors this app's delegation exclusively uses.
  closest(selector: string): FakeElement | null {
    const match = /^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector)
    if (!match) return null
    const key = match[1]!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    const expected = match[2]
    let node: FakeElement | null = this
    while (node) {
      if (key in node.dataset && (expected === undefined || node.dataset[key] === expected)) return node
      node = node.parentNode
    }
    return null
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this)
  }
}

function fakeHost() {
  const listeners = new Map<string, Listener[]>()
  let html = ''
  const doc = new FakeDocument()
  let stageMount: FakeElement | null = null
  return {
    html: () => html,
    stageMount: () => stageMount,
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    element: {
      get innerHTML() {
        return html
      },
      set innerHTML(next: string) {
        html = next
        // Real `element.innerHTML = html` reparses a brand-new subtree — a
        // fresh FakeElement standing in for the `[data-stage-mount]`
        // placeholder reproduces that "new object identity every rewrite"
        // property, same as ui.test.ts's fakeHost. Real layout, though,
        // positions `.stage` by CSS grid (style.css's `.viewport { grid-column:
        // 2; }`), which does not depend on DOM node identity — a freshly
        // reparsed `.stage` in the same grid cell reports the SAME
        // `getBoundingClientRect()` a real browser would have measured for
        // the old one. Carry the previous rect forward onto the new instance
        // so a rewrite mid-test (e.g. selecting an entity changes the tree
        // row's `.selected` class and inspector content, forcing exactly
        // this kind of rewrite) doesn't silently reset stage geometry to
        // (0,0,0,0) the way a naive "always a fresh, unconfigured element"
        // fake would.
        const previousRect = stageMount ? stageMount.getBoundingClientRect() : null
        if (next.includes('data-stage-mount')) {
          stageMount = doc.createElement('div')
          stageMount.dataset.stageMount = ''
          if (previousRect) stageMount.setRect(previousRect)
        } else {
          stageMount = null
        }
      },
      addEventListener(type: string, listener: Listener) {
        const bucket = listeners.get(type) ?? []
        bucket.push(listener)
        listeners.set(type, bucket)
      },
      querySelector(selector: string) {
        return selector === '[data-stage-mount]' ? stageMount : null
      },
    } as unknown as HTMLElement,
  }
}

function fakeControl(data: Record<string, string>, value = ''): HTMLElement {
  const el = new FakeElement('div', new FakeDocument())
  for (const [attr, v] of Object.entries(data)) {
    el.dataset[attr.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v
  }
  ;(el as unknown as { value: string }).value = value
  return el as unknown as HTMLElement
}

function fakeInput(tagName: 'INPUT' | 'TEXTAREA' | 'SELECT'): HTMLElement {
  const el = new FakeElement(tagName, new FakeDocument())
  return el as unknown as HTMLElement
}

// A default 400x300 stage sitting at viewport (100, 50), matching
// gesture.test.ts's pinned example exactly — center is (300, 200).
const STAGE_RECT = { left: 100, top: 50, width: 400, height: 300 }

function setupWithSprites(entityCount = 3) {
  const studio = createDomecsStudio({ headless: true, ringCapacity: 32, guestEntityCount: entityCount })
  const host = fakeHost()
  const ui = mountStudio(host.element, studio)
  const stageMount = host.stageMount()!
  stageMount.setRect(STAGE_RECT)
  return { studio, host, ui, stageMount }
}

function spriteFor(stageMount: FakeElement, id: number): FakeElement {
  const el = stageMount.children.find((c) => c.dataset.entity === String(id))
  if (!el) throw new Error(`no sprite for entity ${id}`)
  return el
}

// -----------------------------------------------------------------------------

describe('viewport pointer: pick / deselect', () => {
  it('pointerdown on a sprite selects that entity', () => {
    const { studio, host, stageMount } = setupWithSprites()
    const id = studio.guestWorld.snapshot().entities[0]!.id
    const spriteEl = spriteFor(stageMount, id)

    host.dispatch('pointerdown', { clientX: 320, clientY: 210, target: spriteEl })

    const playback = studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!
    expect(playback.selectedGuestEntity).toBe(id)
  })

  it('pointerdown on the empty stage background deselects', () => {
    const { studio, host, stageMount } = setupWithSprites()
    const id = studio.guestWorld.snapshot().entities[0]!.id
    studio.select(id)
    expect(studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!.selectedGuestEntity).toBe(id)

    host.dispatch('pointerdown', { clientX: 300, clientY: 200, target: stageMount })

    expect(studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!.selectedGuestEntity).toBeNull()
  })

  it('pointerdown on a sprite focuses the stage element (for keyboard shortcuts to reach it)', () => {
    const { studio, host, stageMount } = setupWithSprites()
    const id = studio.guestWorld.snapshot().entities[0]!.id
    const spriteEl = spriteFor(stageMount, id)

    host.dispatch('pointerdown', { clientX: 320, clientY: 210, target: spriteEl })

    expect(stageMount.focusCalls).toBe(1)
  })
})

describe('viewport pointer: drag', () => {
  it('a drag gesture writes the dragged entity\'s local GuestTransform and pushes history exactly once', () => {
    const { studio, host, stageMount } = setupWithSprites()
    const id = studio.guestWorld.snapshot().entities[0]!.id
    const spriteEl = spriteFor(stageMount, id)
    const before = { ...studio.guestWorld.getComponent(id, GuestTransform)! }

    const pushSpy = vi.spyOn(studio.bridge.history!, 'push')

    // Stage center is (300, 200) per STAGE_RECT: clientX/Y 320,210 -> world
    // (20, 10) — matches gesture.test.ts's pinned example.
    host.dispatch('pointerdown', { clientX: 320, clientY: 210, target: spriteEl })

    // Measure the push-count delta from HERE, not from before pointerdown:
    // select() (called by pointerdown, above) always advances editorWorld by
    // one tick, which — ONLY while PlaybackState.mode is 'playing' — also
    // side-effects a guestWorld tick (studio.ts's studio.playback.tick
    // system) and therefore a history.push() of its own; that is pre-existing
    // engine/app coupling unrelated to the drag feature under test here (see
    // the "identical paused/playing" test below, which isolates it deliberately).
    const pushesAtDragStart = pushSpy.mock.calls.length

    // Several moves — must NOT push per move (the specific, easy-to-get-wrong
    // requirement from PLAN.md).
    host.dispatch('pointermove', { clientX: 330, clientY: 210, target: spriteEl })
    host.dispatch('pointermove', { clientX: 340, clientY: 215, target: spriteEl })
    host.dispatch('pointermove', { clientX: 350, clientY: 220, target: spriteEl })
    expect(pushSpy.mock.calls.length).toBe(pushesAtDragStart)

    // Delta from the pointerdown grab point (20,10) to the last move point
    // (350-100-200, 220-50-150) = (50, 20) is (+30, +10).
    const after = studio.guestWorld.getComponent(id, GuestTransform)!
    expect(after.x).toBe(before.x + 30)
    expect(after.y).toBe(before.y + 10)

    host.dispatch('pointerup', {})

    expect(pushSpy.mock.calls.length).toBe(pushesAtDragStart + 1)
  })

  it('drag behaves identically whether PlaybackState.mode is "paused" or "playing"', () => {
    for (const mode of ['paused', 'playing'] as const) {
      const { studio, host, stageMount } = setupWithSprites()
      studio.setPlayback(mode)
      const id = studio.guestWorld.snapshot().entities[0]!.id
      const spriteEl = spriteFor(stageMount, id)
      const before = { ...studio.guestWorld.getComponent(id, GuestTransform)! }
      const pushSpy = vi.spyOn(studio.bridge.history!, 'push')

      host.dispatch('pointerdown', { clientX: 320, clientY: 210, target: spriteEl })
      const pushesAtDragStart = pushSpy.mock.calls.length

      host.dispatch('pointermove', { clientX: 340, clientY: 220, target: spriteEl })
      const moved = studio.guestWorld.getComponent(id, GuestTransform)!
      expect(moved.x).toBe(before.x + 20)
      expect(moved.y).toBe(before.y + 10)
      expect(pushSpy.mock.calls.length).toBe(pushesAtDragStart)

      host.dispatch('pointerup', {})
      expect(pushSpy.mock.calls.length).toBe(pushesAtDragStart + 1)

      expect(studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!.mode).toBe(mode)
    }
  })

  it('a pointermove with nothing being dragged is a harmless no-op', () => {
    const { studio, host, stageMount } = setupWithSprites()
    const id = studio.guestWorld.snapshot().entities[0]!.id
    const before = { ...studio.guestWorld.getComponent(id, GuestTransform)! }

    host.dispatch('pointermove', { clientX: 999, clientY: 999, target: stageMount })

    expect(studio.guestWorld.getComponent(id, GuestTransform)!).toEqual(before)
  })
})

describe('viewport palette: spawn at stage center', () => {
  it('clicking the viewport spawn button creates an entity at world (0, 0) — the stage center — and selects it', () => {
    // A truly empty custom guestWorld (createDemoGuestWorld, used when no
    // guestWorld is supplied, always spawns one unconditional "Player"
    // entity regardless of guestEntityCount — see studio.ts) keeps this
    // assertion focused on exactly the one entity this test spawns.
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    mountStudio(host.element, studio)
    expect(studio.guestWorld.snapshot().entities).toHaveLength(0)

    host.dispatch('change', { target: fakeControl({ 'viewport-spawn-type': '' }, 'prop.crate') })
    host.dispatch('click', { target: fakeControl({ 'viewport-spawn': '' }) })

    const entities = studio.guestWorld.snapshot().entities
    expect(entities).toHaveLength(1)
    const spawned = entities[0]!
    expect(studio.guestWorld.getComponent(spawned.id, GuestTransform)).toMatchObject({ x: 0, y: 0 })
    expect(studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!.selectedGuestEntity).toBe(spawned.id)
  })
})

describe('viewport keyboard: delete / duplicate', () => {
  it('Delete despawns a childless selected entity immediately', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 1 })
    const host = fakeHost()
    mountStudio(host.element, studio)
    const id = studio.guestWorld.snapshot().entities[0]!.id
    studio.select(id)

    host.dispatch('keydown', { key: 'Delete', target: fakeControl({}), preventDefault() {} })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === id)).toBe(false)
  })

  it('Backspace on a selected entity WITH children shows the confirm step rather than despawning immediately, honoring the same two-step flow the tree row uses', () => {
    // An empty custom guestWorld (rather than the demo scene) keeps this
    // focused on exactly the parent/child pair the test creates — same
    // pattern test/panels.test.ts's hierarchy suite uses.
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)
    const parentId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const childId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    expect(setParent(studio.guestWorld, childId, parentId).ok).toBe(true)
    studio.sync()
    studio.select(parentId)
    ui.render()

    host.dispatch('keydown', { key: 'Backspace', target: fakeControl({}), preventDefault() {} })

    // Not despawned yet — the SAME confirm affordance the tree row's delete
    // button shows (requestDespawn, shared by both call sites) appears in
    // the tree panel's markup for this entity.
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === parentId)).toBe(true)
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === childId)).toBe(true)
    expect(host.html()).toContain('1 child')
    expect(host.html()).toContain(`data-confirm-despawn="${parentId}"`)

    host.dispatch('click', { target: fakeControl({ 'confirm-despawn': String(parentId) }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === parentId)).toBe(false)
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === childId)).toBe(false)
  })

  it('Delete/Backspace is ignored while an input/textarea/select has focus, so text editing is never interrupted', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 1 })
    const host = fakeHost()
    mountStudio(host.element, studio)
    const id = studio.guestWorld.snapshot().entities[0]!.id
    studio.select(id)

    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT'] as const) {
      host.dispatch('keydown', { key: 'Delete', target: fakeInput(tag), preventDefault() {} })
    }

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === id)).toBe(true)
  })

  it('Ctrl+D duplicates the selected entity with a +16,+16 offset and selects the copy', () => {
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    mountStudio(host.element, studio)
    const id = studio.catalog.spawnFromType('prop.crate', 5, 9)!
    studio.sync()
    studio.select(id)

    host.dispatch('keydown', { key: 'd', ctrlKey: true, target: fakeControl({}), preventDefault() {} })

    const entities = studio.guestWorld.snapshot().entities
    expect(entities).toHaveLength(2)
    const copy = entities.find((e) => e.id !== id)!
    const copyTransform = studio.guestWorld.getComponent(copy.id, GuestTransform)!
    expect(copyTransform.x).toBe(5 + 16)
    expect(copyTransform.y).toBe(9 + 16)
    expect(studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!.selectedGuestEntity).toBe(copy.id)
  })

  it('Cmd+D (metaKey) also duplicates, for macOS parity', () => {
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    mountStudio(host.element, studio)
    const id = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    studio.select(id)

    host.dispatch('keydown', { key: 'd', metaKey: true, target: fakeControl({}), preventDefault() {} })

    expect(studio.guestWorld.snapshot().entities).toHaveLength(2)
  })

  it('Delete/Ctrl+D are no-ops when nothing is selected', () => {
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    mountStudio(host.element, studio)
    studio.select(null)

    host.dispatch('keydown', { key: 'Delete', target: fakeControl({}), preventDefault() {} })
    host.dispatch('keydown', { key: 'd', ctrlKey: true, target: fakeControl({}), preventDefault() {} })

    expect(studio.guestWorld.snapshot().entities).toHaveLength(0)
  })
})
