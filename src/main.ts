import { createDomecsStudio } from './index.js'
import { mountStudio } from './ui.js'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')!
const studio = createDomecsStudio({ headless: false, ringCapacity: 240 })
const ui = mountStudio(app, studio)

studio.editorWorld.signals.tickEnd.subscribe(ui.render)
studio.guestWorld.signals.tickEnd.subscribe(() => {
  studio.sync()
  ui.render()
  // Independent of whether render()'s own memoized comparison decided a
  // full rewrite was needed this frame — the guest world just ticked, so
  // the .stage sprite subtree needs to be current regardless (M8;
  // FINDINGS.md, "A keyed/targeted patch of the .stage subtree...").
  ui.patchStage()
})
studio.editorWorld.startLoop()
