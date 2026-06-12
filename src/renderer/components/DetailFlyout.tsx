import { useEffect } from 'preact/hooks'
import { detailId, fmtDuration, getRecord, humanBytes } from '../store'

function HeadersTable({ title, headers }: { title: string; headers?: Record<string, string> }) {
  const entries = headers ? Object.entries(headers) : []
  return (
    <div class="fly-section">
      <div class="fly-section-title">{title}</div>
      {entries.length === 0 ? (
        <div class="fly-empty">—</div>
      ) : (
        <table class="fly-headers">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function DetailFlyout() {
  const id = detailId.value

  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') detailId.value = null
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      // clicking another row just switches the target; everything else closes
      if (t && (t.closest('.detail-flyout') || t.closest('.net-row'))) return
      detailId.value = null
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [id])

  const sig = id ? getRecord(id) : undefined
  if (!id || !sig) return null
  const r = sig.value

  return (
    <div class="detail-flyout">
      <div class="fly-head">
        <span class="fly-title">request detail</span>
        <button
          class="fly-close"
          title="Close (Esc)"
          onClick={() => {
            detailId.value = null
          }}
        >
          ✕
        </button>
      </div>
      <div class="fly-url">{r.url}</div>
      <div class="fly-meta">
        <div>
          <span>state</span>
          <span>
            {r.state}
            {r.failReason ? ` · ${r.failReason}` : ''}
          </span>
        </div>
        <div>
          <span>status</span>
          <span>{r.status != null ? `${r.status} ${r.statusText ?? ''}`.trim() : '—'}</span>
        </div>
        <div>
          <span>type</span>
          <span>
            {r.type}
            {r.mimeType ? ` · ${r.mimeType}` : ''}
          </span>
        </div>
        <div>
          <span>size</span>
          <span>{humanBytes(r.bytes)}</span>
        </div>
        <div>
          <span>start</span>
          <span>{fmtDuration(r.startMs) || '0ms'}</span>
        </div>
        <div>
          <span>duration</span>
          <span>{r.durationMs != null ? fmtDuration(r.durationMs) : '—'}</span>
        </div>
        <div>
          <span>redirect hops</span>
          <span>{r.redirectChain ?? 0}</span>
        </div>
        <div>
          <span>from cache</span>
          <span>{r.fromCache ? 'yes' : 'no'}</span>
        </div>
      </div>
      <HeadersTable title="request headers" headers={r.reqHeaders} />
      <HeadersTable title="response headers" headers={r.resHeaders} />
    </div>
  )
}
