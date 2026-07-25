import { describe, expect, it } from 'vitest'
import { createDomecsStudio } from '../src/studio.js'
import { mountStudio, renderStudioHtml } from '../src/ui.js'

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
})
