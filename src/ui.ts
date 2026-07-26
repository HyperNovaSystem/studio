import { Has } from '@domecs/core'
import type { EntityView } from '@domecs/core'
import { ComponentInspector, GuestTransform, InspectorField, PlaybackState, StudioRoot, TimeTravelScrubber } from './components.js'
import type { StudioRefs } from './studio.js'
import { mountStage, type StageHandle } from './stage.js'
import { clientToWorld, createDragState, type StageRect } from './gesture.js'
import { createUiState, type UiState } from './panels/state.js'
import type { PanelContext } from './panels/context.js'
import { syncAndRender } from './panels/context.js'
import { handleToolbarClick, renderToolbar } from './panels/toolbar.js'
import { renderProblems } from './panels/problems.js'
import { handleComponentTypesChange, handleComponentTypesClick, renderComponentTypesPanel } from './panels/componentTypes.js'
import { handleEntityTypesChange, handleEntityTypesClick, renderEntityTypesPanel } from './panels/entityTypes.js'
import { handleSystemsChange, handleSystemsClick, renderSystemsPanel } from './panels/systems.js'
import { duplicateEntity, handleTreeChange, handleTreeClick, handleTreeDragStart, handleTreeDrop, requestDespawn, renderTreePanel } from './panels/tree.js'

export interface StudioUi {
  /** Re-render, writing to the DOM only when the markup actually changed. */
  render(): void
  /**
   * Patch the `.stage` sprite subtree, independent of whether render()'s
   * outer memoized rewrite decided a full rewrite was needed this frame.
   * The guest world can tick (moving sprites) via paths that don't always
   * change the outer markup too, so sprite positions must not depend on
   * that memoized comparison to reach the DOM — call this alongside
   * render() on every guest-world tick end. See FINDINGS.md, "A
   * keyed/targeted patch of the .stage subtree...".
   */
  patchStage(): void
}

/**
 * A second "spawn from entityType" control, alongside the tree panel's
 * (`renderAddFromType` in panels/tree.ts), scoped to the viewport instead.
 *
 * M9 spec intent is drag-from-palette-onto-stage spawning at the drop
 * point; this app implements the explicitly-noted simpler alternative
 * instead — plain click-to-spawn-at-stage-center — since a real HTML5
 * drag-from-palette-onto-stage interaction is disproportionate effort for
 * this milestone versus the value it adds over the click affordance (see
 * FINDINGS.md). World (0, 0) already IS the stage's geometric center (see
 * gesture.ts's `clientToWorld` doc comment), so spawning at literal (0, 0)
 * is spawning at stage center, no separate "center" constant needed.
 *
 * Distinct `data-viewport-spawn*` attributes (rather than reusing
 * `data-spawn-from-type`) so this control and the tree panel's don't
 * collide as two elements answering the same selector; both still share
 * `ui.spawnEntityType` as the single "currently chosen type to spawn"
 * field, so picking a type in either control updates the other's shown
 * selection too.
 */
function renderViewportPalette(ctx: PanelContext): string {
  const entityTypes = ctx.studio.catalog.entityTypes()
  if (entityTypes.length === 0) return ''
  const selected = ctx.ui.spawnEntityType || entityTypes[0]!.name
  return `
    <div class="viewport-palette">
      <select data-viewport-spawn-type>
        ${entityTypes.map((et) => `<option value="${et.name}" ${et.name === selected ? 'selected' : ''}>${et.name}</option>`).join('')}
      </select>
      <button data-viewport-spawn>Spawn at Center</button>
    </div>
  `
}

