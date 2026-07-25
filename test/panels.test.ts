import { describe, expect, it } from 'vitest'
import { createWorld, entry, type ComponentType } from '@domecs/core'
import { Parent, setParent } from '@domecs/scene'
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

// mountStudio (M8) re-finds the `.stage` placeholder via
// `app.querySelector('[data-stage-mount]')` after every rewrite and patches
// sprites into it. This suite doesn't assert anything about stage contents,
// but `fakeHost`'s `element` still needs a working `querySelector` and a
// container the returned node can `appendChild`/`removeChild` into, or
// mountStudio throws. Minimal fake, not jsdom — same shape as
// test/ui.test.ts's FakeStageElement/FakeStageDocument.
class FakeStyle {
  private props = new Map<string, string>()
  setProperty(name: string, value: string): void { this.props.set(name, value) }
  getPropertyValue(name: string): string { return this.props.get(name) ?? '' }
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
  let stageMount: FakeStageElement | null = null
  return {
    writes: () => writes,
    html: () => html,
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

  it('surfaces @domecs/rules compile errors for an unresolvable system, keyed by system name', () => {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    studio.projectSession.mutate((doc) => {
      doc.systems.push({ name: 'broken-rule', schedule: 'tick', query: ['Nonexistent'], actions: [{ set: 'Nonexistent.x', expr: '1' }] })
    })
    studio.sync()

    expect(studio.ruleErrors().has('broken-rule')).toBe(true)
    expect(renderStudioHtml(studio)).toContain('broken-rule')
  })
})

describe('component types panel', () => {
  function setup() {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const host = fakeHost()
    mountStudio(host.element, studio)
    return { studio, host }
  }

  it('adding a new component type: typing a name then clicking Add creates it via the catalog', () => {
    const { studio, host } = setup()

    host.dispatch('change', { target: fakeElement({ data: { 'new-component-type-name': '' }, value: 'Health' }) })
    host.dispatch('click', { target: fakeElement({ data: { 'add-component-type': '' } }) })

    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).toContain('Health')
    expect(host.html()).toContain('data-rename-component-type="Health"')
  })

  it('renaming a component type re-keys entityType references and drops the old name', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Old', fields: [{ name: 'x', kind: 'number' }] })
    studio.catalog.upsertEntityType({ name: 'thing', components: { Old: { x: 1 } } })

    host.dispatch('change', { target: fakeElement({ data: { 'rename-component-type': 'Old' }, value: 'New' }) })

    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).not.toContain('Old')
    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).toContain('New')
    const thing = studio.projectSession.doc.entityTypes.find((et) => et.name === 'thing')!
    expect(thing.components).toEqual({ New: { x: 1 } })
  })

  it('adding a field: draft name + kind, then Add field, appends the field via upsertComponentType', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Health', fields: [] })

    host.dispatch('change', { target: fakeElement({ data: { 'new-field-name': 'Health' }, value: 'hp' }) })
    host.dispatch('change', { target: fakeElement({ data: { 'new-field-kind': 'Health' }, value: 'number' }) })
    host.dispatch('click', { target: fakeElement({ data: { 'add-field': 'Health' } }) })

    const type = studio.projectSession.doc.componentTypes.find((c) => c.name === 'Health')!
    expect(type.fields).toEqual([{ name: 'hp', kind: 'number' }])
  })

  it('retyping a field updates its kind in place', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Health', fields: [{ name: 'hp', kind: 'number' }] })

    host.dispatch('change', { target: fakeElement({ data: { 'retype-field': 'Health:hp' }, value: 'string' }) })

    const type = studio.projectSession.doc.componentTypes.find((c) => c.name === 'Health')!
    expect(type.fields[0]!.kind).toBe('string')
  })

  it('removing a field drops it from the type', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Health', fields: [{ name: 'hp', kind: 'number' }] })

    host.dispatch('click', { target: fakeElement({ data: { 'remove-field': 'Health:hp' } }) })

    const type = studio.projectSession.doc.componentTypes.find((c) => c.name === 'Health')!
    expect(type.fields).toEqual([])
  })

  it('deleting an in-use type is two-step: first click shows usage count, second click confirms delete', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })
    studio.catalog.upsertEntityType({ name: 'thing', components: { Tag: { label: 'x' } } })

    host.dispatch('click', { target: fakeElement({ data: { 'delete-component-type': 'Tag' } }) })
    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).toContain('Tag')
    expect(host.html()).toContain('used by 1 entity type')
    expect(host.html()).toContain('data-confirm-delete-component-type="Tag"')

    host.dispatch('click', { target: fakeElement({ data: { 'confirm-delete-component-type': 'Tag' } }) })
    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).not.toContain('Tag')
  })

  it('canceling a pending delete leaves the type intact', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Tag', fields: [] })

    host.dispatch('click', { target: fakeElement({ data: { 'delete-component-type': 'Tag' } }) })
    host.dispatch('click', { target: fakeElement({ data: { 'cancel-delete-component-type': 'Tag' } }) })

    expect(studio.projectSession.doc.componentTypes.map((c) => c.name)).toContain('Tag')
    expect(host.html()).not.toContain('data-confirm-delete-component-type')
  })
})

