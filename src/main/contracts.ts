// Main-process module contracts. PaneManager (owner: main-core) composes implementations
// of these interfaces (owner: trackers / services). Both sides code against THIS file.
import type { BrowserWindow } from 'electron'
import type {
  ConsoleEntry,
  ExportData,
  NetRecord,
  PaneId,
  Totals,
  Verdict
} from '../shared/types'

/** Emit a main→renderer stream message on the app window. */
export type EmitFn = (channel: string, payload: unknown) => void

export interface IRequestTracker {
  /** Feed any Network.* CDP event. Emits net:request / net:update itself via EmitFn. */
  handle(method: string, params: Record<string, unknown>): void
  /** Wipe all records + totals (reload auto-clear). */
  reset(): void
  /** Stamp timing/verdict into the totals snapshot (called by PaneManager on Page events). */
  setTiming(domContentMs: number | undefined, loadMs: number | undefined, verdict?: Verdict): void
  /** Hard kill: mark every still-pending request failed ('killed') and emit updates. */
  killPending(): void
  /** Current totals; elapsedMs is supplied by the caller (PaneManager owns the ticker). */
  snapshotTotals(elapsedMs: number): Totals
  /** All records, for export. */
  entries(): NetRecord[]
}

/**
 * Constructed as: new RequestTracker(pane, emit, onActivity?)
 * onActivity is called after any record state change so PaneManager can throttle totals:update.
 */
export type RequestTrackerCtor = new (
  pane: PaneId,
  emit: EmitFn,
  onActivity?: () => void
) => IRequestTracker

export interface IConsoleTracker {
  /** Feed Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded. Emits console:entry itself. */
  handle(method: string, params: Record<string, unknown>): void
  reset(): void
  entries(): ConsoleEntry[]
}

export type ConsoleTrackerCtor = new (pane: PaneId, emit: EmitFn) => IConsoleTracker

export interface NavTrackerHooks {
  /** Main-frame navigationStart lifecycle event (t0 set). */
  onNavStart(url: string): void
  onDomContent(ms: number): void
  onLoad(ms: number): void
  /** Main-frame frameNavigated — URL committed. */
  onFrameNavigated(url: string): void
}

export interface INavTracker {
  /** Feed Page.* CDP events (lifecycleEvent, frameNavigated, domContentEventFired, loadEventFired). */
  handle(method: string, params: Record<string, unknown>): void
  /** Called by PaneManager right before loadURL. */
  reset(url: string): void
  readonly domContentMs: number | undefined
  readonly loadMs: number | undefined
  /** ms since navigationStart (live), 0 if no nav yet */
  elapsedMs(): number
  /** Native-event fallbacks: CDP often drops domContentEventFired/loadEventFired
   *  (electron#37491), so PaneManager finalizes from webContents 'dom-ready' /
   *  'did-finish-load' when the CDP marker never arrived. */
  markDomContent(ms: number): void
  markLoaded(ms: number): void
}

export type NavTrackerCtor = new (pane: PaneId, hooks: NavTrackerHooks) => INavTracker

// ---- services (owner: services agent) ----

export interface PaneCapture {
  /** PNG as data URL */
  dataUrl: string
  width: number
  height: number
  /** e.g. "Mashed" or "Custom 250/50kbps" */
  presetLabel: string
}

export interface IShotService {
  /**
   * Save capture(s) to ~/Pictures/potato/<host>-<preset>-<timestamp>.png.
   * Single capture: decode + write directly. Two captures: composite + label via the
   * renderer canvas roundtrip (shot:composite-request / shot:composite-result).
   * Returns the saved file path. Also returns the final PNG data URL for embedding in exports.
   */
  capture(captures: PaneCapture[], urlHost: string): Promise<{ savedPath: string; dataUrl: string }>
  /** Renderer answered a composite request. */
  resolveComposite(id: string, dataUrl: string): void
}

export type ShotServiceCtor = new (win: BrowserWindow) => IShotService

export interface IExportService {
  /** Self-contained HTML report (inline styles, embedded screenshot). Returns saved path. */
  exportHtml(data: ExportData): Promise<string>
  /** HAR 1.2 file openable in DevTools. Returns saved path. */
  exportHar(data: ExportData): Promise<string>
}

export interface ISettingsStore {
  load(): import('../shared/types').PersistedState | undefined
  save(state: import('../shared/types').PersistedState): void
}
