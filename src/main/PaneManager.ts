// Owns the WebContentsView panes: debugger lifecycle, CDP event routing,
// re-attach after crashes, bounds, navigation, totals emission, capture/export data.
// Source of truth: potato-plan.md section D (PaneManager) + G.9.
import { app, WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { CH_NAV_STATE, CH_PANE_REATTACHED, CH_TOTALS_UPDATE } from '../shared/ipc'
import type { SetBoundsPayload } from '../shared/ipc'
import { defaultSettings, PRESETS, settingsFromPreset, thresholdFor } from '../shared/presets'
import type { ExportData, NavState, PaneId, Rect, Settings, Verdict } from '../shared/types'
import type {
  EmitFn,
  IConsoleTracker,
  INavTracker,
  IRequestTracker,
  NavTrackerHooks,
  PaneCapture
} from './contracts'
import { ConsoleTracker } from './ConsoleTracker'
import { NavTracker } from './NavTracker'
import { RequestTracker } from './RequestTracker'
import { settingsStore } from './settingsStore'
import { ThrottleManager } from './ThrottleManager'

const PANE_ORDER: readonly PaneId[] = ['left', 'right']
/** Keep emitting totals briefly after load — loadingFinished events can land after loadEventFired. */
const TICKER_LINGER_MS = 1500
const TICKER_INTERVAL_MS = 250
/** Minimum gap between activity-driven totals emits. */
const ACTIVITY_THROTTLE_MS = 100

interface PaneState {
  id: PaneId
  view: WebContentsView
  throttle: ThrottleManager
  requestTracker: IRequestTracker
  consoleTracker: IConsoleTracker
  navTracker: INavTracker
  settings: Settings
  url: string
  loading: boolean
  reattaching: boolean
  ticker: ReturnType<typeof setInterval> | null
  tickerStop: ReturnType<typeof setTimeout> | null
  trailing: ReturnType<typeof setTimeout> | null
  lastTotalsEmit: number
}

function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height)
  }
}

function presetLabel(s: Settings): string {
  return s.preset === 'custom' ? `Custom ${s.downKbps}/${s.upKbps}kbps` : PRESETS[s.preset].label
}