describe('entity types panel', () => {
  function setup() {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    const host = fakeHost()
    mountStudio(host.element, studio)
    return { studio, host }
  }

  it('creating a new entity type: name + checked components, then Create, calls upsertEntityType', () => {
    const { studio, host } = setup()

    host.dispatch('change', { target: fakeElement({ data: { 'new-entity-type-name': '' }, value: 'goblin' }) })
    host.dispatch('change', { target: fakeElement({ data: { 'new-entity-type-component': 'GuestTransform' }, checked: true }) })
    host.dispatch('click', { target: fakeElement({ data: { 'create-entity-type': '' } }) })

    const created = studio.projectSession.doc.entityTypes.find((et) => et.name === 'goblin')
    expect(created).toBeTruthy()
    expect(created!.components).toEqual({ GuestTransform: {} })
  })

  it('editing a default value coerces by field kind and applies via upsertEntityType', () => {
    const { studio, host } = setup()
    studio.catalog.upsertEntityType({ name: 'goblin', components: { GuestTransform: { x: 0 } } })

    host.dispatch('change', { target: fakeElement({ data: { 'entity-type-default': 'goblin:GuestTransform:x', 'field-kind-hint': 'number' }, value: '42' }) })

    const et = studio.projectSession.doc.entityTypes.find((e) => e.name === 'goblin')!
    expect(et.components.GuestTransform!.x).toBe(42)
  })

  it('deleting an entity type with "strip" preserves instances as inline overrides', () => {
    const { studio, host } = setup()
    studio.catalog.upsertEntityType({ name: 'goblin', components: { GuestTransform: { x: 5 } } })
    studio.catalog.spawnFromType('goblin', 5, 0)

    host.dispatch('click', { target: fakeElement({ data: { 'strip-entity-type': 'goblin' } }) })

    expect(studio.projectSession.doc.entityTypes.some((et) => et.name === 'goblin')).toBe(false)
    expect(studio.guestWorld.snapshot().entities.length).toBeGreaterThan(0)
  })

  it('deleting an entity type with "despawn" removes its instances', () => {
    const { studio, host } = setup()
    studio.catalog.upsertEntityType({ name: 'goblin', components: { GuestTransform: { x: 5 } } })
    studio.catalog.spawnFromType('goblin', 5, 0)
    const before = studio.guestWorld.snapshot().entities.length

    host.dispatch('click', { target: fakeElement({ data: { 'despawn-entity-type': 'goblin' } }) })

    expect(studio.projectSession.doc.entityTypes.some((et) => et.name === 'goblin')).toBe(false)
    expect(studio.guestWorld.snapshot().entities.length).toBe(before - 1)
  })
})

