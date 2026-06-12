import { useEffect, useRef } from 'preact/hooks'
import { compare, consoleEntries, paneFilter } from '../store'

function loc(url?: string, line?: number): string {
  if (!url) return ''
  let short = url
  try {
    const u = new URL(url)
    short = u.host + u.pathname
  } catch {
    /* keep raw */
  }
  return line != null ? `${short}:${line}` : short
}

export function ConsoleList() {
  const entries = consoleEntries.value
  const pf = paneFilter.value
  const cmp = compare.value
  const visible = cmp && pf !== 'all' ? entries.filter((e) => e.pane === pf) : entries

  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  return (
    <div
      class="console-list"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
    >
      {visible.length === 0 && <div class="log-empty">console is quiet</div>}
      {visible.map((e) => (
        <div key={e.id} class={`console-row ${e.level}`}>
          {cmp && <span class="c-pane">{e.pane === 'left' ? 'L' : 'R'}</span>}
          <span class="src-tag">{e.source}</span>
          <span class="console-text">{e.text}</span>
          {e.url && <span class="console-loc">{loc(e.url, e.line)}</span>}
        </div>
      ))}
    </div>
  )
}