/**
 * CDP commands can hang forever (not reject) when the pane's renderer is gone or
 * wedged — and a hung apply must never block navigation. Resolves undefined on timeout.
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[PaneManager] ${what} timed out after ${ms}ms`)
      resolve(undefined)
    }, ms)
  })
  // Cancel the timer when p settles first — otherwise it logs a phantom "timed out".
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T | undefined>
}

const CDP_TIMEOUT_MS = 5000

export class PaneManager {
  private readonly panes = new Map<PaneId, PaneState>()
  private url = ''
  private compare = false
  /** Last renderer-reported bounds — re-applied when a pane is rebuilt after a crash. */
  private lastBounds: SetBoundsPayload | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly emit: EmitFn
  ) {}

  get compareOn(): boolean {
    return this.compare
  }

  get currentUrl(): string {
    return this.url
  }

  async ensurePane(id: PaneId): Promise<void> {
    if (this.panes.has(id)) return
    const settings = id === 'right' ? settingsFromPreset('baked') : defaultSettings()
    const pane = this.createPane(id, settings)
    this.panes.set(id, pane)
    this.wirePane(pane)
    const dlog = (m: string): void => console.log(`[pane:${id}] ${m}`)
    dlog('created; priming about:blank')
    // A WebContentsView that has never navigated has NO renderer process, and CDP
    // commands sent to it hang forever (they don't reject). Prime it with about:blank
    // so a renderer exists before we attach and apply settings.
    const wc0 = this.aliveWebContents(pane)
    if (wc0) {
      wc0.once('did-finish-load', () => dlog('prime: did-finish-load'))
      wc0.once('did-fail-load', (_e, code, desc) => dlog(`prime: did-fail-load ${code} ${desc}`))
      await withTimeout(wc0.loadURL('about:blank'), CDP_TIMEOUT_MS, 'about:blank prime')
    }
    dlog('prime done; attaching')
    const ok = await withTimeout(this.attachAndEnable(pane), CDP_TIMEOUT_MS, 'attach/enable')
    dlog(`attach/enable => ${String(ok)}`)
    const wc = this.aliveWebContents(pane)
    if (ok && wc) {
      await withTimeout(
        pane.throttle.apply(wc.debugger, pane.settings),
        CDP_TIMEOUT_MS,
        'initial throttle apply'
      )
      dlog('initial throttle apply done')
    }
    // A rebuilt pane must regain its on-screen position without waiting for the renderer.
    if (this.lastBounds) {
      const rect = id === 'right' ? this.lastBounds.right : this.lastBounds.left
      if (rect) pane.view.setBounds(roundRect(rect))
    }
  }

  /**
   * After a target crash ("target closed while handling command") view.webContents
   * can be destroyed or even undefined — never touch it without this check.
   */
  private aliveWebContents(pane: PaneState): Electron.WebContents | null {
    const wc = pane.view.webContents as Electron.WebContents | undefined
    return wc && !wc.isDestroyed() ? wc : null
  }

  destroyPane(id: PaneId): void {
    const pane = this.panes.get(id)
    if (!pane) return
    // Remove from the map first so the debugger 'detach' handler doesn't re-attach.
    this.panes.delete(id)
    this.stopTicker(pane)
    if (pane.trailing) {
      clearTimeout(pane.trailing)
      pane.trailing = null
    }
    this.win.contentView.removeChildView(pane.view)
    const wc = this.aliveWebContents(pane)
    if (wc) {
      if (wc.debugger.isAttached()) {
        try {
          wc.debugger.detach()
        } catch (err) {
          console.error(`[PaneManager] detach failed (${id}):`, err)
        }
      }
      wc.close()
    }
  }

  setBounds(payload: SetBoundsPayload): void {
    this.lastBounds = payload
    const left = this.panes.get('left')
    if (left) left.view.setBounds(roundRect(payload.left))
    const right = this.panes.get('right')
    if (right && payload.right) right.view.setBounds(roundRect(payload.right))
  }

  /** Apply settings + navigate every active pane. Reload auto-clears logs. */
  async load(url: string): Promise<void> {
    this.url = url
    for (const pane of this.panes.values()) {
      await this.loadPane(pane, url)
    }
    const left = this.panes.get('left')
    settingsStore.save({ lastUrl: url, settings: left ? left.settings : defaultSettings() })
  }

  /** Hard kill: abort all in-flight loads, mark pending rows failed, stop tickers. */
  killAll(): void {
    for (const pane of this.panes.values()) {
      const wc = this.aliveWebContents(pane)
      if (wc) wc.stop()
      pane.loading = false
      this.stopTicker(pane)
      pane.requestTracker.killPending()
      this.emit(CH_NAV_STATE, {
        pane: pane.id,
        url: pane.url,
        loading: false
      } satisfies NavState)
      this.emitTotals(pane)
    }
  }

  /**
   * Store settings for a pane. Idle panes get them applied IMMEDIATELY — a stuck
   * device/touch emulation until the next reload made the pane feel broken
   * (wheel scrolling eaten by touch mode). Mid-load changes still wait for the
   * next reload so they can't corrupt an in-flight measurement.
   */
  applySettings(id: PaneId, settings: Settings): void {
    const pane = this.panes.get(id)
    if (!pane) return
    pane.settings = settings
    if (id === 'left') settingsStore.save({ lastUrl: this.url, settings })
    if (!pane.loading) {
      const wc = this.aliveWebContents(pane)
      if (wc && wc.debugger.isAttached()) {
        void withTimeout(
          pane.throttle.apply(wc.debugger, settings),
          CDP_TIMEOUT_MS,
          'throttle apply on settings change'
        )
      }
    }
  }

  back(id: PaneId): void {
    const pane = this.panes.get(id)
    if (!pane) return
    const nh = pane.view.webContents.navigationHistory
    if (nh.canGoBack()) nh.goBack()
  }

  forward(id: PaneId): void {
    const pane = this.panes.get(id)
    if (!pane) return
    const nh = pane.view.webContents.navigationHistory
    if (nh.canGoForward()) nh.goForward()
  }

  async setCompare(on: boolean, rightSettings?: Settings): Promise<void> {
    this.compare = on
    if (!on) {
      this.destroyPane('right')
      return
    }
    const existed = this.panes.has('right')
    await this.ensurePane('right')
    const pane = this.panes.get('right')
    if (!pane) return
    if (rightSettings) pane.settings = rightSettings
    // A freshly created right pane joins the current session immediately.
    if (!existed && this.url) await this.loadPane(pane, this.url)
  }

  async captureAll(): Promise<PaneCapture[]> {
    const out: PaneCapture[] = []
    for (const id of PANE_ORDER) {
      const pane = this.panes.get(id)
      const wc = pane ? this.aliveWebContents(pane) : null
      if (!pane || !wc) continue
      const image = await wc.capturePage()
      const { width, height } = image.getSize()
      out.push({
        dataUrl: image.toDataURL(),
        width,
        height,
        presetLabel: presetLabel(pane.settings)
      })
    }
    return out
  }

  getExportData(): ExportData {
    const panes: ExportData['panes'] = []
    for (const id of PANE_ORDER) {
      const pane = this.panes.get(id)
      if (!pane) continue
      panes.push({
        pane: id,
        settings: pane.settings,
        totals: pane.requestTracker.snapshotTotals(pane.navTracker.elapsedMs()),
        records: pane.requestTracker.entries(),
        consoleEntries: pane.consoleTracker.entries()
      })
    }
    return {
      url: this.url,
      createdAt: new Date().toISOString(),
      panes,
      appVersion: app.getVersion()
    }
  }

  clearLogs(): void {
    for (const pane of this.panes.values()) {
      pane.requestTracker.reset()
      pane.consoleTracker.reset()
    }
  }

  // ---- pane construction & wiring ----

  private createPane(id: PaneId, settings: Settings): PaneState {
    // backgroundThrottling off: an occluded/hidden pane must still load at full
    // speed — this tool measures network behavior, not Chromium's timer throttling.
    const view = new WebContentsView({
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    this.win.contentView.addChildView(view)
    const hooks: NavTrackerHooks = {
      onNavStart: (url) => this.handleNavStart(id, url),
      onDomContent: (ms) => this.handleDomContent(id, ms),
      onLoad: (ms) => this.handleLoad(id, ms),
      onFrameNavigated: (url) => this.handleFrameNavigated(id, url)
    }
    return {
      id,
      view,
      // Capture the default UA now so ThrottleManager can restore it after a device override.
      throttle: new ThrottleManager(view.webContents.getUserAgent()),
      requestTracker: new RequestTracker(id, this.emit, () => this.onActivity(id)),
      consoleTracker: new ConsoleTracker(id, this.emit),
      navTracker: new NavTracker(id, hooks),
      settings,
      url: '',
      loading: false,
      reattaching: false,
      ticker: null,
      tickerStop: null,
      trailing: null,
      lastTotalsEmit: 0
    }
  }

  private wirePane(pane: PaneState): void {
    const wc = pane.view.webContents
    // Single 'message' listener routes every CDP event by method prefix.
    wc.debugger.on('message', (_event, method, params) => {
      if (method.startsWith('Network.')) {
        pane.requestTracker.handle(method, params)
      } else if (method.startsWith('Runtime.') || method.startsWith('Log.')) {
        pane.consoleTracker.handle(method, params)
      } else if (method.startsWith('Page.')) {
        pane.navTracker.handle(method, params)
      }
    })
    wc.debugger.on('detach', () => {
      void this.reattach(pane)
    })
    wc.on('render-process-gone', () => {
      void this.reattach(pane)
    })
    // Native fallbacks for the load/DCL markers: CDP frequently drops
    // Page.loadEventFired / domContentEventFired (electron#37491), which left the
    // elapsed timer counting forever on a fully-loaded page. These Electron
    // events are not subject to the debugger's event dropping.
    wc.on('dom-ready', () => {
      if (!pane.loading || pane.navTracker.domContentMs !== undefined) return
      const ms = pane.navTracker.elapsedMs()
      if (ms <= 0) return
      pane.navTracker.markDomContent(ms)
      this.handleDomContent(pane.id, ms)
    })
    wc.on('did-finish-load', () => {
      if (!pane.loading || pane.navTracker.loadMs !== undefined) return
      const ms = pane.navTracker.elapsedMs()
      if (ms <= 0) return
      pane.navTracker.markLoaded(ms)
      this.handleLoad(pane.id, ms)
    })
    wc.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
      // -3 = ABORTED (our kill / a redirect superseding the load) — not a finish.
      if (!isMainFrame || errorCode === -3 || !pane.loading) return
      pane.loading = false
      this.stopTicker(pane)
      this.emit(CH_NAV_STATE, {
        pane: pane.id,
        url: pane.url,
        loading: false
      } satisfies NavState)
      this.emitTotals(pane)
    })
  }

  private async attachAndEnable(pane: PaneState): Promise<boolean> {
    const wc = this.aliveWebContents(pane)
    if (!wc) return false
    const dbg = wc.debugger
    try {
      if (!dbg.isAttached()) dbg.attach('1.3')
      console.log(`[pane:${pane.id}] attached; enabling domains`)
      for (const [method, params] of [
        ['Network.enable', undefined],
        ['Runtime.enable', undefined],
        ['Log.enable', undefined],
        ['Page.enable', undefined],
        ['Page.setLifecycleEventsEnabled', { enabled: true }]
      ] as Array<[string, Record<string, unknown> | undefined]>) {
        await dbg.sendCommand(method, params)
        console.log(`[pane:${pane.id}] ${method} ok`)
      }
      return true
    } catch (err) {
      console.error(`[PaneManager] attach/enable failed (${pane.id}):`, err)
      return false
    }
  }

  /**
   * Crash/detach recovery (plan G.9): CDP overrides die with the renderer process,
   * so re-attach, re-enable domains and re-apply the last settings.
   */
  private async reattach(pane: PaneState): Promise<void> {
    if (pane.reattaching) return
    if (this.panes.get(pane.id) !== pane) return // deliberately destroyed
    const wc = this.aliveWebContents(pane)
    if (!wc) return // gone for good (app shutdown / window closed) — load() rebuilds on demand
    pane.reattaching = true
    try {
      const ok = await withTimeout(this.attachAndEnable(pane), CDP_TIMEOUT_MS, 'reattach')
      if (ok) {
        await withTimeout(
          pane.throttle.apply(wc.debugger, pane.settings),
          CDP_TIMEOUT_MS,
          'throttle apply on reattach'
        )
        this.emit(CH_PANE_REATTACHED, { pane: pane.id })
      }
    } catch (err) {
      console.error(`[PaneManager] reattach failed (${pane.id}):`, err)
    } finally {
      pane.reattaching = false
    }
  }

  private async loadPane(pane: PaneState, url: string, retry = true): Promise<void> {
    // Self-heal: if the pane's webContents died (startup attach failure, crash),
    // rebuild it instead of leaving the app permanently unable to navigate.
    let wc = this.aliveWebContents(pane)
    if (!wc) {
      if (!retry) return
      const keep = pane.settings
      this.destroyPane(pane.id)
      await this.ensurePane(pane.id)
      const fresh = this.panes.get(pane.id)
      if (!fresh) return
      fresh.settings = keep
      return this.loadPane(fresh, url, false)
    }
    pane.requestTracker.reset()
    pane.consoleTracker.reset()
    this.stopTicker(pane)
    if (!wc.debugger.isAttached()) {
      await withTimeout(this.attachAndEnable(pane), CDP_TIMEOUT_MS, 'attach on load')
    }
    if (wc.debugger.isAttached()) {
      await withTimeout(
        pane.throttle.apply(wc.debugger, pane.settings),
        CDP_TIMEOUT_MS,
        'throttle apply on load'
      )
    }
    pane.navTracker.reset(url)
    pane.url = url
    // Navigate even if CDP is broken — an unthrottled page beats a blank pane.
    wc.loadURL(url).catch(() => {
      // Load failures surface as Network.loadingFailed CDP events; nothing to do here.
    })
  }

  // ---- NavTracker hooks ----

  private handleNavStart(id: PaneId, url: string): void {
    const pane = this.panes.get(id)
    if (!pane) return
    pane.loading = true
    pane.url = url
    this.emit(CH_NAV_STATE, { pane: id, url, loading: true } satisfies NavState)
    this.startTicker(pane)
  }

  private handleDomContent(id: PaneId, ms: number): void {
    const pane = this.panes.get(id)
    if (!pane) return
    pane.requestTracker.setTiming(ms, undefined)
  }

  private handleLoad(id: PaneId, ms: number): void {
    const pane = this.panes.get(id)
    if (!pane || !pane.loading) return // already finalized (native + CDP both fired)
    pane.loading = false
    const verdict: Verdict = ms <= thresholdFor(pane.settings) ? 'proof' : 'died'
    pane.requestTracker.setTiming(pane.navTracker.domContentMs, ms, verdict)
    const wc = this.aliveWebContents(pane)
    this.emit(CH_NAV_STATE, {
      pane: id,
      url: pane.url,
      loading: false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false
    } satisfies NavState)
    this.emitTotals(pane)
    if (pane.tickerStop) clearTimeout(pane.tickerStop)
    pane.tickerStop = setTimeout(() => this.stopTicker(pane), TICKER_LINGER_MS)
  }

  private handleFrameNavigated(id: PaneId, url: string): void {
    const pane = this.panes.get(id)
    if (!pane) return
    pane.url = url
    const wc = this.aliveWebContents(pane)
    this.emit(CH_NAV_STATE, {
      pane: id,
      url,
      loading: pane.loading,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false
    } satisfies NavState)
  }

  // ---- totals emission (PaneManager owns the ticker) ----

  private startTicker(pane: PaneState): void {
    this.stopTicker(pane)
    pane.ticker = setInterval(() => this.emitTotals(pane), TICKER_INTERVAL_MS)
  }

  private stopTicker(pane: PaneState): void {
    if (pane.ticker) {
      clearInterval(pane.ticker)
      pane.ticker = null
    }
    if (pane.tickerStop) {
      clearTimeout(pane.tickerStop)
      pane.tickerStop = null
    }
  }

  /** Trailing-throttled totals emit so post-load requests keep totals fresh. */
  private onActivity(id: PaneId): void {
    const pane = this.panes.get(id)
    if (!pane || pane.trailing) return
    const since = Date.now() - pane.lastTotalsEmit
    if (since >= ACTIVITY_THROTTLE_MS) {
      this.emitTotals(pane)
      return
    }
    pane.trailing = setTimeout(() => {
      pane.trailing = null
      this.emitTotals(pane)
    }, ACTIVITY_THROTTLE_MS - since)
  }

  private emitTotals(pane: PaneState): void {
    pane.lastTotalsEmit = Date.now()
    this.emit(CH_TOTALS_UPDATE, pane.requestTracker.snapshotTotals(pane.navTracker.elapsedMs()))
  }
}