describe('systems panel', () => {
  function setup() {
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8 })
    studio.catalog.upsertComponentType({ name: 'Health', fields: [{ name: 'hp', kind: 'number', default: 10 }] })
    studio.projectSession.mutate((doc) => {
      doc.systems.push({ name: 'decay', schedule: 'tick', query: ['Health'], actions: [{ set: 'Health.hp', expr: 'Health.hp - 1' }] })
    })
    studio.sync()
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)
    return { studio, host, ui }
  }

  function healthType(studio: ReturnType<typeof createDomecsStudio>): ComponentType<{ hp: number }> {
    return studio.catalog.resolveComponentType('Health') as ComponentType<{ hp: number }>
  }

  it('renders a form: enable toggle, name, schedule, query checkboxes, and action rows (no raw JSON)', () => {
    const { host } = setup()
    const html = host.html()
    expect(html).toContain('data-system-enabled="0"')
    expect(html).toContain('data-system-name="0" value="decay"')
    expect(html).toContain('data-system-query="0:Health"')
    expect(html).toContain('data-action-set="0:0" value="Health.hp"')
    expect(html).toContain('data-action-expr="0:0" value="Health.hp - 1"')
    expect(html).not.toContain('data-system-json')
  })

  it('toggling enabled mutates the system in place, not via the catalog', () => {
    const { studio, host } = setup()
    host.dispatch('change', { target: fakeElement({ data: { 'system-enabled': '0' }, checked: false }) })
    expect(studio.projectSession.doc.systems[0]!.enabled).toBe(false)
  })

  it('checking an unused query checkbox adds that component to the query', () => {
    const { studio, host } = setup()
    studio.catalog.upsertComponentType({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })

    host.dispatch('change', { target: fakeElement({ data: { 'system-query': '0:Tag' }, checked: true }) })

    expect(studio.projectSession.doc.systems[0]!.query).toEqual(['Health', 'Tag'])
  })

  it('unchecking a query checkbox removes that component from the query', () => {
    const { studio, host } = setup()
    host.dispatch('change', { target: fakeElement({ data: { 'system-query': '0:Health' }, checked: false }) })
    expect(studio.projectSession.doc.systems[0]!.query).toEqual([])
  })

  it('Add action appends a blank {set, expr} row; Remove action drops it', () => {
    const { studio, host } = setup()

    host.dispatch('click', { target: fakeElement({ data: { 'add-action': '0' } }) })
    expect(studio.projectSession.doc.systems[0]!.actions).toHaveLength(2)
    expect(studio.projectSession.doc.systems[0]!.actions[1]).toEqual({ set: '', expr: '' })
    expect(host.html()).toContain('data-action-set="0:1"')

    host.dispatch('click', { target: fakeElement({ data: { 'remove-action': '0:1' } }) })
    expect(studio.projectSession.doc.systems[0]!.actions).toHaveLength(1)
    expect(host.html()).not.toContain('data-action-set="0:1"')
  })

  it('a deliberately bad expression shows an inline error without crashing the render or losing other edits', () => {
    const { studio, host } = setup()

    host.dispatch('change', { target: fakeElement({ data: { 'action-expr': '0:0' }, value: 'Health.hp - ' }) })

    // Never silently dropped: the raw (invalid) text is still saved.
    expect(studio.projectSession.doc.systems[0]!.actions[0]!.expr).toBe('Health.hp - ')
    expect(host.html()).toContain('field-error')
    // The rest of the row/system is untouched.
    expect(studio.projectSession.doc.systems[0]!.actions[0]!.set).toBe('Health.hp')
    expect(studio.projectSession.doc.systems[0]!.name).toBe('decay')
    expect(studio.projectSession.doc.systems[0]!.query).toEqual(['Health'])
  })

  it('an invalid "when" expression shows an inline error next to the when field', () => {
    const { studio, host } = setup()

    host.dispatch('change', { target: fakeElement({ data: { 'system-when': '0' }, value: '&&&' }) })

    expect(studio.projectSession.doc.systems[0]!.when).toBe('&&&')
    expect(host.html()).toContain('data-system-when-error="0"')
  })

  it('clearing the "when" field back to empty removes it (treated as "no condition", not an error)', () => {
    const { studio, host } = setup()
    host.dispatch('change', { target: fakeElement({ data: { 'system-when': '0' }, value: 'Health.hp > 0' }) })
    expect(studio.projectSession.doc.systems[0]!.when).toBe('Health.hp > 0')

    host.dispatch('change', { target: fakeElement({ data: { 'system-when': '0' }, value: '' }) })

    expect(studio.projectSession.doc.systems[0]!.when).toBeUndefined()
    expect(host.html()).not.toContain('data-system-when-error="0"')
  })

  it('a valid expr edit clears the previous error and takes effect on the guest world\'s next tick', () => {
    const { studio, host } = setup()
    const type = healthType(studio)
    const id = studio.guestWorld.spawn([entry(type, { hp: 10 })])

    // Break the rule: an invalid expr fails to compile, so it is not installed.
    host.dispatch('change', { target: fakeElement({ data: { 'action-expr': '0:0' }, value: 'Health.hp - ' }) })
    expect(host.html()).toContain('field-error')
    studio.guestWorld.step(1 / 60)
    expect(studio.guestWorld.getComponent(id, type)!.hp).toBe(10)

    // Fix it with a valid expr that sets hp to a fixed, easily-distinguished value.
    host.dispatch('change', { target: fakeElement({ data: { 'action-expr': '0:0' }, value: '42' }) })
    expect(host.html()).not.toContain('field-error')

    studio.guestWorld.step(1 / 60)
    expect(studio.guestWorld.getComponent(id, type)!.hp).toBe(42)
  })

  it('reordering action rows (Up/Down) changes both display order and evaluation order', () => {
    const { studio, host, ui } = setup()
    const type = healthType(studio)

    studio.projectSession.mutate((doc) => {
      doc.systems[0] = {
        name: 'combo',
        schedule: 'tick',
        query: ['Health'],
        actions: [
          { set: 'Health.hp', expr: '100' },
          { set: 'Health.hp', expr: 'Health.hp - 1' },
        ],
      }
    })
    studio.sync()
    ui.render()

    const html = host.html()
    expect(html.indexOf('data-action-expr="0:0"')).toBeLessThan(html.indexOf('data-action-expr="0:1"'))

    const id = studio.guestWorld.spawn([entry(type, { hp: 10 })])
    studio.guestWorld.step(1 / 60)
    // Evaluated in order: hp=100, then hp=100-1=99.
    expect(studio.guestWorld.getComponent(id, type)!.hp).toBe(99)

    host.dispatch('click', { target: fakeElement({ data: { 'action-up': '0:1' } }) })

    expect(studio.projectSession.doc.systems[0]!.actions[0]!.expr).toBe('Health.hp - 1')
    expect(studio.projectSession.doc.systems[0]!.actions[1]!.expr).toBe('100')
    const reorderedHtml = host.html()
    expect(reorderedHtml.indexOf('data-action-expr="0:0" value="Health.hp - 1"')).toBeGreaterThanOrEqual(0)

    studio.guestWorld.step(1 / 60)
    // Evaluated in the new order: hp=hp-1 (from whatever it was), then hp=100 unconditionally.
    expect(studio.guestWorld.getComponent(id, type)!.hp).toBe(100)
  })
})

