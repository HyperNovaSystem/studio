import { entry, Has, type ComponentType, type Entity, type EntityView } from '@domecs/core'
import { EntityTreeNode } from '../components.js'
import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'

type TreeRow = EntityView & { EntityTreeNode: { guestEntityId: number; label: string; componentCount: number; selected: boolean } }

/**
 * Copies a live guest entity's current component values onto a new entity —
 * used by the tree row "duplicate" control. `guestWorld.archetype(id)`
 * returns the entity's actual live `ComponentType[]` (not just names), so
 * each value can be re-entered through `entry()` without needing to resolve
 * types by name the way `catalog.spawnFromType` does. Returns null when the
 * source entity no longer exists (empty archetype).
 */
function duplicateEntity(guestWorld: PanelContext['studio']['guestWorld'], id: Entity): Entity | null {
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

function renderRow(row: TreeRow): string {
  const id = row.EntityTreeNode.guestEntityId
  return `
    <div class="tree-row-wrap">
      <button class="tree-row ${row.EntityTreeNode.selected ? 'selected' : ''}" data-select="${id}">${row.EntityTreeNode.label}<small>${row.EntityTreeNode.componentCount}</small></button>
      <button class="icon" data-duplicate="${id}" title="Duplicate">⧉</button>
      <button class="icon" data-despawn="${id}" title="Delete">✕</button>
    </div>
  `
}

export function renderTreePanel(ctx: PanelContext): string {
  const tree = ctx.studio.editorWorld.query(Has(EntityTreeNode)).entities as TreeRow[]
  return `
    <section class="panel tree">
      <h2>Entity Tree</h2>
      ${renderAddFromType(ctx)}
      ${tree.map(renderRow).join('')}
    </section>
  `
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

  const despawn = target.closest<HTMLElement>('[data-despawn]')
  if (despawn) {
    studio.guestWorld.despawn(Number(despawn.dataset.despawn))
    syncAndRender(ctx)
    return
  }

  const duplicate = target.closest<HTMLElement>('[data-duplicate]')
  if (duplicate) {
    duplicateEntity(studio.guestWorld, Number(duplicate.dataset.duplicate))
    syncAndRender(ctx)
  }
}

export function handleTreeChange(target: HTMLInputElement, ctx: PanelContext): void {
  if (target.dataset.spawnEntityType !== undefined) {
    ctx.ui.spawnEntityType = target.value
    ctx.render()
  }
}
