// App entry: window → PaneManager → services → IPC.
import { app } from 'electron'
import { ExportService } from './ExportService'
import { makeEmit, registerIpc } from './ipc'
import { PaneManager } from './PaneManager'
import { ShotService } from './ShotService'
import { createWindow } from './window'

app.setName('Potato')

void app.whenReady().then(async () => {
  const win = createWindow()
  const emit = makeEmit(win)
  const paneManager = new PaneManager(win, emit)
  const shotService = new ShotService(win)
  const exportService = new ExportService()
  // Register handlers BEFORE any await — the renderer starts loading inside
  // createWindow() and its first invokes must not race handler registration.
  registerIpc(win, paneManager, shotService, exportService)
  // A failed first attach is recoverable — load() self-heals the pane on demand.
  await paneManager.ensurePane('left').catch((err) => {
    console.error('[main] initial pane setup failed (will self-heal on first load):', err)
  })
})

// Dev tool — quit on all platforms, including macOS.
app.on('window-all-closed', () => {
  app.quit()
})
