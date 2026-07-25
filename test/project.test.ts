import { describe, expect, it } from 'vitest'
import type { ComponentTypeData } from '@domecs/persist'
import {
  createFileSystemProjectStore,
  createLocalStorageProjectStore,
  createMemoryProjectStore,
  createProjectSession,
  emptyProject,
  validateProject,
  type ProjectDocument,
} from '../src/project.js'

/** Hand-rolled fake matching the injected Web-Storage-like subset — no jsdom, no real localStorage. */
function createFakeStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem(key: string): string | null {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string): void {
      map.set(key, value)
    },
    removeItem(key: string): void {
      map.delete(key)
    },
    _map: map,
  }
}

function throwingStorage() {
  return {
    getItem(): string | null {
      throw new Error('boom: getItem')
    },
    setItem(): void {
      throw new Error('boom: setItem')
    },
    removeItem(): void {
      throw new Error('boom: removeItem')
    },
  }
}

describe('emptyProject', () => {
  it('stamps format/version/meta and starts with one empty "main" scene', () => {
    const doc = emptyProject('My Game')

    expect(doc.format).toBe('domecs-project')
    expect(doc.version).toBe(1)
    expect(doc.meta.name).toBe('My Game')
    expect(typeof doc.meta.modified).toBe('string')
    expect(Number.isNaN(Date.parse(doc.meta.modified))).toBe(false)
    expect(doc.componentTypes).toEqual([])
    expect(doc.entityTypes).toEqual([])
    expect(doc.systems).toEqual([])
    expect(doc.scenes).toEqual([{ name: 'main', entities: [] }])
  })
})

describe('validateProject', () => {
  it('never throws and rejects non-object input with a root-path problem', () => {
    for (const garbage of [null, undefined, 42, 'hello', true, [1, 2, 3], () => {}, Symbol('x')]) {
      expect(() => validateProject(garbage)).not.toThrow()
      const { doc, problems } = validateProject(garbage)
      expect(doc).toBeNull()
      expect(problems).toHaveLength(1)
      expect(problems[0]!.path).toBe('')
    }
  })

  it('rejects wrong format and wrong version as fatal', () => {
    const wrongFormat = validateProject({ format: 'not-domecs-project', version: 1 })
    expect(wrongFormat.doc).toBeNull()
    expect(wrongFormat.problems[0]!.path).toBe('format')

    const wrongVersion = validateProject({ format: 'domecs-project', version: 2 })
    expect(wrongVersion.doc).toBeNull()
    expect(wrongVersion.problems[0]!.path).toBe('version')
  })

  it('round-trips a valid document with zero problems', () => {
    const source = emptyProject('Roundtrip')
    const { doc, problems } = validateProject(JSON.parse(JSON.stringify(source)))

    expect(problems).toEqual([])
    expect(doc).toEqual(source)
  })

  it('defaults missing/malformed meta without being fatal', () => {
    const { doc, problems } = validateProject({ format: 'domecs-project', version: 1, meta: 'nope' })

    expect(doc).not.toBeNull()
    expect(doc!.meta.name).toEqual(expect.any(String))
    expect(doc!.meta.modified).toEqual(expect.any(String))
    expect(problems.some((p) => p.path === 'meta')).toBe(true)
  })

  it('salvages valid componentTypes entries and drops/reports invalid ones with a precise path', () => {
    const good: ComponentTypeData = { name: 'Health', fields: [{ name: 'hp', kind: 'number' }] }
    const badMissingName = { fields: [] }
    const badFieldShape = { name: 'Broken', fields: [{ kind: 'number' }] }

    const { doc, problems } = validateProject({
      format: 'domecs-project',
      version: 1,
      meta: { name: 'x', modified: new Date().toISOString() },
      componentTypes: [good, badMissingName, badFieldShape],
    })

    expect(doc!.componentTypes).toEqual([good])
    expect(problems).toHaveLength(2)
    expect(problems[0]!.path).toBe('componentTypes[1].name')
    expect(problems[1]!.path).toBe('componentTypes[2].fields[0].name')
  })

  it('salvages valid entityTypes and reports a precise path for a bad one (spec example shape)', () => {
    const good = { name: 'Player', components: { GuestTransform: { x: 0, y: 0 } } }
    const alsoGood = { name: 'Crate', components: {} }
    const bad = { components: {} } // missing name -> entityTypes[2].name

    const { doc, problems } = validateProject({
      format: 'domecs-project',
      version: 1,
      meta: { name: 'x', modified: new Date().toISOString() },
      entityTypes: [good, alsoGood, bad],
    })

    expect(doc!.entityTypes).toEqual([good, alsoGood])
    expect(problems).toHaveLength(1)
    expect(problems[0]!.path).toBe('entityTypes[2].name')
  })

  it('salvages valid systems and drops one with a bad schedule/actions shape', () => {
    const good = {
      name: 'Motion',
      schedule: 'tick' as const,
      query: ['GuestTransform'],
      actions: [{ set: 'x', expr: 'x + 1' }],
    }
    const badSchedule = { name: 'Bad', schedule: 'never', query: [], actions: [] }
    const badActions = { name: 'Bad2', schedule: 'fixed', query: [], actions: [{ set: 'x' }] }

    const { doc, problems } = validateProject({
      format: 'domecs-project',
      version: 1,
      meta: { name: 'x', modified: new Date().toISOString() },
      systems: [good, badSchedule, badActions],
    })

    expect(doc!.systems).toEqual([good])
    expect(problems).toHaveLength(2)
    expect(problems[0]!.path).toBe('systems[1].schedule')
    expect(problems[1]!.path).toBe('systems[2].actions[0].expr')
  })

  it('salvages valid scenes and drops a whole scene when one of its entities is malformed', () => {
    const good = { name: 'main', entities: [{ id: 1, type: null, parent: null, overrides: {} }] }
    const bad = { name: 'broken', entities: [{ id: 'not-a-number', type: null, parent: null, overrides: {} }] }

    const { doc, problems } = validateProject({
      format: 'domecs-project',
      version: 1,
      meta: { name: 'x', modified: new Date().toISOString() },
      scenes: [good, bad],
    })

    expect(doc!.scenes).toEqual([good])
    expect(problems).toHaveLength(1)
    expect(problems[0]!.path).toBe('scenes[1].entities[0].id')
  })

  it('defaults a non-array top-level field to empty with a problem, without being fatal', () => {
    const { doc, problems } = validateProject({
      format: 'domecs-project',
      version: 1,
      componentTypes: 'not-an-array',
    })

    expect(doc!.componentTypes).toEqual([])
    expect(problems.some((p) => p.path === 'componentTypes')).toBe(true)
  })
})

