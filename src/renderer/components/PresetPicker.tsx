import { PRESETS, PRESET_ORDER } from '../../shared/presets'
import type { PaneId, PresetId } from '../../shared/types'
import { selectPreset, settings } from '../store'

/** Radio preset picker. Full mode (sidebar) includes Custom; compact mode is the
 *  horizontal mini picker used in the compare right-pane header (named presets only —
 *  there are no custom fields to edit up there). */
export function PresetPicker({ pane, compact = false }: { pane: PaneId; compact?: boolean }) {
  const s = settings[pane].value
  const ids: PresetId[] = compact ? [...PRESET_ORDER] : [...PRESET_ORDER, 'custom']
  return (
    <div class={compact ? 'preset-picker compact' : 'preset-picker'} role="radiogroup">
      {ids.map((id) => {
        const named = id !== 'custom'
        const label = named ? PRESETS[id].label : 'Custom'
        const title = named ? PRESETS[id].blurb : 'Whatever you want'
        return (
          <label key={id} class={'preset-opt' + (s.preset === id ? ' active' : '')} title={title}>
            <input
              type="radio"
              name={`preset-${pane}${compact ? '-mini' : ''}`}
              checked={s.preset === id}
              onChange={() => selectPreset(pane, id)}
            />
            <span class="preset-dot" />
            <span class="preset-label">{label}</span>
          </label>
        )
      })}
    </div>
  )
}
