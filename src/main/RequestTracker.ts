// Network.* CDP events → per-request NetRecords + totals, per pane.
// Spec: potato-plan.md A.3 + D (RequestTracker).
import { CH_NET_REQUEST, CH_NET_UPDATE } from '../shared/ipc'
import type { NetRecord, NetType, PaneId, Totals, Verdict } from '../shared/types'
import type { EmitFn, IRequestTracker } from './contracts'

// --- minimal CDP payload shapes (only the fields we read) ---
interface CdpResponse {
  url?: string
  status?: number
  statusText?: string
  headers?: Record<string, string>
  mimeType?: string
  encodedDataLength?: number
  fromDiskCache?: boolean
}
interface RequestWillBeSentParams {
  requestId: string
  request: { url: string; method: string; headers?: Record<string, string> }
  type?: string
  timestamp: number // MonotonicTime, SECONDS
  wallTime?: number // epoch seconds
  redirectResponse?: CdpResponse
}
interface ResponseReceivedParams {
  requestId: string
  response: CdpResponse
  timestamp?: number
}
interface LoadingFinishedParams {
  requestId: string
  timestamp?: number
  encodedDataLength?: number
}
interface LoadingFailedParams {
  requestId: string
  timestamp?: number
  errorText?: string
}

const NET_TYPES: NetType[] = ['doc', 'js', 'css', 'img', 'font', 'xhr', 'media', 'other']

function mapResourceType(cdpType: string | undefined): NetType {
  switch (cdpType) {
    case 'Document':
      return 'doc'
    case 'Script':
      return 'js'
    case 'Stylesheet':
      return 'css'
    case 'Image':
      return 'img'
    case 'Font':
      return 'font'
    case 'XHR':
    case 'Fetch':
      return 'xhr'
    case 'Media':
      return 'media'
    default:
      return 'other'
  }
}

export class RequestTracker implements IRequestTracker {
  /** keyed by raw CDP requestId; insertion order preserved for entries() */
  private records = new Map<string, NetRecord>()
  /** MonotonicTime (seconds) of the first event after reset — base for startMs/endMs */
  private t0: number | undefined
  private domContentMs: number | undefined
  private loadMs: number | undefined
  private verdict: Verdict | undefined

  constructor(
    private readonly pane: PaneId,
    private readonly emit: EmitFn,
    private readonly onActivity?: () => void
  ) {}

