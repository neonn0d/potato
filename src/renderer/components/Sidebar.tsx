import { DEVICES } from '../../shared/presets'
import type { DeviceId, Settings } from '../../shared/types'
import { saveLog, setSettingsField, settings, takeShot } from '../store'
import { PresetPicker } from './PresetPicker'
import { Totals } from './Totals'

const CPU_RATES: Array<Settings['cpuRate']> = [1, 2, 4, 6, 8]

function NumField({
  label,
  suffix,
  value,
  onCommit
}: {
  label: string
  suffix: string
  value: number
  onCommit: (v: number) => void
}) {
  return (
    <label class="num-field">
      <span class="nf-label">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onInput={(e) => {
          const v = Number(e.currentTarget.value)
          if (e.currentTarget.value !== '' && Number.isFinite(v) && v >= 0) onCommit(v)
        }}
      />
      <span class="nf-suffix">{suffix}</span>
    </label>
  )
}

function Toggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button type="button" class={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span class="toggle-label">{label}</span>
      <span class="toggle-state">{on ? 'on' : 'off'}</span>
      <span class="toggle-pill">
        <span class="toggle-dot" />
      </span>
    </button>
  )
}

export function Sidebar() {
  const s = settings.left.value
  const patch = (p: Partial<Settings>, flipToCustom = false) =>
    setSettingsField('left', p, flipToCustom)
  return (
    <aside class="sidebar">
      <div class="wordmark">
        POTATO <span class="wordmark-emoji">🥔</span>
      </div>
      <div class="sidebar-scroll">
        <div class="section-title">PRESET</div>
        <PresetPicker pane="left" />

        <div class="section-title">CUSTOM</div>
        <NumField label="↓" suffix="kbps" value={s.downKbps} onCommit={(v) => patch({ downKbps: v }, true)} />
        <NumField label="↑" suffix="kbps" value={s.upKbps} onCommit={(v) => patch({ upKbps: v }, true)} />
        <NumField label="⏱" suffix="ms" value={s.latencyMs} onCommit={(v) => patch({ latencyMs: v }, true)} />
        <label class="row-field">
          <span>CPU</span>
          <select
            value={String(s.cpuRate)}
            onChange={(e) => {
              const rate = Number(e.currentTarget.value) as Settings['cpuRate']
              patch({ cpuRate: rate }, true)
            }}
          >
            {CPU_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r}x
              </option>
            ))}
          </select>
        </label>

        <div class="section-divider" />
        <Toggle label="JS" on={s.jsEnabled} onChange={(v) => patch({ jsEnabled: v })} />
        <Toggle label="Cache" on={s.cacheEnabled} onChange={(v) => patch({ cacheEnabled: v })} />
        <label class="row-field">
          <span>Device</span>
          <select
            value={s.device}
            onChange={(e) => patch({ device: e.currentTarget.value as DeviceId })}
          >
            <option value="none">None</option>
            <option value="cheapAndroid">{DEVICES.cheapAndroid.label}</option>
            <option value="oldIphone">{DEVICES.oldIphone.label}</option>
          </select>
        </label>
      </div>

      <div class="section-divider" />
      <Totals />

      <div class="sidebar-buttons">
        <button title="Capture the browser pane to ~/Pictures/potato" onClick={() => void takeShot()}>
          📷 Shot
        </button>
        <button title="Export HTML report + HAR" onClick={() => void saveLog()}>
          💾 Save log
        </button>
      </div>
    </aside>
  )
}
