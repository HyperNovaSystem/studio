import { Has } from '@domecs/core'
import type { EntityView } from '@domecs/core'
import { ComponentInspector, EntityTreeNode, GuestSprite, GuestTransform, InspectorField, PlaybackState, StudioRoot, TimeTravelScrubber } from './components.js'
import type { StudioRefs } from './studio.js'
import { createUiState, type UiState } from './panels/state.js'
import type { PanelContext } from './panels/context.js'
import { handleToolbarClick, renderToolbar } from './panels/toolbar.js'
import { renderProblems } from './panels/problems.js'
import { handleComponentTypesChange, handleComponentTypesClick, renderComponentTypesPanel } from './panels/componentTypes.js'
import { handleEntityTypesChange, handleEntityTypesClick, renderEntityTypesPanel } from './panels/entityTypes.js'
import { handleSystemsChange, renderSystemsPanel } from './panels/systems.js'

export interface StudioUi {
  /** Re-render, writing to the DOM only when the markup actually changed. */
  render(): void
}

export function renderStudioHtml(studio: StudioRefs, ui: UiState = createUiState()): string {
  const ctx: PanelContext = { studio, ui, render: () => {} }
  const root = studio.editorWorld.getComponent(studio.studioId, StudioRoot)!
  const playback = studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!
  const scrubber = studio.editorWorld.getComponent(studio.scrubberId, TimeTravelScrubber)!
  const tree = studio.editorWorld.query(Has(EntityTreeNode)).entities as Array<EntityView & { EntityTreeNode: { guestEntityId: number; label: string; componentCount: number; selected: boolean } }>
  const components = studio.editorWorld.query(Has(ComponentInspector)).entities as Array<EntityView & { ComponentInspector: { componentName: string } }>
  const fields = studio.editorWorld.query(Has(InspectorField)).entities as Array<EntityView & { InspectorField: { guestEntityId: number; componentName: string; field: string; valuePreview: string } }>

  return `
    <main class="studio-shell">
      <header class="topbar">
        <div><strong>${root.title}</strong><span>${root.guestTitle}</span></div>
        <div class="stats">editor ${root.editorEntityCount} · guest ${root.guestEntityCount} · reflected ${root.reflectedComponentTypes}</div>
        ${renderToolbar(ctx)}
      </header>
      ${renderProblems(ctx)}
      <section class="panel tree">
        <h2>Entity Tree</h2>
        ${tree.map((row) => `<button class="tree-row ${row.EntityTreeNode.selected ? 'selected' : ''}" data-select="${row.EntityTreeNode.guestEntityId}">${row.EntityTreeNode.label}<small>${row.EntityTreeNode.componentCount}</small></button>`).join('')}
      </section>
      <section class="panel viewport">
        <h2>Guest Viewport</h2>
        <div class="stage">
          ${studio.guestWorld.snapshot().entities.map((entity) => {
            const transform = studio.guestWorld.getComponent(entity.id, GuestTransform)
            const sprite = studio.guestWorld.getComponent(entity.id, GuestSprite)
            if (!transform || !sprite?.visible) return ''
            return `<div class="sprite ${sprite.kind}" style="--x:${transform.x}px;--y:${transform.y}px;--r:${transform.rotation}deg;--tint:${sprite.tint}"></div>`
          }).join('')}
        </div>
        <div class="transport">
          <button data-step="1">Step</button>
          <button data-play="${playback.mode === 'playing' ? 'paused' : 'playing'}">${playback.mode === 'playing' ? 'Pause' : 'Play'}</button>
          <span>steps ${playback.stepCount}</span>
        </div>
      </section>
      <section class="panel inspector">
        <h2>Inspector</h2>
        ${components.map((component) => `<h3>${component.ComponentInspector.componentName}</h3>${fields.filter((field) => field.InspectorField.componentName === component.ComponentInspector.componentName).map((field) => `<label>${field.InspectorField.field}<input data-edit="${field.InspectorField.guestEntityId}:${field.InspectorField.componentName}:${field.InspectorField.field}" value="${field.InspectorField.valuePreview}"></label>`).join('')}`).join('')}
      </section>
      <section class="panel timeline">
        <h2>Time Travel</h2>
        <p>${scrubber.length}/${scrubber.capacity} snapshots · checkpoint ${scrubber.cursor + 1}/${scrubber.length}</p>
        <input type="range" min="0" max="${Math.max(0, scrubber.length - 1)}" value="${scrubber.cursor}" data-scrub>
      </section>
      ${renderComponentTypesPanel(ctx)}
      ${renderEntityTypesPanel(ctx)}
      ${renderSystemsPanel(ctx)}
    </main>
  `
}

export function mountStudio(app: HTMLElement, studio: StudioRefs): StudioUi {
  let lastHtml: string | null = null
  const ui = createUiState()

  function render(): void {
    const html = renderStudioHtml(studio, ui)
    // The editor world ticks every frame. Reassigning innerHTML on an
    // unchanged render destroys the node between mousedown and mouseup, so no
    // click event ever fires and focused inputs lose their caret.
    if (html === lastHtml) return
    lastHtml = html
    const focusKey = focusedKey(app)
    app.innerHTML = html
    if (focusKey) restoreFocus(app, focusKey)
  }

  const ctx: PanelContext = { studio, ui, render }

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const select = target.closest<HTMLElement>('[data-select]')
    if (select) studio.select(Number(select.dataset.select))
    const step = target.closest<HTMLElement>('[data-step]')
    if (step) studio.stepGuest(Number(step.dataset.step))
    const play = target.closest<HTMLElement>('[data-play]')
    if (play) studio.setPlayback(play.dataset.play as 'paused' | 'playing')
    handleToolbarClick(target, ctx)
    handleComponentTypesClick(target, ctx)
    handleEntityTypesClick(target, ctx)
    render()
  })

  app.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement
    if (target.dataset.edit) {
      const [id, component, field] = target.dataset.edit.split(':')
      studio.editField(Number(id), component!, field!, target.value)
    }
    if (target.dataset.scrub !== undefined) studio.scrub(Number(target.value))
    handleComponentTypesChange(target, ctx)
    handleEntityTypesChange(target, ctx)
    handleSystemsChange(target, ctx)
    render()
  })

  render()
  return { render }
}

// Generalized over every `[data-x]`-tagged input/textarea/select this module
// or a panel renders, rather than a hardcoded list of tracked attributes: any
// element with exactly one dataset entry (the convention every control here
// follows) can be re-found by rebuilding its `[data-x="value"]` selector.
// New panel controls get focus-restore for free without touching this file.
function focusedKey(app: HTMLElement): string | null {
  const active = app.ownerDocument?.activeElement as HTMLElement | null
  if (!active || !app.contains(active)) return null
  const dataset = active.dataset
  if (!dataset) return null
  const key = Object.keys(dataset)[0]
  if (key === undefined) return null
  const attr = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
  return `[data-${attr}="${dataset[key] ?? ''}"]`
}

function restoreFocus(app: HTMLElement, selector: string): void {
  app.querySelector<HTMLElement>(selector)?.focus()
}
