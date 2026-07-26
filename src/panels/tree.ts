import { entry, Has, type ComponentType, type Entity, type EntityView } from '@domecs/core'
import { childrenOf, despawnTree, setParent } from '@domecs/scene'
import { EntityTreeNode } from '../components.js'
import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'

type TreeRow = EntityView & {
  EntityTreeNode: { guestEntityId: number; label: string; depth: number; componentCount: number; selected: boolean }
}

/**
 * Copies a live guest entity's current component values onto a new entity —
 * used by the tree row "duplicate" control. `guestWorld.archetype(id)`
 * returns the entity's actual live `ComponentType[]` (not just names), so
 * each value can be re-entered through `entry()` without needing to resolve
 * types by name the way `catalog.spawnFromType` does. Returns null when the
 * source entity no longer exists (empty archetype).
 */
export function duplicateEntity(guestWorld: PanelContext['studio']['guestWorld'], id: Entity): Entity | null {
  const types = guestWorld.archetype(id)
  if (types.length === 0) return null
  const entries = types.map((type) => {
    const componentType = type as ComponentType<Record<string, unknown>>
    const value = guestWorld.getComponent(id, componentType)!
    return entry(componentType, structuredClone(value))
  })
  return guestWorld.spawn(entries)
}

function renderAddFromType(ctx: PanelContext): string {
  const entityTypes = ctx.studio.catalog.entityTypes()
  if (entityTypes.length === 0) return ''
  const selected = ctx.ui.spawnEntityType || entityTypes[0]!.name
  return `
    <div class="tree-add-from-type">
      <select data-spawn-entity-type>
        ${entityTypes.map((et) => `<option value="${et.name}" ${et.name === selected ? 'selected' : ''}>${et.name}</option>`).join('')}
      </select>
      <button data-spawn-from-type>Add</button>
    </div>
  `
}

function renderRow(ctx: PanelContext, row: TreeRow): string {
  const { studio, ui } = ctx
  const id = row.EntityTreeNode.guestEntityId
  const depth = row.EntityTreeNode.depth
  const childCount = childrenOf(studio.guestWorld, id).length
  const pendingDespawn = ui.confirmDespawnEntity === id

  const deleteControl = pendingDespawn
    ? `
      <span class="confirm-delete">has ${childCount} child(ren)</span>
      <button data-confirm-despawn="${id}">Confirm delete</button>
      <button data-cancel-despawn="${id}">Cancel</button>
    `
    : `<button class="icon" data-despawn="${id}" title="Delete">✕</button>`

  return `
    <div class="tree-row-wrap" style="--depth:${depth}" draggable="true" data-drag-entity="${id}">
      <button class="tree-row ${row.EntityTreeNode.selected ? 'selected' : ''}" data-select="${id}">${row.EntityTreeNode.label}<small>${row.EntityTreeNode.componentCount}</small></button>
      <button class="icon" data-duplicate="${id}" title="Duplicate">⧉</button>
      ${deleteControl}
    </div>
  `
}

export function renderTreePanel(ctx: PanelContext): string {
  const tree = ctx.studio.editorWorld.query(Has(EntityTreeNode)).entities as TreeRow[]
  return `
    <section class="panel tree">
      <h2>Entity Tree</h2>
      ${renderAddFromType(ctx)}
      <div class="tree-root-drop" data-drag-root>Drop here to unparent (root)</div>
      ${tree.map((row) => renderRow(ctx, row)).join('')}
    </section>
  `
}

/**
 * Shared despawn-with-confirm decision, factored out so both the tree row's
 * delete button (`handleTreeClick`, below) and the viewport's `Delete`/
 * `Backspace` keydown (`src/ui.ts`) drive the exact same confirmation-state
 * logic rather than two copies of it. A childless entity despawns
 * immediately (`despawnTree` degenerates to a plain despawn for a leaf); one
 * with children needs a two-step confirm first — the pending id is recorded
 * in `ui.confirmDespawnEntity`, which the tree panel's row rendering already
 * reads to show the "Confirm delete" / "Cancel" controls, so triggering this
 * from the viewport surfaces the SAME confirm UI in the tree panel rather
 * than inventing a second one.
 */
