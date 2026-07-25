import type { SystemData } from '../project.js'
import type { PanelContext } from './context.js'

/**
 * Minimal, panel-local shape check for a hand-edited system JSON blob — not
 * `project.ts`'s full `validateSystemData` (module-private, and stricter
 * than needed here: this only has to catch "not usable data", the richer
 * per-field diagnostics are out of scope until systems actually run in a
 * later milestone). Never throws; returns an error string or null.
 */
function checkSystemShape(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'expected an object'
  const obj = v as Record<string, unknown>
  if (typeof obj.name !== 'string') return '"name" must be a string'
  if (obj.schedule !== 'tick' && obj.schedule !== 'fixed') return '"schedule" must be "tick" or "fixed"'
  if (!Array.isArray(obj.query) || !obj.query.every((q) => typeof q === 'string')) return '"query" must be an array of strings'
  if (!Array.isArray(obj.actions)) return '"actions" must be an array'
  for (const action of obj.actions) {
    if (typeof action !== 'object' || action === null) return 'each action must be an object'
    const a = action as Record<string, unknown>
    if (typeof a.set !== 'string' || typeof a.expr !== 'string') return 'each action needs string "set" and "expr"'
  }
  return null
}

function renderSystem(ctx: PanelContext, system: SystemData, index: number): string {
  const { ui } = ctx
  const enabled = system.enabled !== false
  const draft = ui.systemJsonDraft.get(index)
  const error = ui.systemJsonError.get(index)
  const text = draft ?? JSON.stringify(system, null, 2)

  return `
    <li class="system-row">
      <div class="system-row-header">
        <label><input type="checkbox" data-system-enabled="${index}" ${enabled ? 'checked' : ''}> enabled</label>
        <strong>${system.name}</strong>
        <span class="schedule">${system.schedule}</span>
      </div>
      <textarea data-system-json="${index}">${text}</textarea>
      ${error ? `<p class="field-error">${error}</p>` : ''}
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

export function handleSystemsChange(target: HTMLInputElement | HTMLTextAreaElement, ctx: PanelContext): void {
  const { studio, ui } = ctx
  const session = studio.projectSession

  if (target.dataset.systemEnabled !== undefined) {
    const index = Number(target.dataset.systemEnabled)
    session.mutate((doc) => {
      const system = doc.systems[index]
      if (system) system.enabled = (target as HTMLInputElement).checked
    })
    ctx.render()
    return
  }

  if (target.dataset.systemJson !== undefined) {
    const index = Number(target.dataset.systemJson)
    const text = target.value
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      ui.systemJsonDraft.set(index, text)
      ui.systemJsonError.set(index, err instanceof Error ? err.message : 'invalid JSON')
      ctx.render()
      return
    }
    const shapeError = checkSystemShape(parsed)
    if (shapeError) {
      ui.systemJsonDraft.set(index, text)
      ui.systemJsonError.set(index, shapeError)
      ctx.render()
      return
    }
    session.mutate((doc) => {
      doc.systems[index] = parsed as SystemData
    })
    ui.systemJsonDraft.delete(index)
    ui.systemJsonError.delete(index)
    ctx.render()
  }
}
