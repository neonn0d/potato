// Page.* CDP events → navigation state + load timing, per pane.
// Spec: potato-plan.md A.3 + D (NavTracker). All CDP timestamps are MonotonicTime SECONDS.
//
// RELIABILITY NOTE: Electron's webContents.debugger drops some CDP events
// (github.com/electron/electron/issues/37491) — Page.lifecycleEvent
// 'navigationStart' often never arrives. So timing is armed from MULTIPLE
// signals (lifecycleEvent OR frameStartedNavigating/frameStartedLoading,
// whichever lands first) and falls back to wall-clock when the CDP
// MonotonicTime baseline is missing. A vibe-check timer beats no timer.
import type { PaneId } from '../shared/types'
import type { INavTracker, NavTrackerHooks } from './contracts'

// --- minimal CDP payload shapes (only the fields we read) ---
interface LifecycleEventParams {
  frameId?: string
  name?: string
  timestamp?: number // MonotonicTime, seconds
}
interface TimestampedParams {
  timestamp?: number // MonotonicTime, seconds
}
interface FrameNavigatedParams {
  frame?: { id?: string; parentId?: string; url?: string }
}
interface FrameStartedParams {
  frameId?: string
}

export class NavTracker implements INavTracker {
  /** navigationStart MonotonicTime, raw seconds — undefined when CDP never delivered it */
  private t0: number | undefined
  /** Date.now() when navigation started (always set on arm) — wall-clock fallback baseline */
  private wallT0: number | undefined
  private _domContentMs: number | undefined
  private _loadMs: number | undefined
  private mainFrameId: string | undefined
  private currentUrl = ''

  constructor(
    private readonly pane: PaneId,
    private readonly hooks: NavTrackerHooks
  ) {}

  get domContentMs(): number | undefined {
    return this._domContentMs
  }

  get loadMs(): number | undefined {
    return this._loadMs
  }

  handle(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'Page.lifecycleEvent':
        this.onLifecycleEvent(params as unknown as LifecycleEventParams)
        break
      // These two DO get delivered reliably and carry the main frame's id —
      // use them as the nav-start signal when lifecycleEvent never shows up.
      case 'Page.frameStartedNavigating':
      case 'Page.frameStartedLoading': {
        const p = params as unknown as FrameStartedParams
        if (this.mainFrameId === undefined) this.mainFrameId = p.frameId
        else if (p.frameId !== this.mainFrameId) return // sub-frame
        this.maybeArm(undefined)
        break
      }
      case 'Page.domContentEventFired': {
        if (this._domContentMs !== undefined) return // native fallback got there first
        const p = params as unknown as TimestampedParams
        this._domContentMs = this.sinceStart(p.timestamp)
        if (this._domContentMs !== undefined) this.hooks.onDomContent(this._domContentMs)
        break
      }
      case 'Page.loadEventFired': {
        if (this._loadMs !== undefined) return // native fallback got there first
        const p = params as unknown as TimestampedParams
        this._loadMs = this.sinceStart(p.timestamp)
        if (this._loadMs !== undefined) this.hooks.onLoad(this._loadMs)
        break
      }
      case 'Page.frameNavigated': {
        const p = params as unknown as FrameNavigatedParams
        if (!p.frame || p.frame.parentId) return // sub-frame
        if (p.frame.id) this.mainFrameId = p.frame.id
        this.currentUrl = p.frame.url ?? this.currentUrl
        this.hooks.onFrameNavigated(this.currentUrl)
        break
      }
    }
  }

  reset(url: string): void {
    this.t0 = undefined
    this.wallT0 = undefined
    this._domContentMs = undefined
    this._loadMs = undefined
    this.currentUrl = url
  }

  elapsedMs(): number {
    if (this._loadMs !== undefined) return this._loadMs
    if (this.wallT0 === undefined) return 0
    return Date.now() - this.wallT0
  }

  markDomContent(ms: number): void {
    if (this._domContentMs === undefined) this._domContentMs = ms
  }

  /** Freeze the timer from a native load signal when CDP loadEventFired was dropped. */
  markLoaded(ms: number): void {
    if (this._loadMs === undefined) this._loadMs = ms
  }

  /** ms between nav start and a CDP event — MonotonicTime diff when we have a CDP
   *  t0, otherwise wall-clock (event delivery latency is noise at potato speeds). */
  private sinceStart(timestamp: number | undefined): number | undefined {
    if (this.wallT0 === undefined) return undefined // no navigation armed
    if (this.t0 !== undefined && timestamp !== undefined) return (timestamp - this.t0) * 1000
    return Date.now() - this.wallT0
  }

  private onLifecycleEvent(p: LifecycleEventParams): void {
    if (p.name !== 'navigationStart' || p.timestamp === undefined) return
    // Main-frame filter: before any frameNavigated we don't know the main frame id —
    // accept the first lifecycle event's frame as main.
    if (this.mainFrameId === undefined) {
      this.mainFrameId = p.frameId
    } else if (p.frameId !== this.mainFrameId) {
      return
    }
    this.maybeArm(p.timestamp)
  }

  /**
   * Arm timing for a navigation if appropriate:
   * - no timing armed since reset → arm
   * - load already complete and a new nav-start arrives (user click-through,
   *   no explicit reset) → re-arm for the new navigation
   * - nav-start while already loading (redirect chain, duplicate signal) → keep
   *   the original baseline, but upgrade wall-t0 to a CDP t0 when one arrives.
   */
  private maybeArm(timestamp: number | undefined): void {
    if (this.wallT0 === undefined) {
      this.arm(timestamp)
    } else if (this._loadMs !== undefined) {
      this._domContentMs = undefined
      this._loadMs = undefined
      this.arm(timestamp)
    } else if (this.t0 === undefined && timestamp !== undefined) {
      // Already armed via frameStarted* (wall clock); a real navigationStart
      // timestamp arrived after all — adopt it as the precise baseline.
      this.t0 = timestamp
    }
  }

  private arm(timestamp: number | undefined): void {
    this.t0 = timestamp
    this.wallT0 = Date.now()
    this.hooks.onNavStart(this.currentUrl)
  }
}
