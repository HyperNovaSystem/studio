import type { PanelContext } from './context.js'
import { syncAndRender } from './context.js'

export function renderToolbar(ctx: PanelContext): string {
  const { doc, dirty } = ctx.studio.projectSession
  return `
    <div class="toolbar">
      <button data-project-new>New</button>
      <button data-project-open>Open</button>
      <button data-project-save>Save</button>
      <button data-project-save-as>Save As</button>
      <span class="project-name">${doc.meta.name}</span>
      <span class="dirty-marker" data-dirty="${dirty}">${dirty ? '● unsaved' : 'saved'}</span>
    </div>
  `
}

export function handleToolbarClick(target: HTMLElement, ctx: PanelContext): void {
  const { studio } = ctx
  const session = studio.projectSession

  if (target.closest('[data-project-new]')) {
    session.newProject()
    ctx.ui.lastCatalogProblems = studio.catalog.reload()
    syncAndRender(ctx)
    return
  }
  if (target.closest('[data-project-open]')) {
    void session.open().then(() => {
      ctx.ui.lastCatalogProblems = studio.catalog.reload()
      syncAndRender(ctx)
    })
    return
  }
  if (target.closest('[data-project-save]')) {
    void session.save().then(() => {
      ctx.ui.lastCatalogProblems = studio.catalog.reload()
      syncAndRender(ctx)
    })
    return
  }
  if (target.closest('[data-project-save-as]')) {
    void session.saveAs().then(() => {
      ctx.ui.lastCatalogProblems = studio.catalog.reload()
      syncAndRender(ctx)
    })
  }
}
