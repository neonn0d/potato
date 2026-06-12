import { PRESETS } from '../../shared/presets'
import type { PaneId, Settings } from '../../shared/types'
import { compare, fmtSeconds, humanBytes, navState, settings, totals } from '../store'

function presetLabel(s: Settings): string {
  return s.preset === 'custom' ? 'Custom' : PRESETS[s.preset].label
}

function PaneTotals({ pane }: { pane: PaneId }) {
  const t = totals[pane].value
  const nav = navState[pane].value
  const cmp = compare.value
  const other = t.byType.doc + t.byType.xhr + t.byType.media + t.byType.other
  return (
    <div class="pane-totals">
      {cmp && (
        <div class="pt-head">
          {pane === 'left' ? 'LEFT' : 'RIGHT'} · {presetLabel(settings[pane].value)}
        </div>
      )}
      <div class="pt-total">{humanBytes(t.totalBytes)}</div>
      <div class="pt-row">
        <span>JS</span>
        <span>{humanBytes(t.byType.js)}</span>
      </div>
      <div class="pt-row">
        <span>IMG</span>
        <span>{humanBytes(t.byType.img)}</span>
      </div>
      <div class="pt-row">
        <span>Font</span>
        <span>{humanBytes(t.byType.font)}</span>
      </div>
      <div class="pt-row">
        <span>CSS</span>
        <span>{humanBytes(t.byType.css)}</span>
      </div>
      <div class="pt-row">
        <span>Other</span>
        <span>{humanBytes(other)}</span>
      </div>
      <div class="pt-timing">
        {nav.loading ? (
          <div class="pt-elapsed">⏱ {fmtSeconds(t.elapsedMs)}</div>
        ) : (
          <>
            {t.domContentMs != null && <div class="pt-dcl">DCL {fmtSeconds(t.domContentMs)}</div>}
            {t.loadMs != null && <div class="pt-load">Load {fmtSeconds(t.loadMs)}</div>}
          </>
        )}
      </div>
      {!nav.loading && t.verdict != null && (
        <div class={'pt-verdict ' + (t.verdict === 'proof' ? 'proof' : 'died')}>
          {t.verdict === 'proof' ? '🥔 potato-proof' : 'died on a potato'}
        </div>
      )}
    </div>
  )
}

export function Totals() {
  const cmp = compare.value
  return (
    <div class="totals">
      <div class="section-title">TOTAL</div>
      <div class={'totals-cols' + (cmp ? ' two' : '')}>
        <PaneTotals pane="left" />
        {cmp && <PaneTotals pane="right" />}
      </div>
    </div>
  )
}
