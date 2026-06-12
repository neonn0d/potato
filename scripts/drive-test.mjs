// End-to-end driver: connects to the hidden app via CDP, simulates the user's
// exact action (load a URL), and reports where the pipeline breaks.
// Usage: node scripts/drive-test.mjs [port] [url]
const PORT = process.argv[2] ?? '9333'
const TEST_URL = process.argv[3] ?? 'https://example.com'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', () => reject(new Error('ws connect failed')))
  })
  return { send, ready, close: () => ws.close() }
}

async function evalInPage(wsUrl, expression, awaitPromise = true) {
  const c = cdp(wsUrl)
  await c.ready
  try {
    const r = await c.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    })
    return r
  } finally {
    c.close()
  }
}

const list1 = await targets()
console.log('== targets at start ==')
for (const t of list1) console.log(`  ${t.type} | ${t.title.slice(0, 40)} | ${t.url.slice(0, 80)}`)

const appPage = list1.find((t) => t.type === 'page' && t.url.includes('renderer/index.html'))
if (!appPage) {
  console.log('FAIL: renderer page target not found')
  process.exit(1)
}

// 1. preload bridge present?
const bridge = await evalInPage(appPage.webSocketDebuggerUrl, 'typeof window.potato', false)
console.log('window.potato =>', JSON.stringify(bridge.result))

// 2. simulate the user: invoke nav:load exactly like Enter does
const nav = await evalInPage(
  appPage.webSocketDebuggerUrl,
  `window.potato.invoke('nav:load', { url: '${TEST_URL}' }).then(() => 'nav:load resolved').catch(e => 'nav:load REJECTED: ' + (e && e.message))`
)
console.log('nav:load =>', JSON.stringify(nav.result))

// 3. wait, then inspect: did the pane target navigate? did net rows appear?
await sleep(12000)

const list2 = await targets()
console.log('== targets after load ==')
for (const t of list2) console.log(`  ${t.type} | ${t.title.slice(0, 40)} | ${t.url.slice(0, 80)}`)

const rows = await evalInPage(
  appPage.webSocketDebuggerUrl,
  `document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 600)`,
  false
)
console.log('renderer UI text =>', JSON.stringify(rows.result))
