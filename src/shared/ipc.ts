// IPC channel catalog. Source of truth: potato-plan.md section C.
import type {
  ConsoleEntry,
  ExportData,
  NavState,
  NetRecord,
  PaneId,
  PersistedState,
  Rect,
  Settings,
  Totals
} from './types'

// ---- renderer → main (ipcRenderer.invoke) ----
export const CH_SETTINGS_UPDATE = 'settings:update'
export const CH_SETTINGS_LOAD_PERSISTED = 'settings:loadPersisted'
export const CH_NAV_LOAD = 'nav:load'
export const CH_NAV_KILL = 'nav:kill'
export const CH_NAV_BACK = 'nav:back'
export const CH_NAV_FORWARD = 'nav:forward'
export const CH_PANE_SET_BOUNDS = 'pane:setBounds'
export const CH_COMPARE_TOGGLE = 'compare:toggle'
export const CH_SHOT_CAPTURE = 'shot:capture'
export const CH_SHOT_COMPOSITE_RESULT = 'shot:composite-result'
export const CH_EXPORT_HTML = 'export:html'
export const CH_EXPORT_HAR = 'export:har'
export const CH_LOG_CLEAR = 'log:clear'

// ---- main → renderer (webContents.send / window.potato.on) ----
export const CH_NET_REQUEST = 'net:request'
export const CH_NET_UPDATE = 'net:update'
export const CH_TOTALS_UPDATE = 'totals:update'
export const CH_CONSOLE_ENTRY = 'console:entry'
export const CH_NAV_STATE = 'nav:state'
export const CH_PANE_REATTACHED = 'pane:reattached'
export const CH_SHOT_COMPOSITE_REQUEST = 'shot:composite-request'

// ---- payload shapes ----
export interface SettingsUpdatePayload {
  pane: PaneId
  settings: Settings
}
export interface NavLoadPayload {
  url: string
}
export interface PanePayload {
  pane: PaneId
}
export interface SetBoundsPayload {
  left: Rect
  right?: Rect
}
export interface CompareTogglePayload {
  on: boolean
  rightSettings?: Settings
}
export interface SavedPathResult {
  savedPath: string
}

/** main → renderer: please composite these pane captures side by side on a canvas, with labels */
export interface ShotCompositeRequest {
  id: string
  images: Array<{ dataUrl: string; label: string; width: number; height: number }>
}
/** renderer → main: the composited PNG */
export interface ShotCompositeResult {
  id: string
  dataUrl: string
}

export type NetUpdatePayload = Partial<NetRecord> & { id: string; pane: PaneId }

// Convenience union maps (used by the typed preload wrapper and the renderer store)
export interface MainToRendererPayloads {
  [CH_NET_REQUEST]: NetRecord
  [CH_NET_UPDATE]: NetUpdatePayload
  [CH_TOTALS_UPDATE]: Totals
  [CH_CONSOLE_ENTRY]: ConsoleEntry
  [CH_NAV_STATE]: NavState
  [CH_PANE_REATTACHED]: PanePayload
  [CH_SHOT_COMPOSITE_REQUEST]: ShotCompositeRequest
}

export interface RendererToMain {
  [CH_SETTINGS_UPDATE]: { payload: SettingsUpdatePayload; result: void }
  [CH_SETTINGS_LOAD_PERSISTED]: { payload: void; result: PersistedState }
  [CH_NAV_LOAD]: { payload: NavLoadPayload; result: void }
  [CH_NAV_KILL]: { payload: void; result: void }
  [CH_NAV_BACK]: { payload: PanePayload; result: void }
  [CH_NAV_FORWARD]: { payload: PanePayload; result: void }
  [CH_PANE_SET_BOUNDS]: { payload: SetBoundsPayload; result: void }
  [CH_COMPARE_TOGGLE]: { payload: CompareTogglePayload; result: void }
  [CH_SHOT_CAPTURE]: { payload: void; result: SavedPathResult }
  [CH_SHOT_COMPOSITE_RESULT]: { payload: ShotCompositeResult; result: void }
  [CH_EXPORT_HTML]: { payload: void; result: SavedPathResult }
  [CH_EXPORT_HAR]: { payload: void; result: SavedPathResult }
  [CH_LOG_CLEAR]: { payload: void; result: void }
}

export type { ExportData }
