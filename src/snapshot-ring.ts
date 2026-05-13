import type { Entity, WorldSnapshot } from '@domecs/core'

export interface EntityDiff {
  id: Entity
  spawned?: boolean
  despawned?: boolean
  components?: Record<string, unknown>
  removedComponents?: string[]
}

export interface SnapshotDiffEntry {
  tick: number
  diff: EntityDiff[]
  changedComponents: number
  diffBytes: number
  fullBytes: number
  base?: WorldSnapshot
}

export interface SnapshotRingStats {
  capacity: number
  length: number
  cursor: number
  compactBytes: number
  fullSnapshotBytes: number
  totalChangedComponents: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function bytes(value: unknown): number {
  return JSON.stringify(value).length
}

function entityMap(snapshot: WorldSnapshot): Map<Entity, Record<string, unknown>> {
  const map = new Map<Entity, Record<string, unknown>>()
  for (const entity of snapshot.entities) map.set(entity.id, entity.components)
  return map
}

function diffSnapshots(prev: WorldSnapshot | null, next: WorldSnapshot): EntityDiff[] {
  if (!prev) {
    return next.entities.map((entity) => ({
      id: entity.id,
      spawned: true,
      components: clone(entity.components),
    }))
  }

  const before = entityMap(prev)
  const after = entityMap(next)
  const out: EntityDiff[] = []

  for (const [id, components] of before) {
    if (!after.has(id)) out.push({ id, despawned: true })
    else {
      const nextComponents = after.get(id)!
      const changed: Record<string, unknown> = {}
      const removed: string[] = []
      for (const [name, value] of Object.entries(nextComponents)) {
        if (JSON.stringify(components[name]) !== JSON.stringify(value)) changed[name] = clone(value)
      }
      for (const name of Object.keys(components)) if (!(name in nextComponents)) removed.push(name)
      if (Object.keys(changed).length > 0 || removed.length > 0) {
        out.push({ id, components: changed, removedComponents: removed })
      }
    }
  }

  for (const [id, components] of after) {
    if (!before.has(id)) out.push({ id, spawned: true, components: clone(components) })
  }

  return out
}

function applyDiff(snapshot: WorldSnapshot, diff: EntityDiff[], tick: number): WorldSnapshot {
  const entities = new Map<Entity, { id: Entity; components: Record<string, unknown> }>()
  for (const entity of snapshot.entities) entities.set(entity.id, { id: entity.id, components: clone(entity.components) })

  for (const change of diff) {
    if (change.despawned) {
      entities.delete(change.id)
      continue
    }
    let entity = entities.get(change.id)
    if (!entity) {
      entity = { id: change.id, components: {} }
      entities.set(change.id, entity)
    }
    for (const name of change.removedComponents ?? []) delete entity.components[name]
    for (const [name, value] of Object.entries(change.components ?? {})) entity.components[name] = clone(value)
  }

  return {
    version: snapshot.version,
    seed: clone(snapshot.seed),
    tick,
    entities: Array.from(entities.values()).sort((a, b) => a.id - b.id),
    meta: snapshot.meta ? clone(snapshot.meta) : undefined,
  }
}

export class SnapshotRingBuffer {
  readonly capacity: number
  private entries: SnapshotDiffEntry[] = []
  private lastSnapshot: WorldSnapshot | null = null
  private cursorIndex = -1

  constructor(capacity = 3600) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  get length(): number {
    return this.entries.length
  }

  get cursor(): number {
    return this.cursorIndex
  }

  list(): readonly SnapshotDiffEntry[] {
    return this.entries
  }

  push(snapshot: WorldSnapshot): void {
    const clean = clone(snapshot)
    const diff = diffSnapshots(this.lastSnapshot, clean)
    const fullBytes = bytes(clean)
    const changedComponents = diff.reduce(
      (sum, change) => sum + Object.keys(change.components ?? {}).length + (change.removedComponents?.length ?? 0),
      0,
    )
    const entry: SnapshotDiffEntry = {
      tick: clean.tick,
      diff,
      changedComponents,
      diffBytes: bytes(diff),
      fullBytes,
    }
    if (this.entries.length === 0) entry.base = clean
    this.entries.push(entry)
    this.lastSnapshot = clean
    this.cursorIndex = this.entries.length - 1

    while (this.entries.length > this.capacity) this.dropOldest()
  }

  reconstruct(cursor = this.cursorIndex): WorldSnapshot {
    if (this.entries.length === 0) throw new Error('studio: snapshot ring is empty')
    const bounded = Math.max(0, Math.min(cursor, this.entries.length - 1))
    let baseIndex = bounded
    while (baseIndex > 0 && !this.entries[baseIndex]?.base) baseIndex--
    const baseEntry = this.entries[baseIndex]
    if (!baseEntry?.base) throw new Error('studio: snapshot ring has no base checkpoint')
    let snapshot = clone(baseEntry.base)
    for (let i = baseIndex + 1; i <= bounded; i++) {
      const entry = this.entries[i]!
      snapshot = applyDiff(snapshot, entry.diff, entry.tick)
    }
    return snapshot
  }

  seek(cursor: number): WorldSnapshot {
    this.cursorIndex = Math.max(0, Math.min(cursor, this.entries.length - 1))
    return this.reconstruct(this.cursorIndex)
  }

  stats(): SnapshotRingStats {
    const compactBytes = this.entries.reduce((sum, entry) => sum + (entry.base ? bytes(entry.base) : entry.diffBytes), 0)
    return {
      capacity: this.capacity,
      length: this.entries.length,
      cursor: this.cursorIndex,
      compactBytes,
      fullSnapshotBytes: this.entries.reduce((sum, entry) => sum + entry.fullBytes, 0),
      totalChangedComponents: this.entries.reduce((sum, entry) => sum + entry.changedComponents, 0),
    }
  }

  private dropOldest(): void {
    if (this.entries.length <= 1) {
      this.entries.shift()
      this.lastSnapshot = null
      this.cursorIndex = -1
      return
    }
    const newBase = this.reconstruct(1)
    this.entries.shift()
    this.entries[0] = { ...this.entries[0]!, base: newBase }
    this.cursorIndex = Math.max(0, this.cursorIndex - 1)
  }
}
