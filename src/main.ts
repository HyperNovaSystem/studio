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
})
studio.editorWorld.startLoop()