export function requestDespawn(id: Entity, ctx: PanelContext): void {
  const { studio, ui } = ctx
  if (childrenOf(studio.guestWorld, id).length > 0) {
    ui.confirmDespawnEntity = id
    ctx.render()
  } else {
    despawnTree(studio.guestWorld, id)
    syncAndRender(ctx)
  }
}

export function handleTreeClick(target: HTMLElement, ctx: PanelContext): void {
  const { studio, ui } = ctx

  const select = target.closest<HTMLElement>('[data-select]')
  if (select) {
    studio.select(Number(select.dataset.select))
    return
  }

  const spawn = target.closest<HTMLElement>('[data-spawn-from-type]')
  if (spawn) {
    const entityTypes = studio.catalog.entityTypes()
    const name = ui.spawnEntityType || entityTypes[0]?.name
    if (name) studio.catalog.spawnFromType(name, 0, 0)
    syncAndRender(ctx)
    return
  }

  // First click records which entity is pending and shows its child count
  // (if any); a second click on the resulting Confirm button is what
  // actually calls despawnTree. See requestDespawn's doc comment — this is
  // the same pattern componentTypes.ts's delete-with-usageCount uses, now
  // shared with the viewport's Delete/Backspace keydown (src/ui.ts) too.
  const despawn = target.closest<HTMLElement>('[data-despawn]')
  if (despawn) {
    requestDespawn(Number(despawn.dataset.despawn), ctx)
    return
  }

  const cancelDespawn = target.closest<HTMLElement>('[data-cancel-despawn]')
  if (cancelDespawn) {
    ui.confirmDespawnEntity = null
    ctx.render()
    return
  }

  const confirmDespawn = target.closest<HTMLElement>('[data-confirm-despawn]')
  if (confirmDespawn) {
    despawnTree(studio.guestWorld, Number(confirmDespawn.dataset.confirmDespawn))
    ui.confirmDespawnEntity = null
    syncAndRender(ctx)
    return
  }

  const duplicate = target.closest<HTMLElement>('[data-duplicate]')
  if (duplicate) {
    duplicateEntity(studio.guestWorld, Number(duplicate.dataset.duplicate))
    syncAndRender(ctx)
  }
}

/**
 * `dragstart` delegate: records which guest entity is being dragged in
 * `ui.draggedGuestEntityId`, the fake-host-testable stand-in for
 * `event.dataTransfer` (see UiState's doc comment).
 */
export function handleTreeDragStart(target: HTMLElement, ctx: PanelContext): void {
  const row = target.closest<HTMLElement>('[data-drag-entity]')
  if (!row) return
  ctx.ui.draggedGuestEntityId = Number(row.dataset.dragEntity)
}

/**
 * `drop` delegate: reparents the entity `dragstart` recorded onto whatever
 * was dropped on — another row (`setParent(dragged, target)`) or the
 * dedicated root-drop strip (`setParent(dragged, null)`, unparenting). A
 * rejected `setParent` (e.g. a cycle) surfaces through the same
 * `ui.lastCatalogProblems` -> problems-strip path every other catalog
 * mutation in this app uses, never a JS `alert()`.
 */
export function handleTreeDrop(target: HTMLElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const draggedId = ui.draggedGuestEntityId
  ui.draggedGuestEntityId = null
  if (draggedId === null) return

  const rootZone = target.closest<HTMLElement>('[data-drag-root]')
  const targetRow = rootZone ? null : target.closest<HTMLElement>('[data-drag-entity]')
  if (!rootZone && !targetRow) return

  const targetId = rootZone ? null : Number(targetRow!.dataset.dragEntity)
  if (targetId === draggedId) return

  const result = setParent(studio.guestWorld, draggedId, targetId)
  ui.lastCatalogProblems = result.ok ? [] : [{ path: `tree.reparent[${draggedId}]`, message: result.reason }]
  syncAndRender(ctx)
}

export function handleTreeChange(target: HTMLInputElement, ctx: PanelContext): void {
  if (target.dataset.spawnEntityType !== undefined) {
    ctx.ui.spawnEntityType = target.value
    ctx.render()
  }
}
