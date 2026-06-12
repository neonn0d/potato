import {
  clearLogs,
  compare,
  errorCount,
  logCollapsed,
  logPanelHeight,
  logTab,
  paneFilter,
  recordIds,
  typeFilter,
  type PaneFilter,
  type TypeFilter
} from '../store'
import { NetworkTable } from './NetworkTable'
import { ConsoleList } from './ConsoleList'
import { DetailFlyout } from './DetailFlyout'

const COLLAPSED_H = 30
const MIN_H = 80

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'js', label: 'JS' },
  { id: 'img', label: 'IMG' },
  { id: 'font', label: 'Font' },
  { id: 'css', label: 'CSS' },
  { id: 'xhr', label: 'XHR' },
  { id: 'failed', label: 'Failed' }
]

const PANE_FILTERS: Array<{ id: PaneFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' }
]

export function LogPanel() {
  const collapsed = logCollapsed.value
  const tab = logTab.value
  const cmp = compare.value
  const errs = errorCount.value

  return (
    <div class="log-panel" style={{ height: `${collapsed ? COLLAPSED_H : logPanelHeight.value}px` }}>
      {!collapsed && (
        <div
          class="log-drag"
          title="Drag to resize"
          onPointerDown={(e) => {
            const handle = e.currentTarget
            const startY = e.clientY
            const startH = logPanelHeight.peek()
            handle.setPointerCapture(e.pointerId)
            const onMove = (ev: PointerEvent) => {
              const max = Math.max(MIN_H, window.innerHeight - 160)
              logPanelHeight.value = Math.min(Math.max(startH + (startY - ev.clientY), MIN_H), max)
            }
            const end = (ev: PointerEvent) => {
              try {
                handle.releasePointerCapture(ev.pointerId)
              } catch {
                /* already released */
              }
              handle.removeEventListener('pointermove', onMove)
              handle.removeEventListener('pointerup', end)
              handle.removeEventListener('pointercancel', end)
            }
            handle.addEventListener('pointermove', onMove)
            handle.addEventListener('pointerup', end)
            handle.addEventListener('pointercancel', end)
          }}
        />
      )}
      <div class="log-header">
        <button
          class="collapse-btn"
          title={collapsed ? 'Expand log panel' : 'Collapse log panel'}
          onClick={() => {
            logCollapsed.value = !collapsed
          }}
        >
          {collapsed ? '▲' : '▼'}
        </button>
        <span class="log-title">LOGS</span>
        <button
          class={'log-tab' + (tab === 'network' ? ' active' : '')}
          onClick={() => {
            logTab.value = 'network'
          }}
        >
          Network ({recordIds.value.length})
        </button>
        <button
          class={'log-tab' + (tab === 'console' ? ' active' : '')}
          onClick={() => {
            logTab.value = 'console'
          }}
        >
          Console
          {errs > 0 && <span class="err-badge">{errs}</span>}
        </button>
        <div class="log-spacer" />
        {!collapsed && tab === 'network' && (
          <div class="chips">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.id}
                class={'chip' + (typeFilter.value === f.id ? ' active' : '')}
                onClick={() => {
                  typeFilter.value = f.id
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {!collapsed && cmp && (
          <div class="chips pane-chips">
            {PANE_FILTERS.map((f) => (
              <button
                key={f.id}
                class={'chip' + (paneFilter.value === f.id ? ' active' : '')}
                onClick={() => {
                  paneFilter.value = f.id
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <button class="clear-btn" title="Clear network + console logs" onClick={clearLogs}>
          Clear
        </button>
      </div>
      {!collapsed && (
        <div class="log-body">
          {tab === 'network' ? <NetworkTable /> : <ConsoleList />}
          <DetailFlyout />
        </div>
      )}
    </div>
  )
}
