import type { ComponentFieldData, ComponentTypeData } from '@domecs/persist'
import type { Catalog } from '../catalog.js'
import type { ProjectSession } from '../project.js'
import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'
import { FIELD_KINDS, fieldDraft } from './state.js'

/**
 * Source of record for this panel: `session.doc.componentTypes`, not
 * `catalog.registeredTypes()`. Two reasons: (1) `registeredTypes()` reflects
 * the *live* guest world, which — per catalog.ts's documented limitation —
 * does not pick up a field-shape edit to an already-registered custom type
 * until the app restarts (re-registering under an existing name keeps the
 * old live `ComponentType` object), so it can show stale fields right after
 * an edit; `session.doc.componentTypes` is always exactly what was last
 * written and what upsert/delete read and write. (2) it already excludes
 * built-ins (they're never stored in the doc), so no `RESERVED_COMPONENT_
 * NAMES` filtering is needed here, unlike a `registeredTypes()`-based list.
 */
function componentTypes(session: ProjectSession): ComponentTypeData[] {
  return session.doc.componentTypes
}

function usageCount(session: ProjectSession, name: string): number {
  return session.doc.entityTypes.filter((et) => name in et.components).length
}

/**
 * `Catalog` has no rename primitive — only upsert-by-name and delete (which
 * strips references). A rename is composed from the documented API: register
 * the new name with the old fields, re-key every entityType's reference from
 * old -> new (preserving its override values), then delete the old name
 * (now unreferenced, so its strip pass is a no-op).
 */
function renameComponentType(catalog: Catalog, session: ProjectSession, oldName: string, newName: string) {
  const existing = componentTypes(session).find((c) => c.name === oldName)
  if (!existing || !newName || newName === oldName) return []
  const problems = catalog.upsertComponentType({ ...existing, name: newName })
  for (const et of session.doc.entityTypes) {
    if (!(oldName in et.components)) continue
    const components = { ...et.components }
    components[newName] = components[oldName]!
    delete components[oldName]
    catalog.upsertEntityType({ ...et, components })
  }
  catalog.deleteComponentType(oldName)
  return problems
}

function renderField(typeName: string, field: ComponentFieldData): string {
  return `
    <li class="field-row">
      <span>${field.name}</span>
      <select data-retype-field="${typeName}:${field.name}">
        ${FIELD_KINDS.map((kind) => `<option value="${kind}" ${kind === field.kind ? 'selected' : ''}>${kind}</option>`).join('')}
      </select>
      <button data-remove-field="${typeName}:${field.name}">Remove</button>
    </li>
  `
}

function renderType(ctx: PanelContext, type: ComponentTypeData): string {
  const { ui } = ctx
  const session = ctx.studio.projectSession
  const draft = fieldDraft(ui, type.name)
  const pendingDelete = ui.confirmDeleteComponentType === type.name

  const deleteControl = pendingDelete
    ? `
      <span class="confirm-delete">used by ${usageCount(session, type.name)} entity type(s)</span>
      <button data-confirm-delete-component-type="${type.name}">Confirm delete</button>
      <button data-cancel-delete-component-type="${type.name}">Cancel</button>
    `
    : `<button data-delete-component-type="${type.name}">Delete</button>`

  return `
    <li class="component-type">
      <div class="component-type-header">
        <input data-rename-component-type="${type.name}" value="${type.name}">
        ${deleteControl}
      </div>
      <ul class="field-list">${type.fields.map((field) => renderField(type.name, field)).join('')}</ul>
      <div class="add-field">
        <input data-new-field-name="${type.name}" value="${draft.name}" placeholder="field name">
        <select data-new-field-kind="${type.name}">
          ${FIELD_KINDS.map((kind) => `<option value="${kind}" ${kind === draft.kind ? 'selected' : ''}>${kind}</option>`).join('')}
        </select>
        <button data-add-field="${type.name}">Add field</button>
      </div>
    </li>
  `
}

