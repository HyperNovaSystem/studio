# DOMECS Studio

DOMECS exemplar #6 from `domecs/doc/exemplars.md`: a live-editing tool for DOMECS games and apps.

## Spec slice

- Runs **two DOMECS worlds at once**: an editor world for chrome/tool state and a hosted guest world being edited.
- Installs as a `domecs-studio` plugin into the guest world and uses plugin lifecycle hooks:
  - `onRender` for overlay render accounting;
  - `onTickEnd` for time-travel capture;
  - `onSnapshot` to redact development-only guest state.
- Reflects guest component types through `world.componentTypes()` plus Studio field-schema metadata to generate inspector widgets.
- Exposes live entity/component introspection through `inspectEntities()` and `inspectEntity(id)`, returning detached component values safe for tooling to display.
- Stores selection, hover, and highlight as editor-side `GuestReference` components that point at guest entity ids.
- Maintains a bounded diff-based snapshot ring buffer for time-travel scrubbing instead of retaining one full snapshot per frame.
- Includes entity tree, component inspector, prefab library, visual script bindings, scene save/load, play/pause/step, and guest viewport projections.

## Development

```sh
npm install
npm test
npm run dev
```

## Introspection API

```ts
const studio = createDomecsStudio({ guestWorld })

for (const entity of studio.inspectEntities()) {
  console.log(entity.id, entity.label)
  for (const component of entity.components) {
    console.log(component.name, component.descriptor, component.value)
  }
}

const selected = studio.inspectEntity(selectedEntityId)
```

Inspection values are detached copies: changing them cannot mutate the guest
world or bypass DOMECS change tracking. Use `studio.editField(...)` for edits.

The demo UI is intentionally vanilla DOM so the exemplar stresses DOMECS multi-world/plugin/reflection behavior rather than a framework adapter.
