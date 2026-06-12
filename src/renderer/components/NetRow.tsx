import type { NetRecord } from '../../shared/types'
import { compare, detailId, displayPath, fmtDuration, getRecord, humanBytes, middleTruncate } from '../store'

function rowClass(r: NetRecord): string {
  if (r.state === 'pending') return 'pending'
  if (r.state === 'failed') return 'failed'
  if (r.status != null && r.status >= 400) return 'err'
  if (r.status != null && r.status >= 300) return 'redir'
  return 'ok'
}

export function NetRow({ id }: { id: string }) {
  const sig = getRecord(id)
  if (!sig) return null
  const r = sig.value
  const statusTxt = r.state === 'pending' ? '◌' : r.state === 'failed' ? '✗' : String(r.status ?? '—')
  return (
    <div
      class={`net-row ${rowClass(r)}` + (detailId.value === id ? ' selected' : '')}
      title={r.url}
      onClick={() => {
        detailId.value = id
      }}
    >
      {compare.value && <span class="c-pane">{r.pane === 'left' ? 'L' : 'R'}</span>}
      <span class="c-status">{statusTxt}</span>
      <span class="c-method">{r.method}</span>
      <span class="c-path">{middleTruncate(displayPath(r.url), 60)}</span>
      <span class="c-type">{r.type}</span>
      {r.fromCache && <span class="c-cache">cache</span>}
      <span class="c-size">
        {r.state === 'failed'
          ? (r.failReason ?? 'failed')
          : r.state === 'pending'
            ? '…'
            : (r.approx ? '≈' : '') + humanBytes(r.bytes)}
      </span>
      <span class="c-time">{r.durationMs != null ? fmtDuration(r.durationMs) : ''}</span>
    </div>
  )
}