export function renderComponentTypesPanel(ctx: PanelContext): string {
  const session = ctx.studio.projectSession
  return `
    <section class="panel component-types">
      <h2>Component Types</h2>
      <div class="add-component-type">
        <input data-new-component-type-name value="${ctx.ui.newComponentTypeName}" placeholder="new component type">
        <button data-add-component-type>Add</button>
      </div>
      <ul class="type-list">${componentTypes(session).map((type) => renderType(ctx, type)).join('')}</ul>
    </section>
  `
}

export function handleComponentTypesClick(target: HTMLElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const { catalog } = studio
  const session = studio.projectSession

  const add = target.closest<HTMLElement>('[data-add-component-type]')
  if (add) {
    const name = ui.newComponentTypeName.trim()
    if (name) {
      ui.lastCatalogProblems = catalog.upsertComponentType({ name, fields: [] })
      ui.newComponentTypeName = ''
      syncAndRender(ctx)
    }
    return
  }

  const del = target.closest<HTMLElement>('[data-delete-component-type]')
  if (del) {
    ui.confirmDeleteComponentType = del.dataset.deleteComponentType ?? null
    ctx.render()
    return
  }

  const cancel = target.closest<HTMLElement>('[data-cancel-delete-component-type]')
  if (cancel) {
    ui.confirmDeleteComponentType = null
    ctx.render()
    return
  }

  const confirm = target.closest<HTMLElement>('[data-confirm-delete-component-type]')
  if (confirm) {
    const name = confirm.dataset.confirmDeleteComponentType!
    catalog.deleteComponentType(name)
    ui.confirmDeleteComponentType = null
    syncAndRender(ctx)
    return
  }

  const removeField = target.closest<HTMLElement>('[data-remove-field]')
  if (removeField) {
    const [typeName, fieldName] = removeField.dataset.removeField!.split(':')
    const type = componentTypes(session).find((c) => c.name === typeName)
    if (type) {
      ui.lastCatalogProblems = catalog.upsertComponentType({ ...type, fields: type.fields.filter((f) => f.name !== fieldName) })
      syncAndRender(ctx)
    }
    return
  }

  const addField = target.closest<HTMLElement>('[data-add-field]')
  if (addField) {
    const typeName = addField.dataset.addField!
    const type = componentTypes(session).find((c) => c.name === typeName)
    const draft = fieldDraft(ui, typeName)
    if (type && draft.name.trim()) {
      ui.lastCatalogProblems = catalog.upsertComponentType({
        ...type,
        fields: [...type.fields.filter((f) => f.name !== draft.name), { name: draft.name.trim(), kind: draft.kind }],
      })
      ui.fieldDraftByType.set(typeName, { name: '', kind: 'string' })
      syncAndRender(ctx)
    }
  }
}

export function handleComponentTypesChange(target: HTMLInputElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const { catalog } = studio
  const session = studio.projectSession

  if (target.dataset.newComponentTypeName !== undefined) {
    ui.newComponentTypeName = target.value
    ctx.render()
    return
  }

  if (target.dataset.renameComponentType !== undefined) {
    const oldName = target.dataset.renameComponentType!
    const newName = target.value.trim()
    if (newName && newName !== oldName) {
      ui.lastCatalogProblems = renameComponentType(catalog, session, oldName, newName)
      syncAndRender(ctx)
    } else {
      ctx.render()
    }
    return
  }

  if (target.dataset.retypeField !== undefined) {
    const [typeName, fieldName] = target.dataset.retypeField!.split(':')
    const type = componentTypes(session).find((c) => c.name === typeName)
    if (type) {
      ui.lastCatalogProblems = catalog.upsertComponentType({
        ...type,
        fields: type.fields.map((f) => (f.name === fieldName ? { ...f, kind: target.value as ComponentFieldData['kind'] } : f)),
      })
      syncAndRender(ctx)
    }
    return
  }

  if (target.dataset.newFieldName !== undefined) {
    const typeName = target.dataset.newFieldName!
    const draft = fieldDraft(ui, typeName)
    draft.name = target.value
    ctx.render()
    return
  }

  if (target.dataset.newFieldKind !== undefined) {
    const typeName = target.dataset.newFieldKind!
    const draft = fieldDraft(ui, typeName)
    draft.kind = target.value as ComponentFieldData['kind']
    ctx.render()
  }
}
