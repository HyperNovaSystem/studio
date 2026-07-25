import { describe, expect, it } from 'vitest'
import { Has, createWorld, defineComponent, entry } from '@domecs/core'
import { createCatalog } from '../src/catalog.js'
import { createMemoryProjectStore, createProjectSession } from '../src/project.js'

/**
 * A minimal stand-in for studio.ts's built-in `GuestTransform`, defined
 * locally so this test stays independent of `src/components.ts`. Priming it
 * into a fresh guest world via `guestWorld.has(-1, GuestTransform)` mirrors
 * exactly what `createDomecsStudio` does for real built-ins before it ever
 * creates a catalog: the type becomes resolvable by name even though no
 * entity has used it yet.
 */
const GuestTransform = defineComponent<{ x: number; y: number }>('GuestTransform', {
  defaults: { x: 0, y: 0 },
})

describe('createCatalog', () => {
  it('materializes componentTypes + entityTypes + a scene into a fresh guest world', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.componentTypes.push(
        { name: 'Position', fields: [{ name: 'x', kind: 'number', default: 0 }, { name: 'y', kind: 'number', default: 0 }] },
        { name: 'Label', fields: [{ name: 'text', kind: 'string', default: '' }] },
      )
      doc.entityTypes.push({
        name: 'marker',
        components: { Position: { x: 1, y: 2 }, Label: { text: 'Marker' } },
      })
      doc.scenes[0]!.entities.push(
        { id: 1, type: 'marker', parent: null, overrides: {} },
        { id: 2, type: 'marker', parent: null, overrides: { Position: { x: 9, y: 9 } } },
        { id: 3, type: null, parent: null, overrides: { Label: { text: 'Bare' } } },
      )
    })

    const catalog = createCatalog(session, guestWorld)
    const problems = catalog.reload()

    expect(problems).toEqual([])
    const entities = guestWorld.snapshot().entities
    expect(entities).toHaveLength(3)

    const withPosition = entities.filter((e) => 'Position' in e.components)
    expect(withPosition).toHaveLength(2)

    const first = entities.find((e) => (e.components.Position as { x: number } | undefined)?.x === 1)
    expect(first?.components.Position).toEqual({ x: 1, y: 2 })
    expect(first?.components.Label).toEqual({ text: 'Marker' })

    const second = entities.find((e) => (e.components.Position as { x: number } | undefined)?.x === 9)
    expect(second?.components.Position).toEqual({ x: 9, y: 9 })

    const bare = entities.find((e) => !('Position' in e.components))
    expect(bare?.components.Label).toEqual({ text: 'Bare' })
  })

  it('spawnFromType applies entityType defaults and forces x/y through a GuestTransform override', () => {
    const guestWorld = createWorld({ headless: true })
    guestWorld.has(-1, GuestTransform) // prime, mirrors studio.ts registering built-ins before creating the catalog
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.componentTypes.push({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })
      doc.entityTypes.push({
        name: 'thing',
        components: { GuestTransform: { x: 0, y: 0 }, Tag: { label: 'Thing' } },
      })
    })
    const catalog = createCatalog(session, guestWorld)
    catalog.reload()

    const id = catalog.spawnFromType('thing', 42, -7)
    expect(id).not.toBeNull()
    expect(guestWorld.getComponent(id!, GuestTransform)).toEqual({ x: 42, y: -7 })

    const tagType = guestWorld.componentTypes().find((t) => t.name === 'Tag')!
    expect(guestWorld.getComponent(id!, tagType)).toEqual({ label: 'Thing' })

    expect(catalog.spawnFromType('missing', 0, 0)).toBeNull()
  })

  it('upsertComponentType registers a new type; deleteComponentType reports usage and strips references', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    const catalog = createCatalog(session, guestWorld)
    catalog.reload()

    const problems = catalog.upsertComponentType({ name: 'Health', fields: [{ name: 'hp', kind: 'number', default: 10 }] })
    expect(problems).toEqual([])
    expect(session.doc.componentTypes.map((c) => c.name)).toContain('Health')
    expect(catalog.registeredTypes().map((d) => d.name)).toContain('Health')

    const entityProblems = catalog.upsertEntityType({ name: 'critter', components: { Health: { hp: 5 } } })
    expect(entityProblems).toEqual([])
    expect(session.doc.entityTypes.find((et) => et.name === 'critter')?.components.Health).toEqual({ hp: 5 })

    const { usageCount } = catalog.deleteComponentType('Health')
    expect(usageCount).toBe(1)
    expect(session.doc.componentTypes.some((c) => c.name === 'Health')).toBe(false)
    expect(session.doc.entityTypes.find((et) => et.name === 'critter')?.components).not.toHaveProperty('Health')
  })

  it('deleteEntityType "strip" preserves resolved components as inline overrides on scene entities', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.componentTypes.push({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })
      doc.entityTypes.push({ name: 'thing', components: { Tag: { label: 'Thing' } } })
      doc.scenes[0]!.entities.push(
        { id: 1, type: 'thing', parent: null, overrides: {} },
        { id: 2, type: 'thing', parent: null, overrides: { Tag: { label: 'Custom' } } },
      )
    })
    const catalog = createCatalog(session, guestWorld)
    catalog.reload()
    expect(guestWorld.snapshot().entities).toHaveLength(2)

    catalog.deleteEntityType('thing', 'strip')

    expect(session.doc.entityTypes.some((et) => et.name === 'thing')).toBe(false)
    const entities = session.doc.scenes[0]!.entities
    expect(entities).toHaveLength(2)
    expect(entities[0]!.type).toBeNull()
    expect(entities[0]!.overrides.Tag).toEqual({ label: 'Thing' })
    expect(entities[1]!.overrides.Tag).toEqual({ label: 'Custom' })

    const tagType = guestWorld.componentTypes().find((t) => t.name === 'Tag')!
    expect(guestWorld.query(Has(tagType)).size).toBe(2)
  })

  it('deleteEntityType "despawn" removes scene entities of that type entirely', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.componentTypes.push({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })
      doc.entityTypes.push({ name: 'thing', components: { Tag: { label: 'Thing' } } })
      doc.scenes[0]!.entities.push(
        { id: 1, type: 'thing', parent: null, overrides: {} },
        { id: 2, type: 'thing', parent: null, overrides: {} },
      )
    })
    const catalog = createCatalog(session, guestWorld)
    catalog.reload()
    expect(guestWorld.snapshot().entities).toHaveLength(2)

    catalog.deleteEntityType('thing', 'despawn')

    expect(session.doc.scenes[0]!.entities).toHaveLength(0)
    expect(guestWorld.snapshot().entities).toHaveLength(0)
  })

  it('reports a SchemaProblem for an unknown component name in an entityType and preserves it in the raw doc', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.entityTypes.push({ name: 'broken', components: { Nonexistent: { foo: 1 } } })
    })
    const catalog = createCatalog(session, guestWorld)
    const problems = catalog.reload()

    expect(problems).toHaveLength(1)
    expect(problems[0]!.path).toBe('entityTypes[0].components["Nonexistent"]')

    // Never silently dropped: the bad reference is still literally present in
    // session.doc after reload(), only skipped when materializing into the world.
    expect(session.doc.entityTypes[0]!.components).toHaveProperty('Nonexistent')
    expect(session.doc.entityTypes[0]!.components.Nonexistent).toEqual({ foo: 1 })

    // And it produced no entity in the world at all (its only component was unresolvable).
    expect(guestWorld.snapshot().entities.every((e) => Object.keys(e.components).length === 0)).toBe(true)
  })

  it('captureScene snapshots live guest world state back into the scene, matching entityTypes when possible', () => {
    const guestWorld = createWorld({ headless: true })
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => {
      doc.componentTypes.push({ name: 'Tag', fields: [{ name: 'label', kind: 'string' }] })
      doc.entityTypes.push({ name: 'thing', components: { Tag: { label: 'Thing' } } })
    })
    const catalog = createCatalog(session, guestWorld)
    catalog.reload()

    catalog.spawnFromType('thing', 0, 0)
    const tagType = guestWorld.componentTypes().find((t) => t.name === 'Tag')!
    guestWorld.spawn([entry(tagType, { label: 'Custom' })])

    catalog.captureScene()

    const scene = session.doc.scenes[0]!
    expect(scene.entities).toHaveLength(2)
    const matched = scene.entities.find((e) => e.type === 'thing')
    expect(matched).toBeTruthy()
    expect(matched?.overrides).toEqual({})
    const bare = scene.entities.find((e) => e.type === null)
    expect(bare?.overrides.Tag).toEqual({ label: 'Custom' })
  })
})
