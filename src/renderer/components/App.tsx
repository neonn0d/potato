import { toasts } from '../store'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BrowserArea } from './BrowserArea'
import { LogPanel } from './LogPanel'

function Toasts() {
  const list = toasts.value
  if (list.length === 0) return null
  return (
    <div class="toasts">
      {list.map((t) => (
        <div key={t.id} class="toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function App() {
  return (
    <div class="app">
      <Sidebar />
      <div class="main-col">
        <TopBar />
        <BrowserArea />
        <LogPanel />
      </div>
      <Toasts />
    </div>
  )
}
