// Typed ipcMain handlers (renderer → main) + the emit helper (main → renderer).
// Every channel in shared/ipc.ts gets a handler here.
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  CH_COMPARE_TOGGLE,
  CH_EXPORT_HAR,
  CH_EXPORT_HTML,
  CH_LOG_CLEAR,
  CH_NAV_BACK,
  CH_NAV_FORWARD,
  CH_NAV_KILL,
  CH_NAV_LOAD,
  CH_PANE_SET_BOUNDS,
  CH_SETTINGS_LOAD_PERSISTED,
  CH_SETTINGS_UPDATE,
  CH_SHOT_CAPTURE,
  CH_SHOT_COMPOSITE_RESULT
} from '../shared/ipc'
import type {
  CompareTogglePayload,
  NavLoadPayload,
  PanePayload,
  SavedPathResult,
  SetBoundsPayload,
  SettingsUpdatePayload,
  ShotCompositeResult
} from '../shared/ipc'
import { defaultSettings } from '../shared/presets'
import type { PersistedState } from '../shared/types'
import type { EmitFn, IExportService, IShotService } from './contracts'
import type { PaneManager } from './PaneManager'
import { settingsStore } from './settingsStore'

/** The EmitFn handed to PaneManager and the trackers. */
export function makeEmit(win: BrowserWindow): EmitFn {
  return (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerIpc(
  win: BrowserWindow,
  paneManager: PaneManager,
  shotService: IShotService,
  exportService: IExportService
): void {
  // The most recent shot, embedded into HTML exports.
  let lastScreenshotDataUrl: string | undefined

  ipcMain.handle(CH_SETTINGS_UPDATE, (_e, payload: SettingsUpdatePayload) => {
    paneManager.applySettings(payload.pane, payload.settings)
  })

  ipcMain.handle(CH_SETTINGS_LOAD_PERSISTED, (): PersistedState => {
    return settingsStore.load() ?? { lastUrl: '', settings: defaultSettings() }
  })

  ipcMain.handle(CH_NAV_LOAD, async (_e, payload: NavLoadPayload) => {
    await paneManager.load(payload.url)
  })

  ipcMain.handle(CH_NAV_KILL, () => {
    paneManager.killAll()
  })

  ipcMain.handle(CH_NAV_BACK, (_e, payload: PanePayload) => {
    paneManager.back(payload.pane)
  })

  ipcMain.handle(CH_NAV_FORWARD, (_e, payload: PanePayload) => {
    paneManager.forward(payload.pane)
  })

  ipcMain.handle(CH_PANE_SET_BOUNDS, (_e, payload: SetBoundsPayload) => {
    paneManager.setBounds(payload)
  })

  ipcMain.handle(CH_COMPARE_TOGGLE, async (_e, payload: CompareTogglePayload) => {
    await paneManager.setCompare(payload.on, payload.rightSettings)
  })

  ipcMain.handle(CH_SHOT_CAPTURE, async (): Promise<SavedPathResult> => {
    const captures = await paneManager.captureAll()
    let host = 'page'
    try {
      host = new URL(paneManager.currentUrl).hostname || 'page'
    } catch {
      // no/invalid URL yet — keep the fallback
    }
    const result = await shotService.capture(captures, host)
    lastScreenshotDataUrl = result.dataUrl
    return { savedPath: result.savedPath }
  })

  ipcMain.handle(CH_SHOT_COMPOSITE_RESULT, (_e, payload: ShotCompositeResult) => {
    shotService.resolveComposite(payload.id, payload.dataUrl)
  })

  ipcMain.handle(CH_EXPORT_HTML, async (): Promise<SavedPathResult> => {
    const data = paneManager.getExportData()
    data.screenshotDataUrl = lastScreenshotDataUrl
    return { savedPath: await exportService.exportHtml(data) }
  })

  ipcMain.handle(CH_EXPORT_HAR, async (): Promise<SavedPathResult> => {
    const data = paneManager.getExportData()
    data.screenshotDataUrl = lastScreenshotDataUrl
    return { savedPath: await exportService.exportHar(data) }
  })

  ipcMain.handle(CH_LOG_CLEAR, () => {
    paneManager.clearLogs()
  })
}
