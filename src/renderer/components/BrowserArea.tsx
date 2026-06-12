import { useEffect, useRef } from 'preact/hooks'
import { effect } from '@preact/signals'
import { PRESETS } from '../../shared/presets'
import type { Rect, Settings } from '../../shared/types'
import { compare, logCollapsed, logPanelHeight, sendPaneBounds, settings } from '../store'
import { PresetPicker } from './PresetPicker'

// The actual web page is a native WebContentsView overlay drawn BY MAIN on top of
// this window at the coordinates we report here. This component renders an empty
// dark placeholder and pushes its content-box rect(s) via pane:setBounds.

function measure(el: HTMLElement, split: boolean): { left: Rect; right?: Rect } {
  const r = el.getBoundingClientRect()
  const x = Math.round(r.left)
  const y = Math.round(r.top)
  const w = Math.max(0, Math.round(r.width))
  const h = Math.max(0, Math.round(r.height))
  if (!split) return { left: { x, y, width: w, height: h } }
  // two equal halves with a 1px gap
  const half = Math.max(0, Math.floor((w - 1) / 2))
  return {
    left: { x, y, width: half, height: h },
    right: { x: x + half + 1, y, width: Math.max(0, w - half - 1), height: h }
  }
}

function presetLabel(s: Settings): string {
  return s.preset === 'custom' ? 'Custom' : PRESETS[s.preset].label
}

export function BrowserArea() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const send = () => {
      cancelAnimationFrame(raf)
      // measure after layout settles
      raf = requestAnimationFrame(() => {
        sendPaneBounds(measure(el, compare.peek()))
      })
    }
    send() // mount
    const ro = new ResizeObserver(send) // log-panel drag/collapse, layout shifts
    ro.observe(el)
    window.addEventListener('resize', send) // window resize
    const dispose = effect(() => {
      // compare toggle re-splits without resizing the container; height signals
      // cover collapse/drag races where RO and layout disagree for a frame
      void compare.value
      void logPanelHeight.value
      void logCollapsed.value
      send()
    })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', send)
      dispose()
    }
  }, [])

  const cmp = compare.value
  return (
    <div class="browser-area">
      {cmp && (
        <div class="compare-headers">
          <div class="compare-header">
            <span class="ch-tag">LEFT</span>
            <span class="ch-preset">{presetLabel(settings.left.value)}</span>
            <span class="ch-hint">sidebar settings</span>
          </div>
          <div class="compare-header">
            <span class="ch-tag">RIGHT</span>
            <PresetPicker pane="right" compact />
          </div>
        </div>
      )}
      <div class="pane-region" ref={ref}>
        {/* everything in here is invisible once the page loads — placeholder only */}
        {cmp && <div class="pane-divider" />}
      </div>
    </div>
  )
}
