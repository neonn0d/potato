// ShotService — saves pane captures to ~/Pictures/potato/.
// Single capture: decode the PNG data URL and write it directly.
// Two captures (compare mode): NativeImage can't draw text (plan §G.10), so we
// roundtrip through the renderer: send shot:composite-request, the renderer
// composites side-by-side with preset labels on an offscreen canvas and answers
// via shot:composite-result → resolveComposite().
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CH_SHOT_COMPOSITE_REQUEST, type ShotCompositeRequest } from '../shared/ipc'
import type { IShotService, PaneCapture } from './contracts'

const COMPOSITE_TIMEOUT_MS = 30_000

interface PendingComposite {
  resolve: (dataUrl: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

import { outputDir } from './outputDir'

/** "Custom 250/50kbps" → "custom-250-50kbps" */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** YYYY-MM-DD-HHmm, local time */
function timestamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) throw new Error('Malformed data URL')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export class ShotService implements IShotService {
  private readonly win: BrowserWindow
  private readonly pending = new Map<string, PendingComposite>()

  constructor(win: BrowserWindow) {
    this.win = win
  }

  async capture(
    captures: PaneCapture[],
    urlHost: string
  ): Promise<{ savedPath: string; dataUrl: string }> {
    const first = captures[0]
    if (!first) throw new Error('ShotService.capture: no captures supplied')

    const dataUrl = captures.length === 1 ? first.dataUrl : await this.composite(captures)

    const dir = outputDir()
    fs.mkdirSync(dir, { recursive: true })
    const presetSlug = captures.map((c) => slugify(c.presetLabel)).join('-vs-')
    const savedPath = path.join(dir, `${urlHost}-${presetSlug}-${timestamp()}.png`)
    fs.writeFileSync(savedPath, dataUrlToBuffer(dataUrl))
    return { savedPath, dataUrl }
  }

  resolveComposite(id: string, dataUrl: string): void {
    const entry = this.pending.get(id)
    if (!entry) return // stale / unknown id — ignore
    this.pending.delete(id)
    clearTimeout(entry.timer)
    // Renderer replies with '' when canvas compositing fails — don't write a broken PNG.
    if (!dataUrl) {
      entry.reject(new Error('compare screenshot compositing failed in renderer'))
      return
    }
    entry.resolve(dataUrl)
  }

  /** Ask the renderer to composite the captures side by side with labels. */
  private composite(captures: PaneCapture[]): Promise<string> {
    const id = randomUUID()
    const request: ShotCompositeRequest = {
      id,
      images: captures.map((c) => ({
        dataUrl: c.dataUrl,
        label: c.presetLabel,
        width: c.width,
        height: c.height
      }))
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Screenshot composite timed out (renderer did not answer in 30s)'))
      }, COMPOSITE_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.win.webContents.send(CH_SHOT_COMPOSITE_REQUEST, request)
    })
  }
}
