// Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded → ConsoleEntry stream, per pane.
// Spec: potato-plan.md A.3 + D (ConsoleTracker), dedup per G.12.
import { CH_CONSOLE_ENTRY } from '../shared/ipc'
import type { ConsoleEntry, PaneId } from '../shared/types'
import type { EmitFn, IConsoleTracker } from './contracts'

type Level = ConsoleEntry['level']

// --- minimal CDP payload shapes (only the fields we read) ---
interface RemoteObject {
  type?: string
  value?: unknown
  description?: string
}
interface CallFrame {
  url?: string
  lineNumber?: number
}
interface ConsoleAPICalledParams {
  type: string
  args?: RemoteObject[]
  timestamp?: number // Runtime.Timestamp, ms since epoch
  stackTrace?: { callFrames?: CallFrame[] }
}
interface ExceptionThrownParams {
  timestamp?: number
  exceptionDetails?: {
    text?: string
    url?: string
    lineNumber?: number
    exception?: RemoteObject
  }
}
interface LogEntryAddedParams {
  entry?: {
    source?: string
    level?: string
    text?: string
    timestamp?: number
    url?: string
    lineNumber?: number
  }
}

function consoleLevel(type: string): Level {
  switch (type) {
    case 'warning':
      return 'warning'
    case 'error':
    case 'assert':
      return 'error'
    case 'info':
      return 'info'
    default:
      return 'log'
  }
}

function logDomainLevel(level: string | undefined): Level {
  switch (level) {
    case 'verbose':
      return 'log'
    case 'info':
      return 'info'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'log'
  }
}

export class ConsoleTracker implements IConsoleTracker {
  private list: ConsoleEntry[] = []
  /** `${level}|${text}|${url}|${line}` of every accepted entry, for Runtime/Log dedup */
  private seen = new Set<string>()
  private counter = 0

  constructor(
    private readonly pane: PaneId,
    private readonly emit: EmitFn
  ) {}

  handle(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'Runtime.consoleAPICalled':
        this.onConsoleAPICalled(params as unknown as ConsoleAPICalledParams)
        break
      case 'Runtime.exceptionThrown':
        this.onExceptionThrown(params as unknown as ExceptionThrownParams)
        break
      case 'Log.entryAdded':
        this.onLogEntryAdded(params as unknown as LogEntryAddedParams)
        break
    }
  }

  reset(): void {
    this.list = []
    this.seen.clear()
  }

  entries(): ConsoleEntry[] {
    return [...this.list]
  }

  private dedupKey(level: Level, text: string, url?: string, line?: number): string {
    return `${level}|${text}|${url}|${line}`
  }

  private accept(
    level: Level,
    text: string,
    source: ConsoleEntry['source'],
    url: string | undefined,
    line: number | undefined,
    ts: number
  ): void {
    this.seen.add(this.dedupKey(level, text, url, line))
    const entry: ConsoleEntry = {
      id: `${this.pane}:c${++this.counter}`,
      pane: this.pane,
      level,
      text,
      source,
      url,
      line,
      ts
    }
    this.list.push(entry)
    this.emit(CH_CONSOLE_ENTRY, entry)
  }

  private onConsoleAPICalled(p: ConsoleAPICalledParams): void {
    const text = (p.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type ?? '')))
      .join(' ')
    const frame = p.stackTrace?.callFrames?.[0]
    this.accept(
      consoleLevel(p.type),
      text,
      'console',
      frame?.url,
      frame?.lineNumber,
      p.timestamp ?? Date.now()
    )
  }

  private onExceptionThrown(p: ExceptionThrownParams): void {
    const d = p.exceptionDetails
    const text = d?.exception?.description ?? d?.text ?? 'Uncaught exception'
    this.accept('error', text, 'exception', d?.url, d?.lineNumber, p.timestamp ?? Date.now())
  }

  private onLogEntryAdded(p: LogEntryAddedParams): void {
    const e = p.entry
    if (!e) return
    const level = logDomainLevel(e.level)
    const text = e.text ?? ''
    // Runtime usually fires first for JS errors — skip the Log-domain duplicate (plan G.12).
    if (e.source === 'javascript' && this.seen.has(this.dedupKey(level, text, e.url, e.lineNumber))) {
      return
    }
    this.accept(level, text, 'log-domain', e.url, e.lineNumber, e.timestamp ?? Date.now())
  }
}
