import { describe, expect, it } from 'vitest'
import { createDomecsStudio } from '../src/studio.js'
import { mountStage } from '../src/stage.js'

// -----------------------------------------------------------------------------
// Minimal DOM-like fake — not jsdom. Just enough of Document/Element to
// exercise mountStage's createElement/appendChild/removeChild calls: a
// className string, a `dataset` bag, a `style` with setProperty/
// getPropertyValue, and a parent/child list wired through appendChild/
// removeChild/remove so element identity (===) can be asserted across
// patch() calls, same as test/ui.test.ts's fakeHost pattern for the outer
// shell (no jsdom there either).
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

class FakeElement {
  className = ''
  dataset: Record<string, string> = {}
  children: FakeElement[] = []
  parentNode: FakeElement | null = null
  style = new FakeStyle()

  constructor(public tagName: string, public ownerDocument: FakeDocument) {}

  appendChild(child: FakeElement): FakeElement {
    this.ownerDocument.counts.appendChild += 1
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child: FakeElement): FakeElement {
    this.ownerDocument.counts.removeChild += 1
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }

  remove(): void {
    this.parentNode?.removeChild(this)
  }
}

class FakeDocument {
  counts = { createElement: 0, appendChild: 0, removeChild: 0 }

  createElement(tagName: string): FakeElement {
    this.counts.createElement += 1
    return new FakeElement(tagName, this)
  }
}

function fakeStageHost(): { host: HTMLElement; doc: FakeDocument } {
  const doc = new FakeDocument()
  const host = new FakeElement('div', doc)
  return { host: host as unknown as HTMLElement, doc }
}

function childOf(host: HTMLElement, entityId: number): FakeElement | undefined {
  return (host as unknown as FakeElement).children.find((child) => child.dataset.entity === String(entityId))
}

// -----------------------------------------------------------------------------

describe('mountStage', () => {
  it('touches zero DOM nodes when patching an unchanged world', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host, doc } = fakeStageHost()
    const stage = mountStage(host, studio)

    stage.patch()
    expect(doc.counts.createElement).toBe(3)
    expect(doc.counts.appendChild).toBe(3)
    expect(doc.counts.removeChild).toBe(0)

    doc.counts.createElement = 0
    doc.counts.appendChild = 0

    // Repeated patch()es against a world nothing has touched must be a
    // complete no-op at the DOM level — this is the "clicks survive
    // playback" property: no create, no append, no remove.
    for (let i = 0; i < 5; i += 1) stage.patch()

    expect(doc.counts.createElement).toBe(0)
    expect(doc.counts.appendChild).toBe(0)
    expect(doc.counts.removeChild).toBe(0)
  })

  it('updates style on the SAME element instance when a sprite moves', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host } = fakeStageHost()
    const stage = mountStage(host, studio)
    stage.patch()

    const id = studio.guestWorld.snapshot().entities[0]!.id
    const before = childOf(host, id)!

    studio.editField(id, 'GuestTransform', 'x', 250)
    stage.patch()

    const after = childOf(host, id)!
    expect(after).toBe(before)
    expect(after.style.getPropertyValue('--x')).toBe('250px')
  })

  it('mounts a newly spawned entity with the correct data-entity', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host } = fakeStageHost()
    const stage = mountStage(host, studio)
    stage.patch()

    const newId = studio.applyPrefab('prop.crate', 12, 34)
    expect(newId).not.toBeNull()
    stage.patch()

    const created = childOf(host, newId!)
    expect(created).toBeDefined()
    expect(created!.className).toBe('sprite prop')
    expect(created!.style.getPropertyValue('--x')).toBe('12px')
  })

  it('removes a hidden entity element from the DOM', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host, doc } = fakeStageHost()
    const stage = mountStage(host, studio)
    stage.patch()

    const id = studio.guestWorld.snapshot().entities[1]!.id
    expect(childOf(host, id)).toBeDefined()

    studio.editField(id, 'GuestSprite', 'visible', false)
    stage.patch()

    expect(childOf(host, id)).toBeUndefined()
    expect(doc.counts.removeChild).toBe(1)
  })

  it('removes a despawned entity element from the DOM', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host } = fakeStageHost()
    const stage = mountStage(host, studio)
    stage.patch()

    const id = studio.guestWorld.snapshot().entities[2]!.id
    expect(childOf(host, id)).toBeDefined()

    studio.guestWorld.despawn(id)
    stage.patch()

    expect(childOf(host, id)).toBeUndefined()
  })

  it('only touches the class when kind changes, leaving other sprites alone', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const { host } = fakeStageHost()
    const stage = mountStage(host, studio)
    stage.patch()

    const [a, b] = studio.guestWorld.snapshot().entities.map((entity) => entity.id) as [number, number]
    const untouched = childOf(host, b)!

    studio.editField(a, 'GuestSprite', 'kind', 'enemy')
    stage.patch()

    expect(childOf(host, a)!.className).toBe('sprite enemy')
    expect(childOf(host, b)).toBe(untouched)
  })
})