describe('createMemoryProjectStore', () => {
  it('resolves the fixed initial value on the first open() and null afterward', async () => {
    const initial = { json: { format: 'domecs-project', version: 1 }, name: 'fixture' }
    const store = createMemoryProjectStore(initial)

    await expect(store.open()).resolves.toEqual(initial)
    await expect(store.open()).resolves.toBeNull()
    await expect(store.open()).resolves.toBeNull()
  })

  it('resolves null from open() when constructed with no initial value', async () => {
    const store = createMemoryProjectStore()
    await expect(store.open()).resolves.toBeNull()
  })

  it('save/saveAs record the last doc and resolve true', async () => {
    const store = createMemoryProjectStore() as ReturnType<typeof createMemoryProjectStore> & {
      savedDoc: ProjectDocument | null
      savedAsDoc: ProjectDocument | null
    }
    const doc = emptyProject('Saved')
    const docAs = emptyProject('SavedAs')

    await expect(store.save(doc)).resolves.toBe(true)
    expect(store.savedDoc).toEqual(doc)
    expect(store.savedAsDoc).toBeNull()

    await expect(store.saveAs(docAs)).resolves.toBe(true)
    expect(store.savedAsDoc).toEqual(docAs)
  })

  it('autosave/restore round-trip through an in-memory slot', () => {
    const store = createMemoryProjectStore()
    expect(store.restore()).toBeNull()

    const doc = emptyProject('Autosaved')
    store.autosave(doc)

    const restored = store.restore()
    expect(restored).toEqual(doc)
    expect(restored).not.toBe(doc) // defensive copy, not the same reference
  })
})

