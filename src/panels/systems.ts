import { parseExpression } from '@domecs/rules'
import type { SystemData } from '../project.js'
import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'

/**
 * Live syntax feedback for an action's `expr` or a system's `when` field.
 * Uses `@domecs/rules`'s own `parseExpression` (never throws) so the message
 * shown here is always exactly what `compileRule`/`RulesHandle.update()`
 * would also report for a syntax error — no separate grammar to keep in
 * sync. Component-resolution errors (an unknown `Component` name) are NOT
 * caught here — those require the whole `RuleDef` compiled together against
 * the catalog, which `RulesHandle.update()` already does on every
 * `syncAndRender`; those surface via the problems strip (see problems.ts)
 * rather than duplicated per-field here.
 */
function validateExprSyntax(text: string): string | null {
  const result = parseExpression(text)
  if ('errors' in result) return result.errors.map((e) => e.message).join('; ')
  return null
}

/** Mirrors compileRule's own "set must be Component.field" shape check (rules.ts), so the same defect is flagged in the same words before it ever reaches compileRule. */
function validateSetShape(text: string): string | null {
  const dotIdx = text.indexOf('.')
  if (dotIdx <= 0 || dotIdx === text.length - 1) return `must be "Component.field", got "${text}"`
  return null
}

function renderAction(systemIndex: number, action: { set: string; expr: string }, actionIndex: number, count: number): string {
  const key = `${systemIndex}:${actionIndex}`
  const setError = validateSetShape(action.set)
  const exprError = validateExprSyntax(action.expr)
  return `
    <li class="action-row">
      <input data-action-set="${key}" value="${action.set}" placeholder="Component.field">
      <input data-action-expr="${key}" value="${action.expr}" placeholder="expression">
      <button data-action-up="${key}" ${actionIndex === 0 ? 'disabled' : ''}>Up</button>
      <button data-action-down="${key}" ${actionIndex === count - 1 ? 'disabled' : ''}>Down</button>
      <button data-remove-action="${key}">Remove</button>
      ${setError ? `<p class="field-error" data-action-set-error="${key}">${setError}</p>` : ''}
      ${exprError ? `<p class="field-error" data-action-expr-error="${key}">${exprError}</p>` : ''}
    </li>
  `
}

function renderQuery(ctx: PanelContext, systemIndex: number, system: SystemData): string {
  const descriptors = ctx.studio.catalog.registeredTypes()
  return `
    <fieldset class="system-query">
      <legend>Query</legend>
      ${descriptors
        .map(
          (d) =>
            `<label><input type="checkbox" data-system-query="${systemIndex}:${d.name}" ${system.query.includes(d.name) ? 'checked' : ''}>${d.name}</label>`,
        )
        .join('')}
    </fieldset>
  `
}

function renderWhen(systemIndex: number, when: string | undefined): string {
  const text = when ?? ''
  const error = text.trim() === '' ? null : validateExprSyntax(text)
  return `
    <div class="system-when">
      <label>When (optional)<input data-system-when="${systemIndex}" value="${text}" placeholder="e.g. Health.hp < 5"></label>
      ${error ? `<p class="field-error" data-system-when-error="${systemIndex}">${error}</p>` : ''}
    </div>
  `
}

function renderSystem(ctx: PanelContext, system: SystemData, index: number): string {
  const enabled = system.enabled !== false
  return `
    <li class="system-row">
      <div class="system-row-header">
        <label><input type="checkbox" data-system-enabled="${index}" ${enabled ? 'checked' : ''}> enabled</label>
        <input data-system-name="${index}" value="${system.name}">
        <select data-system-schedule="${index}">
          <option value="tick" ${system.schedule === 'tick' ? 'selected' : ''}>tick</option>
          <option value="fixed" ${system.schedule === 'fixed' ? 'selected' : ''}>fixed</option>
        </select>
      </div>
      ${renderQuery(ctx, index, system)}
      ${renderWhen(index, system.when)}
      <ul class="system-actions">${system.actions.map((action, actionIndex) => renderAction(index, action, actionIndex, system.actions.length)).join('')}</ul>
      <button data-add-action="${index}">Add action</button>
    </li>
  `
}

export function renderSystemsPanel(ctx: PanelContext): string {
  const systems = ctx.studio.projectSession.doc.systems
  return `
    <section class="panel systems">
      <h2>Systems</h2>
      <ul class="system-list">${systems.map((system, index) => renderSystem(ctx, system, index)).join('')}</ul>
    </section>
  `
}

