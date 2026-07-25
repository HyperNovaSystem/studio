import { describe, expect, it } from 'vitest'
import { createDomecsStudio } from '../src/studio.js'
import { mountStudio, renderStudioHtml } from '../src/ui.js'
import { createMemoryProjectStore, createProjectSession, type ProjectDocument } from '../src/project.js'

// -----------------------------------------------------------------------------
// Same fake-host pattern as test/ui.test.ts (no jsdom): a bare object
// satisfying just the bits of the DOM interface mountStudio actually touches.
// `fakeElement` extends the pattern with a minimal `closest`/`dataset`/`value`
// stand-in so click/change delegation can be exercised without a real DOM —
// `closest` only ever needs to match the element itself here, since every
// production `target.closest('[data-x]')` call is invoked with `event.target`
// set directly to the control under test.
// -----------------------------------------------------------------------------

interface Listener { (event: unknown): void }

function fakeHost() {
  const listeners = new Map<string, Listener[]>()
  let writes = 0
  let html = ''
  return {
    writes: () => writes,
    html: () => html,
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    element: {
      get innerHTML() { return html },
      set innerHTML(next: string) { writes += 1; html = next },
      addEventListener(type: string, listener: Listener) {
        const bucket = listeners.get(type) ?? []
        bucket.push(listener)
        listeners.set(type, bucket)
      },
    } as unknown as HTMLElement,
  }
}

function toCamel(attr: string): string {
  return attr.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

interface FakeElementOptions {
  data?: Record<string, string>
  value?: string
  checked?: boolean
}

function fakeElement(opts: FakeElementOptions = {}) {
  const dataset: Record<string, string> = {}
  for (const [attr, value] of Object.entries(opts.data ?? {})) dataset[toCamel(attr)] = value
  const el = {
    dataset,
    value: opts.value ?? '',
    checked: opts.checked ?? false,
    closest(selector: string) {
      const match = /^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector)
      if (!match) return null
      const key = toCamel(match[1]!)
      if (!(key in dataset)) return null
      if (match[2] !== undefined && dataset[key] !== match[2]) return null
      return el
    },
  }
  return el as unknown as HTMLElement
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fixtureDoc(name: string): ProjectDocument {
  return {
    format: 'domecs-project',
    version: 1,
    meta: { name, modified: new Date(0).toISOString() },
    componentTypes: [],
    entityTypes: [],
    systems: [],
    scenes: [{ name: 'main', entities: [] }],
  }
}

// -----------------------------------------------------------------------------

describe('toolbar panel', () => {
  it('renders New/Open/Save/Save As controls, the project name, and a dirty marker', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const html = renderStudioHtml(studio)
    expect(html).toContain('data-project-new')
    expect(html).toContain('data-project-open')
    expect(html).toContain('data-project-save')
    expect(html).toContain('data-project-save-as')
    expect(html).toContain(studio.projectSession.doc.meta.name)
    expect(html).toContain('unsaved')
  })

  it('New resets the project to empty and clears the dirty marker after reload', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const host = fakeHost()
    mountStudio(host.element, studio)
    expect(studio.projectSession.doc.entityTypes.length).toBeGreaterThan(0)

    host.dispatch('click', { target: fakeElement({ data: { 'project-new': '' } }) })

    expect(studio.projectSession.doc.entityTypes).toEqual([])
    expect(studio.projectSession.dirty).toBe(false)
    expect(host.html()).toContain('saved')
  })

  it('Open loads the store fixture asynchronously, then reloads the catalog and re-renders', async () => {
    const store = createMemoryProjectStore({ json: fixtureDoc('loaded-project'), name: 'loaded-project.json' })
    const session = createProjectSession(store)
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, projectSession: session })
    const host = fakeHost()
    mountStudio(host.element, studio)

    host.dispatch('click', { target: fakeElement({ data: { 'project-open': '' } }) })
    await flush()

    expect(studio.projectSession.doc.meta.name).toBe('loaded-project')
    expect(host.html()).toContain('loaded-project')
  })

  it('Save writes the current doc to the store and clears dirty', async () => {
    const store = createMemoryProjectStore()
    const session = createProjectSession(store)
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, projectSession: session })
    const host = fakeHost()
    mountStudio(host.element, studio)
    session.mutate((doc) => { doc.meta.name = 'edited' })
    expect(session.dirty).toBe(true)

    host.dispatch('click', { target: fakeElement({ data: { 'project-save': '' } }) })
    await flush()

    expect(store.savedDoc).not.toBeNull()
    expect(session.dirty).toBe(false)
    expect(host.html()).toContain('saved')
  })

  it('Save As writes to the store via saveAs', async () => {
    const store = createMemoryProjectStore()
    const session = createProjectSession(store)
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, projectSession: session })
    const host = fakeHost()
    mountStudio(host.element, studio)

    host.dispatch('click', { target: fakeElement({ data: { 'project-save-as': '' } }) })
    await flush()

    expect(store.savedAsDoc).not.toBeNull()
  })
})

describe('problems strip', () => {
  it('renders "no problems" when there are none', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    expect(renderStudioHtml(studio)).toContain('No problems.')
  })

  it('renders session.problems with path and message, never hidden', async () => {
    const store = createMemoryProjectStore({
      json: { format: 'domecs-project', version: 1, entityTypes: [{ name: 'broken', components: { Nonexistent: { a: 1 } } }] },
      name: 'broken.json',
    })
    const session = createProjectSession(store)
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, projectSession: session })
    const host = fakeHost()
    mountStudio(host.element, studio)

    host.dispatch('click', { target: fakeElement({ data: { 'project-open': '' } }) })
    await flush()

    expect(host.html()).toContain('Nonexistent')
    expect(session.problems.length).toBeGreaterThan(0)
  })
})