  handle(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.onRequestWillBeSent(params as unknown as RequestWillBeSentParams)
        break
      case 'Network.responseReceived':
        this.onResponseReceived(params as unknown as ResponseReceivedParams)
        break
      case 'Network.loadingFinished':
        this.onLoadingFinished(params as unknown as LoadingFinishedParams)
        break
      case 'Network.loadingFailed':
        this.onLoadingFailed(params as unknown as LoadingFailedParams)
        break
    }
  }

  reset(): void {
    this.records.clear()
    this.t0 = undefined
    this.domContentMs = undefined
    this.loadMs = undefined
    this.verdict = undefined
  }

  setTiming(domContentMs: number | undefined, loadMs: number | undefined, verdict?: Verdict): void {
    this.domContentMs = domContentMs
    this.loadMs = loadMs
    this.verdict = verdict
  }

  killPending(): void {
    for (const rec of this.records.values()) {
      if (rec.state !== 'pending') continue
      rec.state = 'failed'
      rec.failReason = 'killed'
      this.emit(CH_NET_UPDATE, {
        id: rec.id,
        pane: this.pane,
        state: rec.state,
        failReason: rec.failReason
      })
    }
    this.onActivity?.()
  }

  snapshotTotals(elapsedMs: number): Totals {
    const byType = {} as Record<NetType, number>
    for (const t of NET_TYPES) byType[t] = 0
    let totalBytes = 0
    let failedCount = 0
    for (const rec of this.records.values()) {
      totalBytes += rec.bytes
      byType[rec.type] += rec.bytes
      if (rec.state === 'failed') failedCount++
    }
    return {
      pane: this.pane,
      totalBytes,
      byType,
      requestCount: this.records.size,
      failedCount,
      domContentMs: this.domContentMs,
      loadMs: this.loadMs,
      elapsedMs,
      verdict: this.verdict
    }
  }

  entries(): NetRecord[] {
    return [...this.records.values()]
  }

  /** MonotonicTime seconds → ms relative to t0 (t0 captured from the first event). */
  private relMs(timestamp: number): number {
    if (this.t0 === undefined) this.t0 = timestamp
    return (timestamp - this.t0) * 1000
  }

  private onRequestWillBeSent(p: RequestWillBeSentParams): void {
    const existing = this.records.get(p.requestId)

    if (p.redirectResponse && existing) {
      // Redirect hop: same requestId, no loadingFinished per hop — count its bytes here.
      existing.redirectBytes = (existing.redirectBytes ?? 0) + (p.redirectResponse.encodedDataLength ?? 0)
      existing.bytes = existing.redirectBytes
      existing.redirectChain = (existing.redirectChain ?? 0) + 1
      existing.url = p.request.url
      existing.method = p.request.method
      this.emit(CH_NET_UPDATE, {
        id: existing.id,
        pane: this.pane,
        url: existing.url,
        method: existing.method,
        bytes: existing.bytes,
        redirectChain: existing.redirectChain
      })
      this.onActivity?.()
      return
    }

    const record: NetRecord = {
      id: `${this.pane}:${p.requestId}`,
      pane: this.pane,
      url: p.request.url,
      method: p.request.method,
      type: mapResourceType(p.type),
      state: 'pending',
      bytes: 0,
      startMs: this.relMs(p.timestamp),
      reqHeaders: p.request.headers,
      wallTime: p.wallTime
    }
    this.records.set(p.requestId, record)
    this.emit(CH_NET_REQUEST, record)
    this.onActivity?.()
  }

  private onResponseReceived(p: ResponseReceivedParams): void {
    const rec = this.records.get(p.requestId)
    if (!rec) return // request started before reset — ignore
    rec.status = p.response.status
    rec.statusText = p.response.statusText
    rec.resHeaders = p.response.headers
    rec.mimeType = p.response.mimeType
    rec.fromCache = p.response.fromDiskCache

    // Electron's debugger frequently never delivers Network.loadingFinished
    // (electron#37491), which would leave every row pending forever. Finalize
    // here with an ESTIMATE (headers-so-far + Content-Length); a real
    // loadingFinished upgrades it to exact bytes if it ever arrives.
    if (rec.state === 'pending') {
      const headers = p.response.headers ?? {}
      const clRaw = headers['content-length'] ?? headers['Content-Length']
      const contentLength = clRaw !== undefined ? Number.parseInt(clRaw, 10) || 0 : 0
      const est = p.response.fromDiskCache
        ? 0 // cache hit = 0 wire bytes
        : (p.response.encodedDataLength ?? 0) + contentLength
      rec.bytes = (rec.redirectBytes ?? 0) + est
      rec.approx = true
      rec.state = 'finished'
      rec.endMs = p.timestamp !== undefined ? this.relMs(p.timestamp) : rec.startMs
      rec.durationMs = rec.endMs - rec.startMs
    }

    this.emit(CH_NET_UPDATE, {
      id: rec.id,
      pane: this.pane,
      status: rec.status,
      statusText: rec.statusText,
      resHeaders: rec.resHeaders,
      mimeType: rec.mimeType,
      fromCache: rec.fromCache,
      bytes: rec.bytes,
      approx: rec.approx,
      state: rec.state,
      endMs: rec.endMs,
      durationMs: rec.durationMs
    })
    this.onActivity?.()
  }

  private onLoadingFinished(p: LoadingFinishedParams): void {
    const rec = this.records.get(p.requestId)
    if (!rec) return
    // loadingFinished.encodedDataLength is the authoritative wire-byte count for the
    // final hop — it REPLACES any Content-Length estimate made at responseReceived.
    rec.bytes = (rec.redirectBytes ?? 0) + (p.encodedDataLength ?? 0)
    rec.approx = false
    rec.endMs = p.timestamp !== undefined ? this.relMs(p.timestamp) : rec.startMs
    rec.durationMs = rec.endMs - rec.startMs
    rec.state = 'finished'
    this.emit(CH_NET_UPDATE, {
      id: rec.id,
      pane: this.pane,
      bytes: rec.bytes,
      approx: rec.approx,
      endMs: rec.endMs,
      durationMs: rec.durationMs,
      state: rec.state
    })
    this.onActivity?.()
  }

  private onLoadingFailed(p: LoadingFailedParams): void {
    const rec = this.records.get(p.requestId)
    if (!rec) return
    rec.state = 'failed'
    rec.failReason = p.errorText
    rec.endMs = p.timestamp !== undefined ? this.relMs(p.timestamp) : rec.startMs
    rec.durationMs = rec.endMs - rec.startMs
    this.emit(CH_NET_UPDATE, {
      id: rec.id,
      pane: this.pane,
      state: rec.state,
      failReason: rec.failReason,
      endMs: rec.endMs,
      durationMs: rec.durationMs
    })
    this.onActivity?.()
  }
}
