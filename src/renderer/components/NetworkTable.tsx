import { useEffect, useRef } from 'preact/hooks'
import { compare, getRecord, paneFilter, recordIds, typeFilter } from '../store'
import { NetRow } from './NetRow'

export function NetworkTable() {
  const ids = recordIds.value
  const f = typeFilter.value
  const pf = paneFilter.value
  const cmp = compare.value

  const visible = ids.filter((id) => {
    const sig = getRecord(id)
    if (!sig) return false
    const r = sig.value
    if (cmp && pf !== 'all' && r.pane !== pf) return false
    if (f === 'all') return true
    if (f === 'failed') return r.state === 'failed'
    return r.type === f
  })

  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  return (
    <div
      class="net-table"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
    >
      {visible.length === 0 && <div class="log-empty">no requests yet — load a URL</div>}
      {visible.map((id) => (
        <NetRow key={id} id={id} />
      ))}
    </div>
  )
}
