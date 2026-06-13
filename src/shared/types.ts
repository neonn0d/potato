// Shared types — the contract between main, preload and renderer.
// Source of truth: potato-plan.md section C.

export type PaneId = 'left' | 'right'
export type PresetId = 'raw' | 'mashed' | 'boiled' | 'baked' | 'custom' | 'normal'
export type DeviceId = 'none' | 'cheapAndroid' | 'oldIphone'
export type Verdict = 'proof' | 'died'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  preset: PresetId
  downKbps: number
  upKbps: number
  latencyMs: number
  cpuRate: 1 | 2 | 4 | 6 | 8
  /** false → CDP Emulation.setScriptExecutionDisabled({ value: true }), applies on next load */
  jsEnabled: boolean
  /** false → Network.setCacheDisabled(true) + Network.setBypassServiceWorker(true) */
  cacheEnabled: boolean
  device: DeviceId
}

export type NetType = 'doc' | 'js' | 'css' | 'img' | 'font' | 'xhr' | 'media' | 'other'
export type NetState = 'pending' | 'finished' | 'failed'

export interface NetRecord {
  /** CDP requestId prefixed with pane, e.g. "left:1234.5" */
  id: string
  pane: PaneId
  url: string
  method: string
  type: NetType
  status?: number
  statusText?: string
  state: NetState
  /** encodedDataLength; accumulates redirect-hop bytes */
  bytes: number
  /** sum of redirect-hop bytes only (so a late loadingFinished can replace the final-hop estimate) */
  redirectBytes?: number
  /**
   * true when bytes were estimated from Content-Length at responseReceived —
   * Electron's debugger often never delivers Network.loadingFinished
   * (github.com/electron/electron/issues/37491), so we finalize there and
   * upgrade to exact bytes if loadingFinished does arrive.
   */
  approx?: boolean
  /** ms relative to tracker reset (monotonic-derived) */
  startMs: number
  endMs?: number
  durationMs?: number
  /** loadingFailed.errorText, e.g. net::ERR_TIMED_OUT */
  failReason?: string
  redirectChain?: number
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
  fromCache?: boolean
  mimeType?: string
  /** epoch seconds of request start (requestWillBeSent.wallTime) — for HAR */
  wallTime?: number
}

export interface Totals {
  pane: PaneId
  totalBytes: number
  byType: Record<NetType, number>
  requestCount: number
  failedCount: number
  domContentMs?: number
  loadMs?: number
  /** live ticking until load fires */
  elapsedMs: number
  verdict?: Verdict
}

export interface ConsoleEntry {
  id: string
  pane: PaneId
  level: 'log' | 'info' | 'warning' | 'error'
  text: string
  source: 'console' | 'exception' | 'log-domain'
  url?: string
  line?: number
  ts: number
}

export interface NavState {
  pane: PaneId
  url: string
  /** true from nav:load until load event */
  loading: boolean
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface PersistedState {
  lastUrl: string
  settings: Settings
}

/** Everything ExportService needs to build the HTML report / HAR. */
export interface ExportData {
  url: string
  createdAt: string
  panes: Array<{
    pane: PaneId
    settings: Settings
    totals: Totals
    records: NetRecord[]
    consoleEntries: ConsoleEntry[]
  }>
  /** PNG data URL of the current shot, embedded into the HTML report */
  screenshotDataUrl?: string
  appVersion: string
}
