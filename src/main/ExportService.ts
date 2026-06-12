// ExportService — "Save log": one self-contained HTML report (inline styles,
// embedded screenshot, zero external resources) plus a HAR 1.2 export built per
// plan §A.4 (verified shape, openable in DevTools). Files land next to the
// screenshots in the app's shots/ folder (see outputDir.ts).
import fs from 'node:fs'
import path from 'node:path'
import type {
  ConsoleEntry,
  ExportData,
  NetRecord,
  Settings,
  Totals
} from '../shared/types'
import type { IExportService } from './contracts'
import { outputDir } from './outputDir'

// ---------- shared helpers ----------

/** YYYY-MM-DD-HHmm, local time */
function timestamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || 'session'
  } catch {
    return 'session'
  }
}

/** Escape page-derived strings before they touch the report HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

// ---------- HTML report ----------

const DEVICE_LABELS: Record<Settings['device'], string> = {
  none: 'none',
  cheapAndroid: 'cheap Android',
  oldIphone: 'old iPhone'
}

function settingsLine(s: Settings): string {
  return [
    `preset: ${s.preset}`,
    `down: ${s.downKbps} kbps`,
    `up: ${s.upKbps} kbps`,
    `latency: ${s.latencyMs} ms`,
    `CPU: ${s.cpuRate}×`,
    `JS: ${s.jsEnabled ? 'on' : 'off'}`,
    `cache: ${s.cacheEnabled ? 'on' : 'off'}`,
    `device: ${DEVICE_LABELS[s.device]}`
  ].join(' · ')
}

function verdictHtml(totals: Totals): string {
  if (totals.verdict === 'proof') return '<span class="verdict proof">🥔 potato-proof</span>'
  if (totals.verdict === 'died') return '<span class="verdict died">died on a potato</span>'
  return '<span class="verdict">no verdict</span>'
}

function totalsLine(t: Totals): string {
  return [
    `${t.requestCount} requests`,
    `${t.failedCount} failed`,
    `${fmtBytes(t.totalBytes)} transferred`,
    `DOMContentLoaded: ${fmtMs(t.domContentMs)}`,
    `load: ${fmtMs(t.loadMs)}`
  ].join(' · ')
}

function netRow(r: NetRecord): string {
  const status =
    r.state === 'failed'
      ? esc(r.failReason ?? 'FAILED')
      : r.status !== undefined
        ? String(r.status)
        : '…'
  const cls = r.state === 'failed' ? ' class="failed"' : ''
  const size = r.fromCache ? `${fmtBytes(r.bytes)} (cache)` : fmtBytes(r.bytes)
  return (
    `<tr${cls}><td>${status}</td><td>${esc(r.method)}</td>` +
    `<td class="url" title="${esc(r.url)}">${esc(r.url)}</td>` +
    `<td>${esc(r.type)}</td><td class="num">${size}</td><td class="num">${fmtMs(r.durationMs)}</td></tr>`
  )
}

function consoleRow(e: ConsoleEntry): string {
  const where = e.url ? ` <span class="dim">${esc(e.url)}${e.line !== undefined ? `:${e.line}` : ''}</span>` : ''
  return `<div class="console-entry ${esc(e.level)}"><span class="level">[${esc(e.level)}]</span> ${esc(e.text)}${where}</div>`
}

function paneSection(p: ExportData['panes'][number]): string {
  const consoleBlock =
    p.consoleEntries.length > 0
      ? p.consoleEntries.map(consoleRow).join('\n')
      : '<div class="dim">no console output</div>'
  return `<section class="pane">
  <h2>${esc(p.pane)} pane ${verdictHtml(p.totals)}</h2>
  <div class="settings">${esc(settingsLine(p.settings))}</div>
  <div class="totals">${esc(totalsLine(p.totals))}</div>
  <h3>Network (${p.records.length})</h3>
  <table>
    <thead><tr><th>status</th><th>method</th><th>url</th><th>type</th><th class="num">size</th><th class="num">time</th></tr></thead>
    <tbody>
${p.records.map(netRow).join('\n')}
    </tbody>
  </table>
  <h3>Console (${p.consoleEntries.length})</h3>
  <div class="console">
${consoleBlock}
  </div>
</section>`
}

const REPORT_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #101010; color: #d8d2c8;
    font: 13px/1.5 'JetBrains Mono', 'Fira Mono', ui-monospace, Menlo, Consolas, monospace;
  }
  a { color: #C8893A; }
  header { border-bottom: 1px solid #2a2a2a; padding-bottom: 14px; margin-bottom: 20px; }
  header h1 { margin: 0 0 6px; font-size: 20px; color: #C8893A; letter-spacing: 1px; }
  header .meta { color: #8a8478; font-size: 12px; }
  header .url { color: #d8d2c8; word-break: break-all; }
  section.pane { background: #161616; border: 1px solid #262626; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px; }
  h2 { margin: 0 0 8px; font-size: 15px; color: #e8e2d8; text-transform: capitalize; }
  h3 { margin: 18px 0 6px; font-size: 12px; color: #C8893A; text-transform: uppercase; letter-spacing: 1px; }
  .settings { color: #b0a896; font-size: 12px; }
  .totals { color: #d8d2c8; font-size: 12px; margin-top: 4px; }
  .verdict { font-size: 12px; padding: 2px 8px; border-radius: 10px; border: 1px solid #3a3a3a; margin-left: 8px; vertical-align: middle; }
  .verdict.proof { color: #7fbf6a; border-color: #3a5a30; }
  .verdict.died { color: #e06c5a; border-color: #5a2a22; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #8a8478; font-weight: normal; border-bottom: 1px solid #2a2a2a; padding: 4px 8px 4px 0; }
  td { border-bottom: 1px solid #1e1e1e; padding: 3px 8px 3px 0; vertical-align: top; }
  td.url { max-width: 640px; overflow-wrap: anywhere; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  tr.failed td { color: #e06c5a; }
  .console { background: #0c0c0c; border: 1px solid #222; border-radius: 6px; padding: 8px 10px; font-size: 12px; }
  .console-entry { padding: 1px 0; overflow-wrap: anywhere; }
  .console-entry .level { color: #8a8478; }
  .console-entry.error { color: #e06c5a; }
  .console-entry.warning { color: #d8a849; }
  .dim { color: #6a6458; }
  figure.shot { margin: 0 0 20px; }
  figure.shot img { max-width: 100%; border: 1px solid #2a2a2a; border-radius: 8px; display: block; }
  figure.shot figcaption { color: #8a8478; font-size: 11px; margin-top: 4px; }
  footer { color: #5a5448; font-size: 11px; margin-top: 8px; }
`

function buildHtmlReport(data: ExportData): string {
  // screenshotDataUrl is app-generated (a PNG data URL), but validate the prefix
  // anyway so nothing page-controlled can ever be injected as a src.
  const shot =
    data.screenshotDataUrl && data.screenshotDataUrl.startsWith('data:image/')
      ? `<figure class="shot"><img src="${esc(data.screenshotDataUrl)}" alt="screenshot"><figcaption>screenshot at export time</figcaption></figure>`
      : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Potato report — ${esc(hostOf(data.url))}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header>
  <h1>Potato 🥔</h1>
  <div class="meta url">${esc(data.url)}</div>
  <div class="meta">${esc(data.createdAt)} · Potato v${esc(data.appVersion)}</div>
</header>
${shot}
${data.panes.map(paneSection).join('\n')}
<footer>generated by Potato v${esc(data.appVersion)} — self-contained report, no external resources</footer>
</body>
</html>
`
}

// ---------- HAR 1.2 (plan §A.4) ----------

interface HarNameValue {
  name: string
  value: string
}

function harHeaders(h: Record<string, string> | undefined): HarNameValue[] {
  return Object.entries(h ?? {}).map(([name, value]) => ({ name, value }))
}

function harQueryString(url: string): HarNameValue[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

function harEntry(r: NetRecord, fallbackStarted: string): Record<string, unknown> {
  const startedDateTime =
    r.wallTime !== undefined ? new Date(r.wallTime * 1000).toISOString() : fallbackStarted
  const entry: Record<string, unknown> = {
    startedDateTime,
    time: r.durationMs ?? 0,
    request: {
      method: r.method,
      url: r.url,
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(r.reqHeaders),
      queryString: harQueryString(r.url),
      cookies: [],
      headersSize: -1,
      bodySize: -1
    },
    response: {
      status: r.status ?? 0,
      statusText: r.statusText ?? (r.failReason ? 'FAILED' : ''),
      httpVersion: 'HTTP/1.1',
      headers: harHeaders(r.resHeaders),
      content: {
        size: r.bytes,
        mimeType: r.mimeType ?? 'application/octet-stream'
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: r.bytes
    },
    cache: {},
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      send: 0,
      wait: r.durationMs ?? -1,
      receive: -1,
      ssl: -1
    }
  }
  if (r.failReason) entry.comment = r.failReason
  return entry
}

function buildHar(data: ExportData): string {
  const parsed = Date.parse(data.createdAt)
  const fallbackStarted = Number.isNaN(parsed)
    ? new Date().toISOString()
    : new Date(parsed).toISOString()
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Potato', version: data.appVersion },
      entries: data.panes.flatMap((p) => p.records.map((r) => harEntry(r, fallbackStarted)))
    }
  }
  return JSON.stringify(har, null, 2)
}

// ---------- service ----------

export class ExportService implements IExportService {
  async exportHtml(data: ExportData): Promise<string> {
    return this.write(data, 'html', buildHtmlReport(data))
  }

  async exportHar(data: ExportData): Promise<string> {
    return this.write(data, 'har', buildHar(data))
  }

  private write(data: ExportData, ext: 'html' | 'har', content: string): string {
    const dir = outputDir()
    fs.mkdirSync(dir, { recursive: true })
    const savedPath = path.join(dir, `${hostOf(data.url)}-${timestamp()}.${ext}`)
    fs.writeFileSync(savedPath, content, 'utf8')
    return savedPath
  }
}
