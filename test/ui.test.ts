import { describe, expect, it } from 'vitest'
import { createDomecsStudio } from '../src/studio.js'
import { mountStudio, renderStudioHtml } from '../src/ui.js'

interface Listener { (event: unknown): void }

// -----------------------------------------------------------------------------
// Fake `.stage` placeholder subtree, extending the fake-host pattern below
// with just enough of Document/Element for mountStage (src/stage.ts) to
// operate on: className/dataset/style/appendChild/removeChild/remove. See
// test/stage.test.ts for the same shape used against mountStage directly;
// this copy plugs into fakeHost's `innerHTML` setter instead, so the
// sequencing test below can exercise mountStudio's actual
// app.querySelector('[data-stage-mount]') re-mount path.
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

class FakeStageElement {
  className = ''
  dataset: Record<string, string> = {}
  children: FakeStageElement[] = []
  parentNode: FakeStageElement | null = null
  style = new FakeStyle()

  constructor(public tagName: string, public ownerDocument: FakeStageDocument) {}

  appendChild(child: FakeStageElement): FakeStageElement {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child: FakeStageElement): FakeStageElement {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }

  remove(): void {
    this.parentNode?.removeChild(this)
  }
}

class FakeStageDocument {
  createElement(tagName: string): FakeStageElement {
    return new FakeStageElement(tagName, this)
  }
}

function fakeHost() {
  const listeners = new Map<string, Listener[]>()
  let writes = 0
  let html = ''
  const doc = new FakeStageDocument()
  // A real `element.innerHTML = html` reassignment discards every existing
  // descendant and parses a brand-new subtree — a bare string store cannot
  // reproduce that, so whenever the written markup contains
  // renderStudioHtml's empty `data-stage-mount` placeholder, mint a *new*
  // FakeStageElement standing in for it (a distinct object identity every
  // rewrite, exactly like a real reparse), so mountStudio's
  // app.querySelector('[data-stage-mount]') re-mount-on-rewrite path is
  // exercised for real rather than mocked out.
  let stageMount: FakeStageElement | null = null
  return {
    writes: () => writes,
    html: () => html,
    stageMount: () => stageMount,
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    element: {
      get innerHTML() { return html },
      set innerHTML(next: string) {
        writes += 1
        html = next
        stageMount = next.includes('data-stage-mount') ? doc.createElement('div') : null
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

function fakeElement(data: Record<string, string>) {
  const dataset: Record<string, string> = {}
  for (const [attr, value] of Object.entries(data)) {
    dataset[attr.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value
  }
  const el = {
    dataset,
    closest(selector: string) {
      const match = /^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector)
      if (!match) return null
      const key = match[1]!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      if (!(key in dataset)) return null
      if (match[2] !== undefined && dataset[key] !== match[2]) return null
      return el
    },
  }
  return el as unknown as HTMLElement
}

describe('studio ui mount', () => {
  it('renders markup for the studio shell', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    expect(renderStudioHtml(studio)).toContain('studio-shell')
  })

  it('does not rewrite the DOM when nothing changed', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)

    expect(host.writes()).toBe(1)

    // Simulate many idle editor ticks: state is unchanged, so the DOM must be
    // left alone — rewriting it mid-gesture destroys the element the user is
    // clicking and swallows the click.
    for (let i = 0; i < 30; i += 1) ui.render()
    expect(host.writes()).toBe(1)
  })

  it('rewrites the DOM when studio state actually changes', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)

    studio.stepGuest(1)
    studio.sync()
    ui.render()
    expect(host.writes()).toBe(2)
  })

  it('renders the stage as an empty placeholder, never inline sprite markup', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const html = renderStudioHtml(studio)
    expect(html).toContain('data-stage-mount')
    expect(html).not.toContain('class="sprite')
  })

  it('mounts stage sprites into the placeholder immediately on initial render', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const host = fakeHost()
    mountStudio(host.element, studio)

    expect(host.stageMount()?.children.length).toBe(3)
  })

  it('keeps the stage correctly populated across an outer rewrite immediately followed by a guest tick', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestEntityCount: 3 })
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)

    const mountBefore = host.stageMount()!
    expect(mountBefore.children.length).toBe(3)

    // An outer rewrite unrelated to the stage: toggling Play changes the
    // transport button's label/data-play value, so renderStudioHtml's
    // memoized string differs and app.innerHTML is reassigned — which, in a
    // real DOM, destroys the previous `.stage` placeholder (and every
    // sprite element mountStage was tracking) along with everything else.
    host.dispatch('click', { target: fakeElement({ play: 'playing' }) })

    const mountAfterRewrite = host.stageMount()!
    expect(mountAfterRewrite).not.toBe(mountBefore)
    // Repainted immediately after the rewrite, not left empty until the
    // next guest tick (which may never come while paused).
    expect(mountAfterRewrite.children.length).toBe(3)

    // Immediately followed by a guest tick — mirrors main.ts's
    // studio.guestWorld.signals.tickEnd subscription (sync() + render() +
    // patchStage()), independent of whether render()'s own memoized
    // comparison decides another outer rewrite is needed this frame.
    studio.stepGuest(1)
    studio.sync()
    ui.render()
    ui.patchStage()

    const mountAfterTick = host.stageMount()!
    const expectedIds = studio.guestWorld.snapshot().entities.map((entity) => String(entity.id)).sort()
    const renderedIds = mountAfterTick.children.map((child) => child.dataset.entity).sort()
    expect(renderedIds).toEqual(expectedIds)
    for (const child of mountAfterTick.children) {
      expect(child.style.getPropertyValue('--x')).toMatch(/px$/)
    }
  })
})