// Renders `.stage` as an empty `[data-stage-mount]` placeholder only — never
// sprite markup. Before M8, the `.stage` `<div>` embedded one `<div
// class="sprite ...">` per visible guest entity directly in this string via
// `.map().join()`, so any sprite moving (which happens every guest tick)
// changed mountStudio's memoized comparison and forced a full
// `app.innerHTML` rewrite, same as any other state change (FINDINGS.md, "A
// keyed/targeted patch of the .stage subtree would remove the remaining
// window"). `mountStage` (src/stage.ts) now owns everything inside the
// placeholder via its own keyed Map<Entity, HTMLElement>, patched by
// `mountStudio` independently of this function's memoized output.
export function renderStudioHtml(studio: StudioRefs, ui: UiState = createUiState()): string {
  const ctx: PanelContext = { studio, ui, render: () => {} }
  const root = studio.editorWorld.getComponent(studio.studioId, StudioRoot)!
  const playback = studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!
  const scrubber = studio.editorWorld.getComponent(studio.scrubberId, TimeTravelScrubber)!
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
      ${renderTreePanel(ctx)}
      <section class="panel viewport">
        <h2>Guest Viewport</h2>
        ${renderViewportPalette(ctx)}
        <!-- Empty on purpose: mountStage (src/stage.ts) owns every sprite
             element inside this container via a keyed patch, independent of
             this outer memoized rewrite. Never render sprite markup into
             this string -- see the comment on renderStudioHtml above.
             tabindex="-1" makes it programmatically focusable (not tab-order
             focusable) so Delete/Backspace/Ctrl+D keydowns reach the app-root
             listener after a pointerdown-select focuses it (see mountStudio's
             pointerdown handler) -- a plain click on a non-focusable div
             would otherwise leave focus wherever it already was, outside
             #app, and a bubbling keydown would never reach here. -->
        <div class="stage" data-stage-mount tabindex="-1"></div>
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
  let stage: StageHandle | null = null
  let stageMountEl: HTMLElement | null = null
  // Pointer-drag gesture state (M9) — a plain closure-local instance, same
  // "transient interaction state lives in a testable, DOM-free field"
  // convention `ui.draggedGuestEntityId` already established for the tree
  // panel's HTML5 drag-and-drop (see UiState's doc comment). This one is
  // pointerdown/pointermove/pointerup, not HTML5 DnD, so it does not belong
  // in `UiState` (it is never read/written by any panel's render/handle
  // function) — it lives here instead, scoped to this mount.
  const drag = createDragState()

  // Re-find the `.stage` placeholder `renderStudioHtml` renders (always
  // empty — see the comment on that section). `mountStage`'s internal
  // Map<Entity, HTMLElement> holds direct references into whatever
  // container it was given, so if `app.innerHTML = html` replaced that
  // container since the last call (a fresh object even when the resulting
  // markup looks identical — real DOM parses/allocates new nodes on every
  // assignment), those references are now dangling: re-mount against the
  // fresh element rather than patching detached nodes. Comparing by
  // reference (rather than tracking "did render() just rewrite?") also
  // covers first mount, where `stageMountEl` starts null.
  function ensureStageMounted(): StageHandle | null {
    const mountEl = app.querySelector<HTMLElement>('[data-stage-mount]')
    if (!mountEl) return null
    if (mountEl !== stageMountEl) {
      stage = mountStage(mountEl, studio)
      stageMountEl = mountEl
    }
    return stage
  }

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
    // The rewrite just destroyed whatever `.stage` container (and every
    // sprite element mountStage was tracking) existed and replaced it with a
    // fresh, empty placeholder — repaint it immediately so the viewport
    // isn't blank until the next guest tick (which may never come while
    // paused). patchStage() below covers the complementary case: a guest
    // tick that reaches here without render() deciding a rewrite was needed.
    ensureStageMounted()?.patch()
  }

  const ctx: PanelContext = { studio, ui, render }

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const step = target.closest<HTMLElement>('[data-step]')
    if (step) studio.stepGuest(Number(step.dataset.step))
    const play = target.closest<HTMLElement>('[data-play]')
    if (play) studio.setPlayback(play.dataset.play as 'paused' | 'playing')
    handleToolbarClick(target, ctx)
    handleComponentTypesClick(target, ctx)
    handleEntityTypesClick(target, ctx)
    handleSystemsClick(target, ctx)
    handleTreeClick(target, ctx)
    const viewportSpawn = target.closest<HTMLElement>('[data-viewport-spawn]')
    if (viewportSpawn) {
      const entityTypes = studio.catalog.entityTypes()
      const name = ui.spawnEntityType || entityTypes[0]?.name
      if (name) {
        // (0, 0) is exactly the stage's geometric center — see
        // gesture.ts's clientToWorld doc comment. Spec: "the new entity is
        // auto-selected".
        const id = studio.catalog.spawnFromType(name, 0, 0)
        if (id !== null) studio.select(id)
      }
      syncAndRender(ctx)
    }
    render()
  })

  // First HTML5 drag-and-drop interaction in this app: dragstart records
  // which row is being dragged (ui.draggedGuestEntityId — see UiState's doc
  // comment for why this app-level state, not event.dataTransfer, is the
  // source of truth); dragover must call preventDefault to opt a drop
  // target into accepting a drop at all (DOM default is to reject it); drop
  // does the actual reparent.
  app.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement
    handleTreeDragStart(target, ctx)
  })

  app.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement
    if (target.closest?.('[data-drag-entity]') || target.closest?.('[data-drag-root]')) {
      event.preventDefault?.()
    }
  })

  app.addEventListener('drop', (event) => {
    event.preventDefault?.()
    const target = event.target as HTMLElement
    handleTreeDrop(target, ctx)
    render()
  })

  app.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement
    if (target.dataset.edit) {
      const [id, component, field] = target.dataset.edit.split(':')
      studio.editField(Number(id), component!, field!, target.value)
    }
    if (target.dataset.scrub !== undefined) studio.scrub(Number(target.value))
    if (target.dataset.viewportSpawnType !== undefined) ui.spawnEntityType = target.value
    handleComponentTypesChange(target, ctx)
    handleEntityTypesChange(target, ctx)
    handleSystemsChange(target, ctx)
    handleTreeChange(target, ctx)
    render()
  })

  // Pointer-driven pick/drag (M9) — pointerdown/pointermove/pointerup, NOT
  // HTML5 drag-and-drop (that's the tree panel's reparenting, above), so it
  // needs its own listeners and its own coordinate math (gesture.ts). All
  // three are delegated on `app`, matching every other listener in this
  // function (single-root delegation).
  app.addEventListener('pointerdown', (event) => {
    const pe = event as PointerEvent
    const target = pe.target as HTMLElement
    const spriteEl = target.closest?.<HTMLElement>('[data-entity]')
    if (spriteEl) {
      const id = Number(spriteEl.dataset.entity)
      // Existing selection plumbing (PlaybackState.selectedGuestEntity) —
      // already drives the tree row's `.selected` highlight and the
      // inspector; wiring the same call here gives the viewport the same
      // selection state for free.
      studio.select(id)
      const stageEl = ensureStageMounted() ? stageMountEl : null
      if (stageEl) {
        // Focus the stage so a subsequent Delete/Backspace/Ctrl+D keydown
        // (bubbling from whatever has focus) reaches this app-root
        // listener — a plain click on a non-focusable div would otherwise
        // leave focus wherever it already was.
        stageEl.focus?.()
        const world = clientToWorld(stageRectOf(stageEl), pe.clientX, pe.clientY)
        const transform = studio.guestWorld.getComponent(id, GuestTransform)
        if (transform) drag.begin(id, world, { x: transform.x, y: transform.y })
      }
      render()
      return
    }
    // Empty-stage click (not on any sprite, but still inside the stage
    // itself) deselects.
    if (target.closest?.('[data-stage-mount]')) {
      studio.select(null)
      render()
    }
  })

  app.addEventListener('pointermove', (event) => {
    if (drag.draggingEntity === null) return
    const pe = event as PointerEvent
    if (!stageMountEl) return
    const world = clientToWorld(stageRectOf(stageMountEl), pe.clientX, pe.clientY)
    const next = drag.moveTo(world)
    const transform = studio.guestWorld.getComponent(drag.draggingEntity, GuestTransform)
    if (transform) {
      // Writes the LOCAL GuestTransform directly — exactly like the
      // inspector's editField flow already does (studio.ts's
      // studio.inspect.edit system: `component[field] = ...;
      // markChanged(...)`), not WorldTransform (derived/read-only). A
      // dragged entity that is itself parented still tracks correctly next
      // tick: composeTransforms recomposes World_ from this local value plus
      // the (unmodified) parent chain, so no parent-WorldTransform
      // compensation is needed here.
      transform.x = next.x
      transform.y = next.y
      studio.guestWorld.markChanged(drag.draggingEntity, GuestTransform)
    }
    // Re-sync + repaint on every pointermove (not throttled to rAF) so the
    // drag is visually live. This mirrors, at per-move granularity, the
    // exact sequence main.ts already runs after every guest tick —
    // `studio.sync(); ui.render(); ui.patchStage()` — which this codebase
    // already accepts at per-frame frequency while playing, so doing the
    // same per pointermove is not a new cost class. `sync()` also keeps the
    // inspector's live X/Y fields current during the drag, not just the
    // sprite. `stage.patch()` specifically is what actually moves the
    // sprite: M8 moved sprite markup out of render()'s own memoized string,
    // so render() alone never repaints a moved sprite.
    studio.sync()
    render()
    ensureStageMounted()?.patch()
  })

  app.addEventListener('pointerup', () => {
    if (drag.draggingEntity === null) return
    drag.end()
    // One history checkpoint for the WHOLE drag gesture (not per
    // pointermove) — mirrors the studio-plugin bridge's own
    // onTickEnd -> history.push() (src/plugin.ts), but for a direct
    // component mutation that never ticks the guest world on its own.
    studio.bridge.history?.push()
  })

  // Delete/Backspace despawns the viewport's current selection (reusing the
  // SAME despawn-with-confirm logic the tree row's delete button uses —
  // requestDespawn, factored out of panels/tree.ts specifically so there is
  // only one copy of that confirmation-state decision); Ctrl+D/Cmd+D
  // duplicates it with a small position offset. Guarded against firing
  // while the user is typing in any text control — Backspace must keep
  // editing text, not despawn the selected entity out from under them.
  app.addEventListener('keydown', (event) => {
    const ke = event as KeyboardEvent
    if (isEditableTarget(ke.target)) return
    const playback = studio.editorWorld.getComponent(studio.playbackId, PlaybackState)!
    const selected = playback.selectedGuestEntity
    if (selected === null) return

    if (ke.key === 'Delete' || ke.key === 'Backspace') {
      ke.preventDefault?.()
      requestDespawn(selected, ctx)
      return
    }

    if ((ke.ctrlKey || ke.metaKey) && (ke.key === 'd' || ke.key === 'D')) {
      ke.preventDefault?.()
      const newId = duplicateEntity(studio.guestWorld, selected)
      if (newId !== null) {
        // +16,+16 so the copy is visibly distinct rather than stacked
        // exactly on top of the original.
        const transform = studio.guestWorld.getComponent(newId, GuestTransform)
        if (transform) {
          transform.x += 16
          transform.y += 16
          studio.guestWorld.markChanged(newId, GuestTransform)
        }
        studio.select(newId)
      }
      syncAndRender(ctx)
    }
  })

  render()
  return {
    render,
    patchStage() {
      ensureStageMounted()?.patch()
    },
  }
}

// Plain-object copy of the bits of `DOMRect` `clientToWorld` needs (its
// `StageRect` parameter type) — `getBoundingClientRect()` itself already
// returns exactly this shape (plus `right`/`bottom`/`x`/`y`, unused here).
function stageRectOf(el: HTMLElement): StageRect {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

// Delete/Backspace/Ctrl+D must not fire while the user is typing in any
// text control — every editable control in this app (name fields, JSON/expr
// textareas, entity-type checkboxes-as-select) is one of these three tags.
function isEditableTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
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