/**
 * Text/select/checkbox commits — same "change" convention every other panel
 * in this codebase uses (no panel here wires "input"); the raw field text is
 * always written to the doc as-is, valid or not (never silently dropped),
 * with syntax feedback rendered separately by the (pure, doc-state-derived)
 * render functions above. Every branch calls `syncAndRender`, which re-applies
 * the RulesHandle (see studio.ts's `sync()`) so an edit takes effect on the
 * guest world's very next tick.
 */
export function handleSystemsChange(target: HTMLInputElement | HTMLSelectElement, ctx: PanelContext): void {
  const { studio } = ctx
  const session = studio.projectSession

  if (target.dataset.systemEnabled !== undefined) {
    const index = Number(target.dataset.systemEnabled)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.enabled = (target as HTMLInputElement).checked
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.systemName !== undefined) {
    const index = Number(target.dataset.systemName)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.name = target.value
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.systemSchedule !== undefined) {
    const index = Number(target.dataset.systemSchedule)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.schedule = target.value as SystemData['schedule']
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.systemQuery !== undefined) {
    const [indexText, componentName] = target.dataset.systemQuery.split(':')
    const index = Number(indexText)
    const checked = (target as HTMLInputElement).checked
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (!system) return
      if (checked) {
        if (!system.query.includes(componentName!)) system.query.push(componentName!)
      } else {
        system.query = system.query.filter((q) => q !== componentName)
      }
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.systemWhen !== undefined) {
    const index = Number(target.dataset.systemWhen)
    const text = target.value
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (!system) return
      if (text.trim() === '') delete system.when
      else system.when = text
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.actionSet !== undefined) {
    const [indexText, actionIndexText] = target.dataset.actionSet.split(':')
    const index = Number(indexText)
    const actionIndex = Number(actionIndexText)
    session.mutate((doc) => {
      const action = doc.systems[index]?.actions[actionIndex]
      if (action) action.set = target.value
    })
    syncAndRender(ctx)
    return
  }

  if (target.dataset.actionExpr !== undefined) {
    const [indexText, actionIndexText] = target.dataset.actionExpr.split(':')
    const index = Number(indexText)
    const actionIndex = Number(actionIndexText)
    session.mutate((doc) => {
      const action = doc.systems[index]?.actions[actionIndex]
      if (action) action.expr = target.value
    })
    syncAndRender(ctx)
  }
}

/** Add/remove/reorder action rows — click-triggered, so a separate delegate from `handleSystemsChange` (mirrors every other panel's click/change split in this codebase). */
export function handleSystemsClick(target: HTMLElement, ctx: PanelContext): void {
  const { studio } = ctx
  const session = studio.projectSession

  const addAction = target.closest<HTMLElement>('[data-add-action]')
  if (addAction) {
    const index = Number(addAction.dataset.addAction)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.actions.push({ set: '', expr: '' })
    })
    syncAndRender(ctx)
    return
  }

  const removeAction = target.closest<HTMLElement>('[data-remove-action]')
  if (removeAction) {
    const [indexText, actionIndexText] = removeAction.dataset.removeAction!.split(':')
    const index = Number(indexText)
    const actionIndex = Number(actionIndexText)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.actions.splice(actionIndex, 1)
    })
    syncAndRender(ctx)
    return
  }

  const up = target.closest<HTMLElement>('[data-action-up]')
  if (up) {
    const [indexText, actionIndexText] = up.dataset.actionUp!.split(':')
    const index = Number(indexText)
    const actionIndex = Number(actionIndexText)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system && actionIndex > 0) {
        const actions = system.actions
        const swap = actions[actionIndex - 1]!
        actions[actionIndex - 1] = actions[actionIndex]!
        actions[actionIndex] = swap
      }
    })
    syncAndRender(ctx)
    return
  }

  const down = target.closest<HTMLElement>('[data-action-down]')
  if (down) {
    const [indexText, actionIndexText] = down.dataset.actionDown!.split(':')
    const index = Number(indexText)
    const actionIndex = Number(actionIndexText)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system && actionIndex < system.actions.length - 1) {
        const actions = system.actions
        const swap = actions[actionIndex + 1]!
        actions[actionIndex + 1] = actions[actionIndex]!
        actions[actionIndex] = swap
      }
    })
    syncAndRender(ctx)
  }
}
