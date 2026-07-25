import type { SchemaProblem } from '@domecs/persist'
import type { RuleError } from '@domecs/rules'
import type { PanelContext } from './context.js'

/**
 * Reshapes `StudioRefs.ruleErrors()` (a `Map<string, RuleError[]>` keyed by
 * system/rule name) into the same `{path, message}` shape every other
 * problem source here already uses, rather than inventing a second surface
 * for it. `position` (character offset within the offending expression, or
 * -1 for a non-syntax error — see `RuleError`'s own doc) is appended to the
 * path only when meaningful.
 */
function ruleErrorsAsProblems(ruleErrors: Map<string, RuleError[]>): SchemaProblem[] {
  const out: SchemaProblem[] = []
  for (const [name, errors] of ruleErrors) {
    for (const error of errors) {
      out.push({ path: `systems["${name}"]${error.position >= 0 ? ` @${error.position}` : ''}`, message: error.message })
    }
  }
  return out
}

/**
 * `session.problems` (load-time validation defects) plus whatever the most
 * recent mutating catalog/session call returned, plus any rule compile
 * errors from the most recently applied @domecs/rules pass. Always
 * rendered — an empty list still renders the panel with an explicit "no
 * problems" line, so a bug that stops updating `ui.lastCatalogProblems`
 * fails loud (missing text) rather than by the panel silently vanishing.
 */
export function renderProblems(ctx: PanelContext): string {
  const problems: SchemaProblem[] = [
    ...ctx.studio.projectSession.problems,
    ...ctx.ui.lastCatalogProblems,
    ...ruleErrorsAsProblems(ctx.studio.ruleErrors()),
  ]
  return `
    <section class="panel problems">
      <h2>Problems${problems.length > 0 ? ` (${problems.length})` : ''}</h2>
      ${
        problems.length === 0
          ? '<p class="no-problems">No problems.</p>'
          : `<ul>${problems.map((p) => `<li><code>${p.path || '(root)'}</code> ${p.message}</li>`).join('')}</ul>`
      }
    </section>
  `
}
