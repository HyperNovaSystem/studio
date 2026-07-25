import type { SchemaProblem } from '@domecs/persist'
import type { PanelContext } from './context.js'

/**
 * `session.problems` (load-time validation defects) plus whatever the most
 * recent mutating catalog/session call returned. Always rendered — an empty
 * list still renders the panel with an explicit "no problems" line, so a
 * bug that stops updating `ui.lastCatalogProblems` fails loud (missing
 * text) rather than by the panel silently vanishing.
 */
export function renderProblems(ctx: PanelContext): string {
  const problems: SchemaProblem[] = [...ctx.studio.projectSession.problems, ...ctx.ui.lastCatalogProblems]
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
