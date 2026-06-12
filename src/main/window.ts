// BrowserWindow factory — the app shell that hosts the renderer UI.
import { BrowserWindow } from 'electron'
import { join } from 'path'

export function createWindow(): BrowserWindow {
  // POTATO_HIDDEN=1: automated-test mode — window never shows on screen.
  const hidden = process.env['POTATO_HIDDEN'] === '1'
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#101010',
    title: 'Potato',
    autoHideMenuBar: true,
    show: !hidden,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      ...(hidden ? { backgroundThrottling: false } : {})
    }
  })

  // electron-vite convention: dev server URL in dev, built file in prod.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