describe('createLocalStorageProjectStore', () => {
  it('autosave writes JSON to the default slot and restore() reads it back', () => {
    const fake = createFakeStorage()
    const store = createLocalStorageProjectStore(fake)
    const doc = emptyProject('LS Project')

    store.autosave(doc)
    expect(fake.getItem('domecs-studio:autosave')).not.toBeNull()
    expect(JSON.parse(fake.getItem('domecs-studio:autosave')!)).toEqual(doc)

    expect(store.restore()).toEqual(doc)
  })

  it('uses a custom slot name when provided', () => {
    const fake = createFakeStorage()
    const store = createLocalStorageProjectStore(fake, 'my-custom-slot')
    const doc = emptyProject('Custom Slot')

    store.autosave(doc)
    expect(fake.getItem('my-custom-slot')).not.toBeNull()
    expect(fake.getItem('domecs-studio:autosave')).toBeNull()
    expect(store.restore()).toEqual(doc)
  })

  it('restore() returns null (never throws) on missing data', () => {
    const store = createLocalStorageProjectStore(createFakeStorage())
    expect(() => store.restore()).not.toThrow()
    expect(store.restore()).toBeNull()
  })

  it('restore() returns null (never throws) on corrupt JSON', () => {
    const fake = createFakeStorage({ 'domecs-studio:autosave': '{not valid json' })
    const store = createLocalStorageProjectStore(fake)
    expect(() => store.restore()).not.toThrow()
    expect(store.restore()).toBeNull()
  })

  it('restore() returns null (never throws) on valid JSON with the wrong shape', () => {
    const fake = createFakeStorage({ 'domecs-studio:autosave': JSON.stringify({ hello: 'world' }) })
    const store = createLocalStorageProjectStore(fake)
    expect(store.restore()).toBeNull()
  })

  it('save()/saveAs() write through and resolve true; open() reads the same slot back', async () => {
    const fake = createFakeStorage()
    const store = createLocalStorageProjectStore(fake)
    const doc = emptyProject('Roundtrip LS')

    await expect(store.save(doc)).resolves.toBe(true)
    await expect(store.open()).resolves.toEqual({ json: JSON.parse(JSON.stringify(doc)), name: 'Roundtrip LS' })

    const doc2 = emptyProject('Save As LS')
    await expect(store.saveAs(doc2)).resolves.toBe(true)
    await expect(store.open()).resolves.toEqual({ json: JSON.parse(JSON.stringify(doc2)), name: 'Save As LS' })
  })

  it('open() resolves null when the slot is empty', async () => {
    const store = createLocalStorageProjectStore(createFakeStorage())
    await expect(store.open()).resolves.toBeNull()
  })

  it('never throws even when the backing storage throws on every operation', async () => {
    const store = createLocalStorageProjectStore(throwingStorage())
    expect(() => store.autosave(emptyProject('x'))).not.toThrow()
    expect(() => store.restore()).not.toThrow()
    await expect(store.save(emptyProject('x'))).resolves.toBe(false)
    await expect(store.saveAs(emptyProject('x'))).resolves.toBe(false)
    await expect(store.open()).resolves.toBeNull()
  })
})

describe('createFileSystemProjectStore', () => {
  it('constructs without throwing and exposes the ProjectStore surface', () => {
    expect(() => createFileSystemProjectStore()).not.toThrow()
    const store = createFileSystemProjectStore()
    expect(typeof store.open).toBe('function')
    expect(typeof store.save).toBe('function')
    expect(typeof store.saveAs).toBe('function')
    expect(typeof store.autosave).toBe('function')
    expect(typeof store.restore).toBe('function')
  })
})

