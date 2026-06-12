// Minimal isolation test: is WebContentsView + debugger.sendCommand broken in a
// hidden window, or is it the app's code? No app code imported.
// Run: ./node_modules/.bin/electron scripts/min-repro.mjs [--show]
import { app, BrowserWindow, WebContentsView } from 'electron'

const SHOW = process.argv.includes('--show')
const t0 = Date.now()
const log = (m) => console.log(`[+${String(Date.now() - t0).padStart(5)}ms] ${m}`)

function timed(name, promise, ms = 5000) {
  return Promise.race([
    promise.then(
      (v) => (log(`${name}: RESOLVED`), v),
      (e) => log(`${name}: REJECTED ${e?.message ?? e}`)
    ),
    new Promise((r) => setTimeout(() => (log(`${name}: TIMEOUT ${ms}ms`), r(undefined)), ms))
  ])
}

app.whenReady().then(async () => {
  log(`ready (show=${SHOW})`)
  const win = new BrowserWindow({ width: 1000, height: 700, show: SHOW })
  if (process.argv.includes('--no-await-win')) {
    log('NOT awaiting window load (app-like timing)')
    void win.loadURL('about:blank')
  } else {
    await timed('win.loadURL(about:blank)', win.loadURL('about:blank'))
  }

  const view = new WebContentsView({ webPreferences: { sandbox: true } })
  win.contentView.addChildView(view)
  if (!process.argv.includes('--no-bounds')) {
    view.setBounds({ x: 0, y: 0, width: 800, height: 500 })
  } else {
    log('bounds NOT set (app-like zero-size pane)')
  }

  await timed('view.loadURL(about:blank)', view.webContents.loadURL('about:blank'))

  const dbg = view.webContents.debugger
  let events = 0
  const byMethod = {}
  dbg.on('message', (_e, method, params) => {
    events++
    byMethod[method] = (byMethod[method] ?? 0) + 1
    if (method === 'Network.loadingFinished') {
      log(`loadingFinished: encodedDataLength=${params.encodedDataLength}`)
    }
    if (method === 'Network.dataReceived') {
      log(`dataReceived: encoded=${params.encodedDataLength} data=${params.dataLength}`)
    }
  })
  try {
    dbg.attach('1.3')
    log('attach: OK')
  } catch (e) {
    log(`attach: THREW ${e.message}`)
  }
  await timed('Network.enable', dbg.sendCommand('Network.enable'))
  await timed('Page.enable', dbg.sendCommand('Page.enable'))
  await timed(
    'emulateNetworkConditions',
    dbg.sendCommand('Network.emulateNetworkConditions', {
      offline: false,
      latency: 800,
      downloadThroughput: 31250,
      uploadThroughput: 6250
    })
  )

  await timed('view.loadURL(example.com)', view.webContents.loadURL('https://example.com'), 20000)
  await new Promise((r) => setTimeout(r, 8000))
  log(`CDP events received: ${events}`)
  log(`by method: ${JSON.stringify(byMethod)}`)
  app.quit()
})
