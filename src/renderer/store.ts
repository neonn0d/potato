// Renderer store — @preact/signals. Single source of UI state; subscribes ONCE
// to all main→renderer IPC streams. Components read signals directly.
import { computed, signal, type Signal } from '@preact/signals'
import {
  CH_CONSOLE_ENTRY,
  CH_EXPORT_HAR,
  CH_EXPORT_HTML,
  CH_LOG_CLEAR,
  CH_NAV_BACK,
  CH_NAV_FORWARD,
  CH_NAV_KILL,
  CH_NAV_LOAD,
  CH_NAV_STATE,
  CH_NET_REQUEST,
  CH_NET_UPDATE,
  CH_PANE_REATTACHED,
  CH_PANE_SET_BOUNDS,
  CH_SETTINGS_LOAD_PERSISTED,
  CH_SETTINGS_UPDATE,
  CH_SHOT_CAPTURE,
  CH_SHOT_COMPOSITE_REQUEST,
  CH_SHOT_COMPOSITE_RESULT,
  CH_TOTALS_UPDATE,
  type SetBoundsPayload,
  type ShotCompositeRequest
} from '../shared/ipc'
import type {
  ConsoleEntry,
  NavState,
  NetRecord,
  NetType,
  PaneId,
  PresetId,
  Settings,
  Totals
} from '../shared/types'
import { defaultSettings, settingsFromPreset } from '../shared/presets'

// ---------------------------------------------------------------- settings

export const settings: Record<PaneId, Signal<Settings>> = {
  left: signal(defaultSettings()),
  right: signal(settingsFromPreset('baked'))
}

export const url = signal('')
export const compare = signal(false)

// ----------------------------------------------------------- network log

/** id → record signal; append-only between clears. Order lives in recordIds. */
const recordMap = new Map<string, Signal<NetRecord>>()
export const recordIds = signal<string[]>([])

export function getRecord(id: string): Signal<NetRecord> | undefined {
  return recordMap.get(id)
}

export const consoleEntries = signal<ConsoleEntry[]>([])
export const errorCount = computed(() =>
  consoleEntries.value.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0)
)

// ----------------------------------------------------------------- totals

function emptyByType(): Record<NetType, number> {
  return { doc: 0, js: 0, css: 0, img: 0, font: 0, xhr: 0, media: 0, other: 0 }
}

export function emptyTotals(pane: PaneId): Totals {
  return { pane, totalBytes: 0, byType: emptyByType(), requestCount: 0, failedCount: 0, elapsedMs: 0 }
}

export const totals: Record<PaneId, Signal<Totals>> = {
  left: signal(emptyTotals('left')),
  right: signal(emptyTotals('right'))
}

export const navState: Record<PaneId, Signal<NavState>> = {
  left: signal<NavState>({ pane: 'left', url: '', loading: false }),
  right: signal<NavState>({ pane: 'right', url: '', loading: false })
}

// ----------------------------------------------------------- log panel UI

export type LogTab = 'network' | 'console'
export type TypeFilter = 'all' | 'js' | 'img' | 'font' | 'css' | 'xhr' | 'failed'
export type PaneFilter = 'all' | PaneId

export const logTab = signal<LogTab>('network')
export const typeFilter = signal<TypeFilter>('all')
export const paneFilter = signal<PaneFilter>('all')
export const logPanelHeight = signal(220)
export const logCollapsed = signal(false)
/** record id shown in the detail flyout, null = closed */
export const detailId = signal<string | null>(null)

// ------------------------------------------------------------------ toasts

export interface Toast {
  id: number
  text: string
}

export const toasts = signal<Toast[]>([])
let toastSeq = 0

export function showToast(text: string): void {
  const id = ++toastSeq
  toasts.value = [...toasts.value, { id, text }]
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 5000)
}

// ----------------------------------------------------------------- actions

export function selectPreset(pane: PaneId, id: PresetId): void {
  const sig = settings[pane]
  const cur = sig.peek()
  const next: Settings =
    id === 'custom' ? { ...cur, preset: 'custom' } : settingsFromPreset(id, cur)
  sig.value = next
  void window.potato.invoke(CH_SETTINGS_UPDATE, { pane, settings: next })
}

/** Patch settings fields. flipToCustom = editing a number/CPU field deviates from the named preset. */
export function setSettingsField(pane: PaneId, patch: Partial<Settings>, flipToCustom = false): void {
  const sig = settings[pane]
  const next: Settings = { ...sig.peek(), ...patch }
  if (flipToCustom) next.preset = 'custom'
  sig.value = next
  void window.potato.invoke(CH_SETTINGS_UPDATE, { pane, settings: next })
}

export function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
}

export function loadUrl(raw: string): void {
  const u = normalizeUrl(raw)
  if (!u) return
  url.value = u
  // Explicit user reload is the ONLY place logs auto-clear (mirrors main's
  // tracker reset in load()). Clearing on nav:state loading edges wiped the
  // table whenever a site fired post-load navigation signals.
  clearLogsLocal()
  void window.potato.invoke(CH_NAV_LOAD, { url: u })
}

export function reload(): void {
  loadUrl(url.peek())
}

/** Hard kill: abort all in-flight loads. Pending rows get marked failed ('killed'). */
export function killAll(): void {
  void window.potato.invoke(CH_NAV_KILL)
}