describe('createProjectSession', () => {
  it('starts with a fresh empty project, clean and with no problems', () => {
    const session = createProjectSession(createMemoryProjectStore())
    expect(session.dirty).toBe(false)
    expect(session.problems).toEqual([])
    expect(session.doc.format).toBe('domecs-project')
    expect(session.doc.scenes).toEqual([{ name: 'main', entities: [] }])
  })

  it('mutate() clones, applies the mutation, and sets dirty', () => {
    const session = createProjectSession(createMemoryProjectStore())
    const before = session.doc

    session.mutate((doc) => {
      doc.meta.name = 'Renamed'
    })

    expect(session.dirty).toBe(true)
    expect(session.doc.meta.name).toBe('Renamed')
    expect(session.doc).not.toBe(before) // cloned, not mutated in place
    expect(before.meta.name).not.toBe('Renamed') // previous doc left untouched
  })

  it('undo()/redo() move linearly through mutation history', () => {
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => { doc.meta.name = 'A' })
    session.mutate((doc) => { doc.meta.name = 'B' })
    session.mutate((doc) => { doc.meta.name = 'C' })
    expect(session.doc.meta.name).toBe('C')

    session.undo()
    expect(session.doc.meta.name).toBe('B')
    session.undo()
    expect(session.doc.meta.name).toBe('A')
    session.undo()
    expect(session.doc.meta.name).toBe('untitled')

    session.redo()
    expect(session.doc.meta.name).toBe('A')
    session.redo()
    session.redo()
    expect(session.doc.meta.name).toBe('C')
  })

  it('undo() at the oldest checkpoint and redo() at the newest are no-ops', () => {
    const session = createProjectSession(createMemoryProjectStore())
    session.undo()
    expect(session.doc.meta.name).toBe('untitled')

    session.mutate((doc) => { doc.meta.name = 'X' })
    session.redo()
    expect(session.doc.meta.name).toBe('X')
  })

  it('pushing a new mutate after an undo truncates the orphaned redo branch', () => {
    const session = createProjectSession(createMemoryProjectStore())
    session.mutate((doc) => { doc.meta.name = 'A' })
    session.mutate((doc) => { doc.meta.name = 'B' })
    session.undo()
    expect(session.doc.meta.name).toBe('A')

    session.mutate((doc) => { doc.meta.name = 'Z' })
    expect(session.doc.meta.name).toBe('Z')

    session.redo() // nothing to redo — 'B' branch was discarded
    expect(session.doc.meta.name).toBe('Z')
  })

  it('dirty transitions: new/open/mutate/save', async () => {
    const initialJson = JSON.parse(JSON.stringify(emptyProject('From Disk')))
    const store = createMemoryProjectStore({ json: initialJson, name: 'from-disk.json' })
    const session = createProjectSession(store)

    expect(session.dirty).toBe(false)

    session.mutate((doc) => { doc.meta.name = 'Dirtied' })
    expect(session.dirty).toBe(true)

    const opened = await session.open()
    expect(opened).toBe(true)
    expect(session.dirty).toBe(false)
    expect(session.doc.meta.name).toBe('From Disk')

    session.mutate((doc) => { doc.meta.name = 'Dirtied again' })
    expect(session.dirty).toBe(true)

    const saved = await session.save()
    expect(saved).toBe(true)
    expect(session.dirty).toBe(false)

    session.newProject()
    expect(session.dirty).toBe(false)
    expect(session.doc.meta.name).toBe('untitled')
  })

  it('undo() back to the exact saved checkpoint clears dirty again', async () => {
    const store = createMemoryProjectStore()
    const session = createProjectSession(store)

    session.mutate((doc) => { doc.meta.name = 'Saved State' })
    await session.save()
    expect(session.dirty).toBe(false)

    session.mutate((doc) => { doc.meta.name = 'Scratch' })
    expect(session.dirty).toBe(true)

    session.undo()
    expect(session.doc.meta.name).toBe('Saved State')
    expect(session.dirty).toBe(false)
  })

  it('open() returning null (user cancel) leaves doc/dirty/problems untouched', async () => {
    const store = createMemoryProjectStore(null)
    const session = createProjectSession(store)
    session.mutate((doc) => { doc.meta.name = 'Untouched' })
    const docBefore = session.doc
    const dirtyBefore = session.dirty
    const problemsBefore = session.problems

    const result = await session.open()

    expect(result).toBe(false)
    expect(session.doc).toBe(docBefore)
    expect(session.dirty).toBe(dirtyBefore)
    expect(session.problems).toBe(problemsBefore)
  })

  it('open() with fatally invalid content surfaces problems but still yields a usable empty doc', async () => {
    const store = createMemoryProjectStore({ json: { nonsense: true }, name: 'garbage.json' })
    const session = createProjectSession(store)

    const result = await session.open()

    expect(result).toBe(true)
    expect(session.doc.format).toBe('domecs-project')
    expect(session.doc.meta.name).toBe('garbage.json')
    expect(session.problems.length).toBeGreaterThan(0)
    expect(session.dirty).toBe(false)
  })

  it('saveAs() delegates to the store and clears dirty on success', async () => {
    const store = createMemoryProjectStore() as ReturnType<typeof createMemoryProjectStore> & {
      savedAsDoc: ProjectDocument | null
    }
    const session = createProjectSession(store)
    session.mutate((doc) => { doc.meta.name = 'Save As Target' })

    const result = await session.saveAs()

    expect(result).toBe(true)
    expect(session.dirty).toBe(false)
    expect(store.savedAsDoc?.meta.name).toBe('Save As Target')
  })
})
