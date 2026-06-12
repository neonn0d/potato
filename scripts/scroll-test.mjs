// Verifies the pane actually scrolls from wheel input (the thing the user said
// is broken). Drives the app via CDP: load a long page, dispatch real
// mouseWheel events into the PANE target, read back window.scrollY.
// Usage: node scripts/scroll-test.mjs [port]
const PORT = process.argv[2] ?? '9333'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('ws connect failed')))
  })
  return { send, ready, close: () => ws.close() }
}

// 1. tell the app to load a long page
const list1 = await targets()
const appPage = list1.find((t) => t.type === 'page' && t.url.includes('renderer/index.html'))
const app = cdp(appPage.webSocketDebuggerUrl)
await app.ready
await app.send('Runtime.evaluate', {
  expression: `window.potato.invoke('nav:load', { url: 'https://en.wikipedia.org/wiki/Potato' })`,
  awaitPromise: true
})
console.log('load requested, waiting...')
await sleep(15000)

// 2. find the pane target and wheel-scroll it
const list2 = await targets()
const pane = list2.find((t) => t.type === 'page' && t.url.includes('wikipedia'))
if (!pane) {
  console.log('FAIL: pane target not found; targets:', list2.map((t) => t.url.slice(0, 60)))
  process.exit(1)
}
const p = cdp(pane.webSocketDebuggerUrl)
await p.ready
const before = await p.send('Runtime.evaluate', { expression: 'window.scrollY', returnByValue: true })
for (let i = 0; i < 5; i++) {
  await p.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 400,
    y: 300,
    deltaX: 0,
    deltaY: 400
  })
  await sleep(150)
}
await sleep(500)
const after = await p.send('Runtime.evaluate', { expression: 'window.scrollY', returnByValue: true })
console.log(`scrollY before=${before.result.value} after=${after.result.value}`)
console.log(after.result.value > before.result.value ? 'SCROLL WORKS' : 'SCROLL BROKEN')
p.close()
app.close()