export function goBack(): void {
  void window.potato.invoke(CH_NAV_BACK, { pane: 'left' })
}

export function goForward(): void {
  void window.potato.invoke(CH_NAV_FORWARD, { pane: 'left' })
}

export function sendPaneBounds(payload: SetBoundsPayload): void {
  void window.potato.invoke(CH_PANE_SET_BOUNDS, payload)
}

function clearLogsLocal(): void {
  recordMap.clear()
  recordIds.value = []
  consoleEntries.value = []
  totals.left.value = emptyTotals('left')
  totals.right.value = emptyTotals('right')
  detailId.value = null
}

export function clearLogs(): void {
  clearLogsLocal()
  void window.potato.invoke(CH_LOG_CLEAR)
}

export async function takeShot(): Promise<void> {
  try {
    const r = await window.potato.invoke(CH_SHOT_CAPTURE)
    showToast(`📷 saved ${r.savedPath}`)
  } catch {
    showToast('📷 shot failed')
  }
}

export async function saveLog(): Promise<void> {
  try {
    const html = await window.potato.invoke(CH_EXPORT_HTML)
    showToast(`💾 HTML ${html.savedPath}`)
  } catch {
    showToast('💾 HTML export failed')
  }
  try {
    const har = await window.potato.invoke(CH_EXPORT_HAR)
    showToast(`💾 HAR ${har.savedPath}`)
  } catch {
    showToast('💾 HAR export failed')
  }
}

// ------------------------------------------- compare-mode shot compositing

const LABEL_STRIP_H = 28

/** Composite pane captures side by side on an offscreen canvas, no scaling,
 *  a 28px dark label strip (amber mono text) above each pane. */
async function handleCompositeRequest(req: ShotCompositeRequest): Promise<void> {
  let dataUrl = ''
  try {
    const imgs = await Promise.all(
      req.images.map(async (im) => {
        const img = new Image()
        img.src = im.dataUrl
        await img.decode()
        return { img, label: im.label }
      })
    )
    const maxH = imgs.reduce((m, i) => Math.max(m, i.img.naturalHeight), 0)
    const totalW = imgs.reduce((w, i) => w + i.img.naturalWidth, 0)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(totalW, 1)
    canvas.height = Math.max(maxH + LABEL_STRIP_H, 1)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = '#101010'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    let x = 0
    for (const { img, label } of imgs) {
      ctx.fillStyle = '#161616'
      ctx.fillRect(x, 0, img.naturalWidth, LABEL_STRIP_H)
      ctx.fillStyle = '#C8893A'
      ctx.font = '13px "JetBrains Mono", ui-monospace, monospace'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + 10, LABEL_STRIP_H / 2 + 1)
      ctx.drawImage(img, x, LABEL_STRIP_H)
      x += img.naturalWidth
    }
    dataUrl = canvas.toDataURL('image/png')
  } catch {
    // fall through with empty dataUrl so main isn't left waiting forever
  }
  void window.potato.invoke(CH_SHOT_COMPOSITE_RESULT, { id: req.id, dataUrl })
}

// ------------------------------------------------------------------- init

let initialized = false

export function initStore(): void {
  if (initialized) return
  initialized = true
  const potato = window.potato

  potato.on(CH_NET_REQUEST, (rec) => {
    const existing = recordMap.get(rec.id)
    if (existing) {
      existing.value = { ...existing.value, ...rec }
    } else {
      recordMap.set(rec.id, signal(rec))
      recordIds.value = [...recordIds.value, rec.id]
    }
  })

  potato.on(CH_NET_UPDATE, (u) => {
    const sig = recordMap.get(u.id)
    if (sig) sig.value = { ...sig.value, ...u }
  })

  potato.on(CH_TOTALS_UPDATE, (t) => {
    totals[t.pane].value = t
  })

  potato.on(CH_CONSOLE_ENTRY, (e) => {
    consoleEntries.value = [...consoleEntries.value, e]
  })

  potato.on(CH_NAV_STATE, (n) => {
    navState[n.pane].value = n
    // No auto-clear here: sites fire extra navigation signals right after load
    // (client redirects, SPA routing), and clearing on those wiped the table the
    // moment a load finished. Logs clear only in loadUrl() / the Clear button.
  })

  potato.on(CH_PANE_REATTACHED, () => {
    showToast('pane reattached')
  })

  potato.on(CH_SHOT_COMPOSITE_REQUEST, (req) => {
    void handleCompositeRequest(req)
  })

  void potato
    .invoke(CH_SETTINGS_LOAD_PERSISTED)
    .then((persisted) => {
      if (!persisted) return
      if (persisted.lastUrl) url.value = persisted.lastUrl
      if (persisted.settings) settings.left.value = persisted.settings
      // main already holds the persisted settings — no CH_SETTINGS_UPDATE here.
    })
    .catch(() => {
      /* no persisted state yet — keep defaults */
    })
}

// ------------------------------------------------------------- formatting

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** seconds with tenths: 14.2s */
export function fmtSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

/** request durations: 840ms under a second, 6.8s above */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

/** path (+query) for the log row; host for root documents; raw string on parse failure */
export function displayPath(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const p = u.pathname + u.search
    return p === '/' || p === '' ? u.host : p
  } catch {
    return rawUrl
  }
}
