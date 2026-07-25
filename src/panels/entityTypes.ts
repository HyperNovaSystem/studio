import type { ComponentDescriptor, FieldKind } from '@domecs/core'
import type { EntityTypeData } from '../project.js'
import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'

/**
 * Every component name a new/edited entity type can draw from: built-ins
 * plus custom types, both already registered on the guest world. Unlike the
 * Component Types panel (which lists only the user's own editable types),
 * this picklist needs the full registered set, so it reads
 * `catalog.registeredTypes()` rather than `session.doc.componentTypes`.
 */
function availableComponents(ctx: PanelContext): ComponentDescriptor[] {
  return ctx.studio.catalog.registeredTypes()
}

function coerce(value: string, kind: FieldKind | undefined): unknown {
  if (kind === 'number') return Number(value)
  if (kind === 'boolean') return value === 'true'
  return value
}

function renderDefaults(et: EntityTypeData, descriptors: ComponentDescriptor[]): string {
  return Object.keys(et.components)
    .map((componentName) => {
      const descriptor = descriptors.find((d) => d.name === componentName)
      if (!descriptor) return `<p class="unknown-component">${componentName} (unregistered)</p>`
      const overrides = et.components[componentName] ?? {}
      const fields = Object.entries(descriptor.fields)
        .map(([field, schema]) => {
          const current = overrides[field] ?? descriptor.defaults?.[field] ?? ''
          return `<label>${field}<input data-entity-type-default="${et.name}:${componentName}:${field}" value="${String(current)}" data-field-kind-hint="${schema.kind}"></label>`
        })
        .join('')
      return `<h4>${componentName}</h4><div class="default-field-row">${fields}</div>`
    })
    .join('')
}

function renderEntityType(ctx: PanelContext, et: EntityTypeData, descriptors: ComponentDescriptor[]): string {
  return `
    <li class="entity-type">
      <div class="entity-type-header"><strong>${et.name}</strong></div>
      <div class="entity-type-defaults">${renderDefaults(et, descriptors)}</div>
      <div class="entity-type-actions">
        <button data-strip-entity-type="${et.name}">Delete (strip instances)</button>
        <button data-despawn-entity-type="${et.name}">Delete (despawn instances)</button>
      </div>
    </li>
  `
}

export function renderEntityTypesPanel(ctx: PanelContext): string {
  const { ui } = ctx
  const entityTypes = ctx.studio.catalog.entityTypes()
  const descriptors = availableComponents(ctx)

  return `
    <section class="panel entity-types">
      <h2>Entity Types</h2>
      <div class="add-entity-type">
        <input data-new-entity-type-name value="${ui.newEntityTypeName}" placeholder="new entity type">
        <div class="entity-type-components">
          ${descriptors
            .map(
              (d) =>
                `<label><input type="checkbox" data-new-entity-type-component="${d.name}" ${ui.newEntityTypeComponents.has(d.name) ? 'checked' : ''}>${d.name}</label>`,
            )
            .join('')}
        </div>
        <button data-create-entity-type>Create</button>
      </div>
      <ul class="entity-type-list">${entityTypes.map((et) => renderEntityType(ctx, et, descriptors)).join('')}</ul>
    </section>
  `
}

export function handleEntityTypesClick(target: HTMLElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const { catalog } = studio

  const create = target.closest<HTMLElement>('[data-create-entity-type]')
  if (create) {
    const name = ui.newEntityTypeName.trim()
    if (name) {
      const components: Record<string, Record<string, unknown>> = {}
      for (const componentName of ui.newEntityTypeComponents) components[componentName] = {}
      ui.lastCatalogProblems = catalog.upsertEntityType({ name, components })
      ui.newEntityTypeName = ''
      ui.newEntityTypeComponents = new Set()
      syncAndRender(ctx)
    }
    return
  }

  const strip = target.closest<HTMLElement>('[data-strip-entity-type]')
  if (strip) {
    catalog.deleteEntityType(strip.dataset.stripEntityType!, 'strip')
    syncAndRender(ctx)
    return
  }

  const despawn = target.closest<HTMLElement>('[data-despawn-entity-type]')
  if (despawn) {
    catalog.deleteEntityType(despawn.dataset.despawnEntityType!, 'despawn')
    syncAndRender(ctx)
  }
}

export function handleEntityTypesChange(target: HTMLInputElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const { catalog } = studio

  if (target.dataset.newEntityTypeName !== undefined) {
    ui.newEntityTypeName = target.value
    ctx.render()
    return
  }

  if (target.dataset.newEntityTypeComponent !== undefined) {
    const name = target.dataset.newEntityTypeComponent!
    if (target.checked) ui.newEntityTypeComponents.add(name)
    else ui.newEntityTypeComponents.delete(name)
    ctx.render()
    return
  }

  if (target.dataset.entityTypeDefault !== undefined) {
    const [etName, componentName, field] = target.dataset.entityTypeDefault!.split(':')
    const et = catalog.entityTypes().find((e) => e.name === etName)
    if (et) {
      const kind = target.dataset.fieldKindHint as FieldKind | undefined
      const components = { ...et.components, [componentName!]: { ...et.components[componentName!], [field!]: coerce(target.value, kind) } }
      ui.lastCatalogProblems = catalog.upsertEntityType({ ...et, components })
      syncAndRender(ctx)
    }
  }
}
