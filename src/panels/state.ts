import type { FieldKind } from '@domecs/core'
import type { SchemaProblem } from '@domecs/persist'

/**
 * Every `FieldKind` a reflection widget can render. `@domecs/core` exports
 * only the *type* (a literal union), not a runtime list, so this mirrors it
 * locally — same set `@domecs/persist`'s (private) schema.ts registration
 * validates against.
 */
export const FIELD_KINDS: readonly FieldKind[] = ['number', 'string', 'boolean', 'enum', 'object', 'unknown']

/**
 * Ephemeral, view-only UI state that has no place in `ProjectDocument` or the
 * ECS worlds: in-progress "new X" form drafts, which delete confirmation (if
 * any) is pending, and the raw/invalid text of a not-yet-valid JSON edit.
 * Owned by `mountStudio`'s closure and threaded through `renderStudioHtml` so
 * rendering stays a pure function of (studio, ui). Never persisted, never
 * exercises `session.mutate` on its own.
 */
export interface UiState {
  /** Draft name for a not-yet-created component type. */
  newComponentTypeName: string
  /** Per-component-type draft for the next field to add: name + kind. */
  fieldDraftByType: Map<string, { name: string; kind: FieldKind }>
  /** Component type name pending a delete confirmation (two-step delete). */
  confirmDeleteComponentType: string | null
  /** Draft name for a not-yet-created entity type. */
  newEntityTypeName: string
  /** Component names checked so far while building a new entity type. */
  newEntityTypeComponents: Set<string>
  /** Entity type selected in the tree's "add from type" dropdown. */
  spawnEntityType: string
  /** Raw (possibly invalid) textarea text per system index, keyed while the parsed value has not yet validated. */
  systemJsonDraft: Map<number, string>
  /** Validation error message per system index, cleared once that system's JSON parses and applies. */
  systemJsonError: Map<number, string>
  /** Problems returned by the most recently invoked mutating catalog/session call (upsert or reload); never hidden. */
  lastCatalogProblems: SchemaProblem[]
}

export function createUiState(): UiState {
  return {
    newComponentTypeName: '',
    fieldDraftByType: new Map(),
    confirmDeleteComponentType: null,
    newEntityTypeName: '',
    newEntityTypeComponents: new Set(),
    spawnEntityType: '',
    systemJsonDraft: new Map(),
    systemJsonError: new Map(),
    lastCatalogProblems: [],
  }
}

function fieldDraft(ui: UiState, typeName: string): { name: string; kind: FieldKind } {
  let draft = ui.fieldDraftByType.get(typeName)
  if (!draft) {
    draft = { name: '', kind: 'string' }
    ui.fieldDraftByType.set(typeName, draft)
  }
  return draft
}

export { fieldDraft }