describe('entity tree panel — add from type / delete / duplicate', () => {
  function setup() {
    // An empty custom guestWorld (rather than the 24-entity demo scene) keeps
    // these tree-row assertions focused on exactly the entities each test
    // creates. createDomecsStudio still seeds the default prop.crate /
    // enemy.spark / trigger.door entityTypes since no projectSession is
    // supplied either.
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    mountStudio(host.element, studio)
    return { studio, host }
  }

  it('renders an add-from-type dropdown listing the known entity types', () => {
    const { host } = setup()
    expect(host.html()).toContain('data-spawn-entity-type')
    expect(host.html()).toContain('data-spawn-from-type')
    expect(host.html()).toContain('prop.crate')
  })

  it('Add spawns via catalog.spawnFromType and the new entity appears in the tree', () => {
    const { studio, host } = setup()
    expect(studio.guestWorld.snapshot().entities).toHaveLength(0)

    host.dispatch('change', { target: fakeElement({ data: { 'spawn-entity-type': '' }, value: 'prop.crate' }) })
    host.dispatch('click', { target: fakeElement({ data: { 'spawn-from-type': '' } }) })

    expect(studio.guestWorld.snapshot().entities).toHaveLength(1)
    expect(host.html()).toContain('Crate')
  })

  it('the delete button despawns the guest entity directly via guestWorld.despawn', () => {
    const { studio, host } = setup()
    const id = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()

    host.dispatch('click', { target: fakeElement({ data: { despawn: String(id) } }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === id)).toBe(false)
  })

  it('the duplicate button spawns a new entity carrying a copy of the source entity\'s live component values', () => {
    const { studio, host } = setup()
    const id = studio.catalog.spawnFromType('prop.crate', 7, 9)!
    studio.sync()

    host.dispatch('click', { target: fakeElement({ data: { duplicate: String(id) } }) })

    const entities = studio.guestWorld.snapshot().entities
    expect(entities).toHaveLength(2)
    const original = entities.find((e) => e.id === id)!
    const copy = entities.find((e) => e.id !== id)!
    expect(copy.components).toEqual(original.components)
  })
})

describe('entity tree panel — hierarchy (depth indent / drag-drop reparent / tree-aware delete)', () => {
  function setup() {
    const guestWorld = createWorld({ headless: true })
    const studio = createDomecsStudio({ headless: true, ringCapacity: 8, guestWorld })
    const host = fakeHost()
    const ui = mountStudio(host.element, studio)
    return { studio, host, ui }
  }

  it('indents a row by its EntityTreeNode depth, and re-renders the indent when depth changes', () => {
    const { studio, host, ui } = setup()
    const parentId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const childId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    ui.render()

    expect(host.html()).toContain(`style="--depth:0" draggable="true" data-drag-entity="${childId}"`)

    const result = setParent(studio.guestWorld, childId, parentId)
    expect(result.ok).toBe(true)
    studio.sync()
    ui.render()

    expect(host.html()).toContain(`style="--depth:1" draggable="true" data-drag-entity="${childId}"`)

    const unparented = setParent(studio.guestWorld, childId, null)
    expect(unparented.ok).toBe(true)
    studio.sync()
    ui.render()

    expect(host.html()).toContain(`style="--depth:0" draggable="true" data-drag-entity="${childId}"`)
  })

  it('dropping row A onto row B reparents A under B via setParent', () => {
    const { studio, host } = setup()
    const aId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const bId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()

    host.dispatch('dragstart', { target: fakeElement({ data: { 'drag-entity': String(aId) } }) })
    host.dispatch('drop', { target: fakeElement({ data: { 'drag-entity': String(bId) } }) })

    expect(studio.guestWorld.getComponent(aId, Parent)?.entity).toBe(bId)
  })

  it('dropping onto the root strip clears the dragged entity\'s parent', () => {
    const { studio, host } = setup()
    const aId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const bId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    expect(setParent(studio.guestWorld, aId, bId).ok).toBe(true)

    host.dispatch('dragstart', { target: fakeElement({ data: { 'drag-entity': String(aId) } }) })
    host.dispatch('drop', { target: fakeElement({ data: { 'drag-root': '' } }) })

    expect(studio.guestWorld.getComponent(aId, Parent)?.entity ?? null).toBeNull()
  })

  it('a rejected reparent (cycle) is surfaced via the problems strip rather than mutating state', () => {
    const { studio, host } = setup()
    const aId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const bId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    // b is already a's child; dropping a onto b would create a cycle.
    expect(setParent(studio.guestWorld, bId, aId).ok).toBe(true)

    host.dispatch('dragstart', { target: fakeElement({ data: { 'drag-entity': String(aId) } }) })
    host.dispatch('drop', { target: fakeElement({ data: { 'drag-entity': String(bId) } }) })

    expect(studio.guestWorld.getComponent(aId, Parent)?.entity ?? null).toBeNull()
    expect(host.html()).toContain('cycle')
  })

  it('deleting a childless entity despawns immediately (single click)', () => {
    const { studio, host } = setup()
    const id = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()

    host.dispatch('click', { target: fakeElement({ data: { despawn: String(id) } }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === id)).toBe(false)
  })

  it('deleting an entity with children is two-step: first click shows the child count without despawning, second click despawns the whole subtree', () => {
    const { studio, host } = setup()
    const parentId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const childId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    expect(setParent(studio.guestWorld, childId, parentId).ok).toBe(true)
    studio.sync()

    host.dispatch('click', { target: fakeElement({ data: { despawn: String(parentId) } }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === parentId)).toBe(true)
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === childId)).toBe(true)
    expect(host.html()).toContain('1 child')
    expect(host.html()).toContain(`data-confirm-despawn="${parentId}"`)

    host.dispatch('click', { target: fakeElement({ data: { 'confirm-despawn': String(parentId) } }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === parentId)).toBe(false)
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === childId)).toBe(false)
  })

  it('canceling a pending tree-aware delete leaves parent and child intact', () => {
    const { studio, host } = setup()
    const parentId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    const childId = studio.catalog.spawnFromType('prop.crate', 0, 0)!
    studio.sync()
    expect(setParent(studio.guestWorld, childId, parentId).ok).toBe(true)
    studio.sync()

    host.dispatch('click', { target: fakeElement({ data: { despawn: String(parentId) } }) })
    host.dispatch('click', { target: fakeElement({ data: { 'cancel-despawn': String(parentId) } }) })

    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === parentId)).toBe(true)
    expect(studio.guestWorld.snapshot().entities.some((e) => e.id === childId)).toBe(true)
    expect(host.html()).not.toContain('data-confirm-despawn')
  })
})
