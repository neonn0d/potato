# Potato — Implementation Plan (v1)

A single-window Electron desktop tool that loads a target site in a real Chromium pane under emulated garbage network/device conditions, with a live request log, totals, console capture, compare mode, screenshots, and HTML/HAR export. This plan is the source of execution truth for a coding agent working milestone-by-milestone. Every named API/CDP call was verified against current official docs (June 2026); see Section A.

---

## A. Verified API reference

**Pinned versions:** Electron **42.3.3** (latest stable, June 2026), electron-vite **5.x**, electron-builder **latest**, Preact via **@preact/preset-vite**. CDP protocol version string for `attach`: **`'1.3'`**.

### A.1 Electron APIs

| API | Signature / key params | Verified at | Gotcha |
|---|---|---|---|
| `new WebContentsView([options])` | `options.webPreferences?`, `options.webContents?`; exposes read-only `view.webContents` | electronjs.org/docs/latest/api/web-contents-view | It is a **native overlay**, NOT in renderer HTML flow. Position is driven from main via `setBounds`. |
| `win.contentView.addChildView(view)` / `removeChildView(view)` | adds/removes the view as child of the window's root view | electronjs.org/docs/latest/api/web-contents-view | Add once; reuse the view across navigations. |
| `view.setBounds({x,y,width,height})` | Rectangle in DIP relative to window content | electronjs.org/docs/latest/api/web-contents-view | Must be re-set on window resize, log-panel drag, compare toggle. Drives the `pane:setBounds` IPC. |
| `view.webContents.loadURL(url)` | navigates the pane | web-contents docs | Triggers a fresh navigation; this is "reload" with current settings. |
| `webContents.debugger.attach('1.3')` | attaches CDP transport | electronjs.org/docs/latest/api/debugger | Throws if already attached or DevTools open. Guard with `isAttached()`. |
| `webContents.debugger.sendCommand(method, commandParams?, sessionId?)` | returns `Promise<any>` | electronjs.org/docs/latest/api/debugger | Always `await`/catch; rejects on failure (e.g. command sent after detach). |
| `webContents.debugger.detach()` | detaches | debugger docs | — |
| `webContents.debugger.isAttached()` | returns `boolean` | debugger docs | Use before attach and before any sendCommand after a crash. |
| `webContents.debugger` `'message'` event | `(event, method, params, sessionId)` | debugger docs | `method` is the CDP event name string, `params` its payload. This is how all Network/Runtime/Log/Page events arrive. |
| `webContents.debugger` `'detach'` event | `(event, reason)` | debugger docs | Fires when the session ends (e.g. DevTools opened). Treat as "must re-attach before next use." |
| `webContents` `'render-process-gone'` event | `(event, details)` where `details.reason` | web-contents docs | Renderer crashed/killed — debugger is gone. Re-attach + re-apply all settings. |
| `webContents` `'destroyed'` event | no params | web-contents docs | webContents tore down; do not send commands. |
| `webContents.capturePage([rect, opts])` | returns `Promise<NativeImage>` | web-contents docs | Capture each pane's `view.webContents`. `NativeImage.toPNG()` / `toDataURL()` for output. |
| `NativeImage.toPNG()` / `toDataURL()` | Buffer / data URL | native-image docs | NativeImage **cannot draw text or composite** — compare-mode labeling must happen on a renderer canvas (see G). |

**Decided: JS toggle mechanism.** There is **no** `webContents.setJavaScriptEnabled` runtime method (verified absent). The PRD's `setJavaScriptEnabled(false)` is incorrect. Use CDP **`Emulation.setScriptExecutionDisabled({ value })`** — this is exactly what DevTools' "Disable JavaScript" checkbox uses, applies on the next navigation (matching PRD's "applies on reload" model), and does **not** require recreating the WebContentsView (which would destroy the debugger session, unlike `webPreferences.javascript` which is fixed at construction). Re-apply on re-attach like all other settings. (Recorded in G.)

### A.2 CDP methods

| Method | Params (exact) | Verified at | Gotcha |
|---|---|---|---|
| `Network.enable` | `{}` (optional buffer-size params not needed) | chromedevtools.github.io/devtools-protocol/tot/Network | Call once per attach before expecting events. |
| `Network.emulateNetworkConditions` | `{ offline:boolean, latency:number(ms), downloadThroughput:number(bytes/sec, -1 disables), uploadThroughput:number(bytes/sec, -1 disables), connectionType? }` | Network domain | **Throughput is BYTES/sec.** Deprecated in favor of `emulateNetworkConditionsByRule`+`overrideNetworkState`, but still fully supported and what every tool uses — keep it for v1. **kbps→bytes/sec: `kbps × 1000 / 8 = kbps × 125`.** |
| `Network.setCacheDisabled` | `{ cacheDisabled:boolean }` | Network domain | When cache off, also bypass SW (below). |
| `Network.setBypassServiceWorker` | `{ bypass:boolean }` | Network domain | Set `true` whenever cache disabled, so reload == true first visit. |
| `Emulation.setCPUThrottlingRate` | `{ rate:number }` (1 = none, 2 = 2× slowdown) | Emulation domain | Slowdown factor, not a percentage. |
| `Emulation.setDeviceMetricsOverride` | `{ width:int, height:int, deviceScaleFactor:number, mobile:boolean }` (all required) | Emulation domain | `0` on width/height/DSF disables that override. For "None" device, **clear** via `Emulation.clearDeviceMetricsOverride`. |
| `Emulation.clearDeviceMetricsOverride` | `{}` | Emulation domain | Used to return to desktop viewport. |
| `Emulation.setUserAgentOverride` | `{ userAgent:string }` | Emulation domain | Preferred over `Network.setUserAgentOverride`; pair with device metrics + touch for full mobile emulation. |
| `Emulation.setTouchEmulationEnabled` | `{ enabled:boolean, maxTouchPoints?:int }` | Emulation domain | Enable for mobile presets (maxTouchPoints 1). |
| `Emulation.setScriptExecutionDisabled` | `{ value:boolean }` | Emulation domain | The JS toggle. Applies on next navigation. |
| `Runtime.enable` | (no params) | chromedevtools.github.io/devtools-protocol/tot/Runtime | Required to receive `consoleAPICalled` / `exceptionThrown`. |
| `Log.enable` | (no params) | tot/Log | Flushes entries collected so far via `entryAdded`. |
| `Page.enable` | `{}` | tot/Page | Required for load/dom/frameNavigated events. |
| `Page.setLifecycleEventsEnabled` | `{ enabled:boolean }` | tot/Page | Enables `Page.lifecycleEvent`; use its `'navigationStart'` as t0 for load timing. |

### A.3 CDP events (exact payload fields)

| Event | Payload fields used | Verified at | Gotcha |
|---|---|---|---|
| `Network.requestWillBeSent` | `requestId`, `request{url,method,headers}`, `type`, `timestamp`(MonotonicTime), `wallTime`(epoch secs), `redirectResponse?`(Response) | Network domain | A redirect hop emits a **new** `requestWillBeSent` carrying `redirectResponse` (the prior hop's response) under the **same** `requestId`; there is **no** `loadingFinished` per hop. |
| `Network.responseReceived` | `response{url,status,statusText,headers,mimeType,encodedDataLength,timing,protocol,fromDiskCache,fromServiceWorker}`, `type` | Network domain; Response type verified | `Response.encodedDataLength` exists — used to count redirect-hop bytes. |
| `Network.loadingFinished` | `requestId`, `timestamp`, `encodedDataLength` | Network domain | **This** `encodedDataLength` is the authoritative wire-byte count for the final hop. Can arrive **after** `Page.loadEventFired`. |
| `Network.loadingFailed` | `requestId`, `type`, `errorText`, `canceled` | Network domain | `errorText` (e.g. `net::ERR_...`) is the failure/timeout reason shown in red. |
| `Runtime.consoleAPICalled` | `type`(log/info/warning/error/...), `args[]`(RemoteObject), `executionContextId`, `timestamp`, `stackTrace?` | Runtime domain | `args` are RemoteObjects — stringify `.value`/`.description` for display. |
| `Runtime.exceptionThrown` | `timestamp`, `exceptionDetails{text,lineNumber,columnNumber,url,exception}` | Runtime domain | Uncaught errors; render as red console rows + bump error badge. |
| `Log.entryAdded` | `entry{source,level,text,timestamp,url,lineNumber,stackTrace?,networkRequestId?}` | Log domain | Browser-level messages (network/security/deprecation). Dedup against console where overlapping. |
| `Page.loadEventFired` | `timestamp`(MonotonicTime) | Page domain | Load-time end marker. |
| `Page.domContentEventFired` | `timestamp` | Page domain | DOMContentLoaded marker (shown smaller). |
| `Page.frameNavigated` | `frame{id,url,...}` | Page domain | Use main-frame nav to reset per-load state and capture new URL. |
| `Page.lifecycleEvent` | `{frameId,loaderId,name,timestamp}` | Page domain | `name:'navigationStart'` for the main frame = **t0** for load timing. All CDP timestamps are MonotonicTime, so compute `loadEventFired.timestamp − t0`. |

### A.4 HAR 1.2 (for export)

Verified at w3c.github.io HAR Overview (and the canonical softwareishard 1.2 spec). Minimal valid shape:

```
log: { version:"1.2", creator:{name:"Potato",version:<appVersion>}, entries:[ ... ] }
entry: {
  startedDateTime: ISO8601 w/ tz (from requestWillBeSent.wallTime),
  time: <ms total>,
  request:  { method,url,httpVersion,headers[],queryString[],cookies[],headersSize,bodySize },
  response: { status,statusText,httpVersion,headers[],content:{size,mimeType},redirectURL,headersSize,bodySize },
  cache: {},
  timings: { blocked,dns,connect,send,wait,receive,ssl }   // -1 where unknown
}
```

Gotcha: HAR requires every `entry` to have request+response+timings; for failed requests, synthesize a response with `status:0` and put the error in a comment. Set unknown numeric fields to `-1` (spec-valid). `headersSize`/`bodySize` → `-1` when not measured.

### A.5 Preset → bytes/sec conversion table (load-bearing)

Formula: `bytes_per_sec = kbps × 125`. Latency in ms passes through unchanged.

| Preset | Down kbps | Down B/s | Up kbps | Up B/s | Latency ms | CPU rate | Verdict threshold |
|---|---|---|---|---|---|---|---|
| 🥔 Raw | 50 | 6250 | 20 | 2500 | 1000 | 6 | 30s |
| Mashed | 250 | 31250 | 50 | 6250 | 800 | 4 | 15s |
| Boiled | 750 | 93750 | 250 | 31250 | 300 | 2 | 8s |
| Baked | 4000 | 500000 | 1000 | 125000 | 100 | 1 | 4s |

---

## B. Project structure

electron-vite layout, TypeScript, Preact renderer. Default entry discovery: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`.

```
potato/
├── package.json                      # deps, scripts (dev/build/dist), electron-builder block or ref
├── electron.vite.config.ts           # main/preload/renderer vite config; externalizeDepsPlugin + @preact/preset-vite
├── electron-builder.yml              # deb+AppImage / nsis / dmg targets, appId, icon
├── tsconfig.json / tsconfig.node.json # TS config (node for main/preload, dom for renderer)
├── potato-prd.md                     # source of truth (exists)
├── resources/
│   └── icon.png / icon.ico / icon.icns  # the potato app icon (M4)
└── src/
    ├── shared/
    │   ├── ipc.ts                    # channel name constants + all payload TS interfaces (Section C)
    │   ├── presets.ts               # PRESETS table (incl. bytes/sec + thresholds), DEVICE profiles
    │   └── types.ts                 # Settings, NetRecord, Totals, ConsoleEntry, NavState, PaneId
    ├── main/
    │   ├── index.ts                  # app lifecycle, create BrowserWindow, wire PaneManager + IPC
    │   ├── window.ts                 # BrowserWindow factory (loads renderer, dark bg)
    │   ├── ipc.ts                    # typed ipcMain handlers + emit helpers (main→renderer)
    │   ├── PaneManager.ts            # owns WebContentsView(s), debugger lifecycle, re-attach, bounds
    │   ├── ThrottleManager.ts        # builds & applies all CDP settings for a pane
    │   ├── RequestTracker.ts         # Network.* → per-request records + totals (per pane)
    │   ├── ConsoleTracker.ts         # Runtime/Log/exceptionThrown → console entries (per pane)
    │   ├── NavTracker.ts             # Page lifecycle → nav state + load timing (per pane)
    │   ├── ShotService.ts            # capturePage per pane → PNG/dataURL to ~/Pictures/potato
    │   ├── ExportService.ts          # HTML report + HAR generation
    │   └── settingsStore.ts          # tiny JSON in userData (last URL, last preset)
    ├── preload/
    │   └── index.ts                  # contextBridge.exposeInMainWorld('potato', typed API)
    └── renderer/
        ├── index.html                # mount point + reserved layout regions
        ├── main.tsx                  # Preact render(), app store init
        ├── styles.css                # dark theme, mono numbers, amber accent (#C8893A)
        ├── store.ts                  # signal/reducer state; subscribes to window.potato events
        └── components/
            ├── App.tsx               # 3-region layout shell; drives pane:setBounds
            ├── Sidebar.tsx           # presets, custom fields, CPU, JS/cache toggles, device, totals, buttons
            ├── PresetPicker.tsx      # radio group (reused by compare right-pane header)
            ├── TopBar.tsx            # URL bar, reload (pulse-while-loading), compare toggle
            ├── BrowserArea.tsx       # spacer region(s) that report bounds for the native pane(s)
            ├── Totals.tsx            # totals/breakdown/load timer/verdict (1 or 2 columns)
            ├── LogPanel.tsx          # resizable/collapsible; Network|Console tabs, filter chips, clear
            ├── NetworkTable.tsx      # append-only rows, color-coded, Left/Right chip in compare
            ├── NetRow.tsx            # single row; click → detail flyout
            ├── DetailFlyout.tsx      # full URL, headers, timing breakdown
            └── ConsoleList.tsx       # console/error entries, error badge
```

---

## C. Typed IPC protocol

All names live in `src/shared/ipc.ts`; payload interfaces in `src/shared/types.ts`. Every channel is namespaced. `PaneId = 'left' | 'right'` ('right' only exists in compare mode). The preload exposes `window.potato` with `invoke<T>` (renderer→main, request/response) and `on(channel, cb)` (main→renderer stream) wrappers — strongly typed.

```ts
export type PaneId = 'left' | 'right';
export type PresetId = 'raw' | 'mashed' | 'boiled' | 'baked' | 'custom';
export type DeviceId = 'none' | 'cheapAndroid' | 'oldIphone';

export interface Settings {
  preset: PresetId;
  downKbps: number; upKbps: number; latencyMs: number;   // custom/effective values
  cpuRate: 1 | 2 | 4 | 6 | 8;
  jsEnabled: boolean;        // false → Emulation.setScriptExecutionDisabled({value:true})
  cacheEnabled: boolean;     // false → setCacheDisabled(true) + setBypassServiceWorker(true)
  device: DeviceId;
}

export type NetType = 'doc'|'js'|'css'|'img'|'font'|'xhr'|'media'|'other';
export type NetState = 'pending' | 'finished' | 'failed';

export interface NetRecord {
  id: string;                // CDP requestId (+pane prefix)
  pane: PaneId;
  url: string; method: string;
  type: NetType;
  status?: number; statusText?: string;
  state: NetState;
  bytes: number;             // encodedDataLength, accumulates redirect hops
  startMs: number; endMs?: number;  // monotonic, ms
  durationMs?: number;
  failReason?: string;       // loadingFailed.errorText
  redirectChain?: number;    // hop count
  reqHeaders?: Record<string,string>;
  resHeaders?: Record<string,string>;
  fromCache?: boolean;       // response.fromDiskCache
}

export interface Totals {
  pane: PaneId;
  totalBytes: number;
  byType: Record<NetType, number>;   // JS/IMG/Font/CSS/Other breakdown source
  requestCount: number;
  domContentMs?: number;
  loadMs?: number;
  elapsedMs: number;         // live ticking until load fires
  verdict?: 'proof' | 'died'; // set on load complete vs preset threshold
}

export interface ConsoleEntry {
  id: string; pane: PaneId;
  level: 'log'|'info'|'warning'|'error';
  text: string;
  source: 'console'|'exception'|'log-domain';
  url?: string; line?: number;
  ts: number;
}

export interface NavState {
  pane: PaneId;
  url: string;
  loading: boolean;          // true from nav:load until load event
  canGoBack?: boolean; canGoForward?: boolean;
}
```

**Renderer → main (invoke):**

| Channel | Payload | Returns | Purpose |
|---|---|---|---|
| `settings:update` | `{ pane:PaneId, settings:Settings }` | `void` | Store settings for that pane (applied on next load). |
| `nav:load` | `{ url:string }` | `void` | Apply settings + navigate; in compare mode loads both panes. Auto-clears logs. |
| `nav:back` / `nav:forward` | `{ pane:PaneId }` | `void` | Pane history nav (still throttled). |
| `pane:setBounds` | `{ left:Rect, right?:Rect }` | `void` | Renderer reports computed native-pane rectangles (resize/drag/compare toggle). |
| `compare:toggle` | `{ on:boolean, rightSettings?:Settings }` | `void` | Create/destroy right WebContentsView + debugger. |
| `shot:capture` | `{}` | `{ savedPath:string }` | Capture pane(s); compare mode returns composited+labeled PNG path. |
| `export:html` | `{}` | `{ savedPath:string }` | Self-contained HTML report. |
| `export:har` | `{}` | `{ savedPath:string }` | HAR file. |
| `log:clear` | `{}` | `void` | Wipe network+console for all panes. |
| `settings:loadPersisted` | `{}` | `{ lastUrl:string, lastPreset:PresetId }` | Restore on launch. |

**Main → renderer (stream via `on`):**

| Channel | Payload | When |
|---|---|---|
| `net:request` | `NetRecord` (state:'pending') | `requestWillBeSent` (new requestId) → append row. |
| `net:update` | `Partial<NetRecord> & {id,pane}` | `responseReceived` / `loadingFinished` / `loadingFailed` / redirect → fill/finalize row. |
| `totals:update` | `Totals` | Throttled (~10/s) as requests finish + elapsed timer tick. |
| `console:entry` | `ConsoleEntry` | `consoleAPICalled` / `exceptionThrown` / `Log.entryAdded`. |
| `nav:state` | `NavState` | Navigation start, frameNavigated, load complete. |
| `pane:reattached` | `{ pane:PaneId }` | After crash re-attach (renderer may flash a notice). |

---

## D. Core modules (main process)

### ThrottleManager (`src/main/ThrottleManager.ts`)
**State:** none persistent (pure applier); holds a reference to the target debugger + a snapshot of last-applied `Settings` for re-apply on re-attach.
**Public:** `async apply(dbg, settings: Settings): Promise<void>`, `lastApplied(): Settings | undefined`.
**CDP calls (in order):**
1. `Network.emulateNetworkConditions({ offline:false, latency:settings.latencyMs, downloadThroughput: settings.downKbps*125, uploadThroughput: settings.upKbps*125 })`
2. `Emulation.setCPUThrottlingRate({ rate: settings.cpuRate })`
3. `Network.setCacheDisabled({ cacheDisabled: !settings.cacheEnabled })` and, when cache disabled, `Network.setBypassServiceWorker({ bypass: true })` (else `bypass:false`).
4. `Emulation.setScriptExecutionDisabled({ value: !settings.jsEnabled })`
5. Device: if `none` → `Emulation.clearDeviceMetricsOverride` + clear UA + `setTouchEmulationEnabled({enabled:false})`. Else `setDeviceMetricsOverride({width,height,deviceScaleFactor,mobile:true})` + `setUserAgentOverride({userAgent})` + `setTouchEmulationEnabled({enabled:true,maxTouchPoints:1})`.
**Edge cases:** All sends wrapped in try/catch (a detached session rejects). Order matters only in that enable-domains (done by PaneManager) precedes apply. Device profiles live in `shared/presets.ts` (Cheap Android 360×640 DPR2 Android UA; Old iPhone 375×667 DPR2 iOS UA).

### RequestTracker (`src/main/RequestTracker.ts`)
**State (per pane):** `Map<requestId, NetRecord>`, running `Totals`, `t0` monotonic.
**Public:** `handle(method, params)`, `reset()`, `snapshotTotals(): Totals`, `entries(): NetRecord[]` (for export).
**CDP events consumed:** `requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`.
**Logic & edge cases:**
- **Pending row:** on `requestWillBeSent` with no `redirectResponse` → create record (state pending), emit `net:request`. Map `params.type` → `NetType` (Document/Script/Stylesheet/Image/Font/XHR/Fetch/Media/Other).
- **Redirect byte counting:** when `requestWillBeSent` carries `redirectResponse`, add `redirectResponse.encodedDataLength` to that requestId's running bytes and increment `redirectChain` — redirect hops emit **no** `loadingFinished`, so this is the only place those bytes appear.
- **responseReceived:** record status/statusText/headers/mimeType, `fromCache = response.fromDiskCache`. Don't trust its `encodedDataLength` as final (it's "so far").
- **loadingFinished:** set `bytes += encodedDataLength` (authoritative final hop), `endMs`, `durationMs`, state finished; recompute totals + byType; emit `net:update` + throttled `totals:update`.
- **Cached responses:** `encodedDataLength` may be `0` (served from cache) — that's correct, count as 0 wire bytes; row still shows (cache badge if `fromCache`).
- **data: URLs:** no network round-trip; may still produce events with 0 bytes — keep the row, count 0.
- **Still-pending at load:** requests not finished when `Page.loadEventFired` arrives stay pending and finalize later; totals are append-only and keep updating after the verdict line (verdict is based on load time, not on all requests finishing).

### ConsoleTracker (`src/main/ConsoleTracker.ts`)
**State (per pane):** error counter, dedup set (networkRequestId/text+line) to avoid double-logging the same error from both Runtime and Log domains.
**Public:** `handle(method, params)`, `reset()`.
**CDP events:** `Runtime.consoleAPICalled` (stringify `args[].value/description`), `Runtime.exceptionThrown` (use `exceptionDetails.text` + url/line), `Log.entryAdded` (map `entry.level/text/url/lineNumber`). Emits `console:entry`; bumps error badge on level error/exception.

### NavTracker (`src/main/NavTracker.ts`)
**State (per pane):** `t0` (navigationStart monotonic), domContent/load ms.
**Public:** `handle(method, params)`, `markLoadStart()`, timing getters.
**CDP events:** `Page.lifecycleEvent name:'navigationStart'` (main frame) → set t0, emit `nav:state{loading:true}`; `Page.frameNavigated` (main frame) → update url; `Page.domContentEventFired` → `domContentMs = ts − t0`; `Page.loadEventFired` → `loadMs = ts − t0`, compute verdict vs preset threshold, emit `nav:state{loading:false}` + final `totals:update`.

### PaneManager (`src/main/PaneManager.ts`) — central
**State:** per pane: `WebContentsView`, `RequestTracker`, `ConsoleTracker`, `NavTracker`, last `Settings`. Owns the `BrowserWindow` reference.
**Public:** `ensurePane(id)`, `destroyPane(id)`, `setBounds(left, right?)`, `async load(url)`, `async applySettings(id, settings)`, `capture(id)`, `getExportData(id)`.
**Debugger lifecycle:**
- On pane create: `view.webContents.debugger.attach('1.3')` (guard `isAttached()`), then enable domains: `Network.enable`, `Runtime.enable`, `Log.enable`, `Page.enable`, `Page.setLifecycleEventsEnabled({enabled:true})`. Wire single `'message'` listener that routes by `method` prefix to the three trackers.
- **Re-attach logic:** listen on `webContents` for `render-process-gone` and `'destroyed'`, and on debugger for `'detach'`. On crash/detach: if webContents still alive, `attach('1.3')` again, re-enable all domains, re-run `ThrottleManager.apply` with last settings, emit `pane:reattached`. (Settings must be re-applied because CDP overrides reset with the renderer process.)
- **load():** reset trackers (auto-clear), apply settings, then `loadURL`. In compare mode, load both panes.
**Bounds:** `setBounds` receives renderer-computed rectangles and calls `view.setBounds` for each pane. Called on resize/log-drag/compare-toggle. (The pane is a native overlay, not HTML — this plumbing is mandatory, see G.)

### ShotService (`src/main/ShotService.ts`)
**Public:** `async capture(): Promise<string>`.
**Single pane:** `view.webContents.capturePage()` → `NativeImage.toPNG()` → write to `~/Pictures/potato/<host>-<preset>-<YYYY-MM-DD-HHmm>.png` (mkdir if absent).
**Compare mode:** capture both panes → `toDataURL()` each → send to renderer which composites side-by-side with preset labels on an offscreen `<canvas>` (NativeImage can't draw text), returns the merged dataURL/blob → main writes the file. (Decision in G.)

### ExportService (`src/main/ExportService.ts`)
**Public:** `async exportHtml(): Promise<string>`, `async exportHar(): Promise<string>`.
**HTML:** self-contained file — inline `<style>`, the network table rows, console entries, totals + verdict, and the screenshot embedded as base64 `<img>`. Saved next to screenshots.
**HAR:** build `log` per A.4 from `RequestTracker.entries()` + headers; `startedDateTime` from `wallTime`, `time` from durationMs, unknown timings/sizes → `-1`; failed requests → `status:0` + comment. Validates by being openable in DevTools.

### settingsStore (`src/main/settingsStore.ts`)
Tiny JSON in `app.getPath('userData')`: `{ lastUrl, lastPreset }`. Read on launch, write on load/settings change. No schema lib.

---

## E. Renderer design (Preact)

**State management:** A single module store (`store.ts`) using Preact signals (or a small reducer + `useReducer` at App root). Three concerns: `settings[pane]`, `log` (append-only `NetRecord[]` + `ConsoleEntry[]`), `totals[pane]`, `nav[pane]`. The store subscribes to `window.potato.on(...)` streams once at startup and mutates signals; components read signals directly. No external state lib.

**Component tree:**
```
App (3-region grid; computes & sends pane:setBounds)
├── Sidebar
│   ├── PresetPicker (radio; editing custom fields flips to 'custom')
│   ├── CustomFields (down/up kbps, latency ms, CPU dropdown)
│   ├── Toggles (JS, Cache)
│   ├── DeviceDropdown
│   ├── Totals (1 or 2 columns; breakdown, load timer, verdict)
│   └── Buttons (📷 Shot, 💾 Save log)
├── TopBar (URL input, reload w/ loading pulse, Compare toggle)
├── BrowserArea (empty spacer regions whose layout rect → native pane bounds)
└── LogPanel (resizable/collapsible)
    ├── Tabs: Network (n) | Console (errors badge)
    ├── FilterChips (All/JS/IMG/Font/CSS/XHR/Failed; + Left/Right in compare)
    ├── NetworkTable → NetRow* → DetailFlyout
    └── ConsoleList
```

**Live log performance:** Append-only; rows update in place by id. At realistic counts (tens to low hundreds of requests — these are slow garbage-network loads, not load tests) **virtualization is unnecessary**. Decided: plain mapped rows with keyed reconciliation; revisit only if a page exceeds ~500 requests (out of scope for v1). Throttle `totals:update` consumption with the incoming throttle already done in main.

**Filter chips:** pure client-side predicate over the in-memory `NetRecord[]` by `type`/`state`; "Failed" = `state==='failed'`. Counter in the Network tab label reflects total count. Compare adds a Left/Right pane chip.

**Detail flyout:** click a `NetRow` → anchored panel showing full URL, request/response headers (from the record), timing breakdown (start, duration, redirect hops, fromCache). Close on outside-click/Esc.

**Totals/verdict:** mono font, amber accent on active numbers. Elapsed timer ticks live from `totals.elapsedMs` until `loadMs` set; then show DOMContentLoaded (smaller) + load time + verdict line (`🥔 potato-proof` / `died on a potato`) colored green/red.

**Compare-mode layout switch:** `compare:toggle` → App recomputes BrowserArea into two halves, sends both rects via `pane:setBounds`, Totals renders two columns, right pane header gets its own `PresetPicker` (default Baked). Reload reloads both; you watch the gap.

**Native-pane bounds (critical):** App measures the BrowserArea region(s) via `getBoundingClientRect` after layout and on `ResizeObserver`/log-drag/compare-toggle, then fires `pane:setBounds`. The WebContentsView floats above the renderer at those coordinates.

---

## F. Milestones (ordered tasks + acceptance checks)

### M1 — it loads and throttles (the proof)
1. Scaffold electron-vite + TS + `@preact/preset-vite`; `electron.vite.config.ts` with `externalizeDepsPlugin()` in main & preload, `preact()` in renderer.
2. `package.json` scripts (`dev`, `build`); pin `electron@42.3.3`.
3. `window.ts` + `index.ts`: create dark BrowserWindow loading the renderer.
4. Minimal renderer: URL bar + reload button + a BrowserArea spacer; preload exposes `nav:load` + `pane:setBounds`.
5. `PaneManager.ensurePane('left')`: create WebContentsView, `addChildView`, set bounds from renderer rect.
6. Attach debugger `'1.3'`, `Network.enable`, wire `'message'` log to console.
7. Hardcode **Mashed** in `ThrottleManager.apply` (with the 125× conversion); call before `loadURL`.
8. Wire reload → `nav:load` → apply + navigate.

**Acceptance:** `npm run dev`; type a real URL, hit reload, watch the page load visibly slowly (Mashed). DevTools-free. Resize window → pane follows.

### M2 — controls
1. `shared/presets.ts` with full table (bytes/sec + thresholds + device profiles).
2. Sidebar: PresetPicker radio; selecting fills CustomFields; editing fields flips to Custom.
3. CustomFields (down/up/latency) + CPU dropdown wired into `Settings`.
4. JS toggle → `Emulation.setScriptExecutionDisabled`; Cache toggle → `setCacheDisabled`(+`setBypassServiceWorker`).
5. `settings:update` IPC stores per-pane settings; applied on next `nav:load` (no mid-load interruption).

**Acceptance:** Switch presets and reload — load speed visibly changes. Flip JS off, reload a JS-heavy site → broken/blank render. Toggle cache off → repeat reload stays cold.

### M3 — the log
1. `RequestTracker`: handle the four Network events; pending→finished lifecycle; byType breakdown; redirect byte counting.
2. `NavTracker`: lifecycle navigationStart t0, domContent/load timing, verdict.
3. Stream `net:request`/`net:update`/`totals:update`/`nav:state`.
4. NetworkTable + NetRow (color-coded, pending placeholder, size + time).
5. Totals block: total, breakdown, live elapsed timer, DOMContentLoaded + load, verdict line.
6. Reload auto-clears log + resets trackers.

**Acceptance:** Load a site on Mashed; rows stream in pending then fill with bytes/time; totals climb live; elapsed ticks; on load the verdict prints and matches the preset threshold. Redirecting URL counts all hops.

### M4 — polish
1. `ConsoleTracker`: consoleAPICalled/exceptionThrown/Log.entryAdded → Console tab + error badge.
2. Device dropdown → device metrics + UA + touch (and clear for None).
3. `ShotService` single-pane → `~/Pictures/potato/<host>-<preset>-<ts>.png`.
4. DetailFlyout (full URL, headers, timing).
5. Filter chips + Network/Console counters.
6. `settingsStore` persistence (last URL/preset) restored on launch.
7. Re-attach handling: `render-process-gone`/`detach` → re-attach + re-apply + `pane:reattached`.
8. Potato app icon in `resources/`.

**Acceptance:** A JS error under throttling appears red in Console with badge. Cheap Android device emulation changes layout + UA. Shot writes a correctly-named PNG. Filters/flyout work. Reopen app → last URL/preset restored. Force a renderer crash → tracking resumes after re-attach.

### M5 — compare mode + exports
1. `compare:toggle` → create/destroy right WebContentsView + debugger + trackers.
2. Layout split + dual `pane:setBounds`; right-pane PresetPicker (default Baked).
3. Dual Totals columns; Left/Right log filter chip.
4. Reload loads both panes simultaneously.
5. Compare screenshot: capture both → renderer canvas composite + preset labels → save.
6. `ExportService.exportHtml` (self-contained, screenshot embedded) + `exportHar` (HAR 1.2).

**Acceptance:** Toggle compare → two panes load same URL at once; you see the gap; totals show two columns. Shot produces one labeled side-by-side PNG. Save log writes an HTML you can open standalone and a HAR that opens in DevTools.

### M6 — builds
1. `electron-builder.yml`: `appId`, `productName`, `directories.output`, `files`, icon.
2. `linux: { target: [AppImage, deb], category, maintainer }`.
3. `win: { target: nsis }` + `nsis: { oneClick:false, allowToChangeInstallationDirectory:true }`.
4. `mac: { target: dmg, category }`.
5. `dist` script; produce artifacts.

**Acceptance:** `npm run dist` on Linux produces `.AppImage` + `.deb`; configs present and valid for win/mac (build where toolchain available). AppImage launches and runs the full M1–M5 flow.

---

## G. Risks & decided tradeoffs

1. **JS toggle API (PRD error).** PRD says `setJavaScriptEnabled(false)` — no such runtime webContents method (verified). **Decided:** `Emulation.setScriptExecutionDisabled({value:true})` via CDP; applies on next nav, no view recreation, preserves the debugger session. Re-applied on re-attach.
2. **WebContentsView is a native overlay, not HTML.** Highest-risk integration detail. **Decided:** renderer measures BrowserArea rects and pushes them via `pane:setBounds` on layout/resize/drag/compare-toggle; main calls `view.setBounds`. Mandatory plumbing, designed into C/D/E.
3. **kbps vs bytes/sec.** `downloadThroughput`/`uploadThroughput` are BYTES/sec; presets are kbps. **Decided:** single conversion `×125` in ThrottleManager + the verified table in A.5.
4. **`emulateNetworkConditions` deprecated.** Still fully supported, used by every tool. **Decided:** keep it for v1; don't adopt the per-request `...ByRule` variant (more complex, no benefit here). Noted as a future swap.
5. **Redirect bytes undercount.** Redirect hops share one requestId and emit no `loadingFinished`. **Decided:** add `redirectResponse.encodedDataLength` on each redirecting `requestWillBeSent` (verified the field exists).
6. **Cached responses → `encodedDataLength` 0.** Correct behavior, not a bug. **Decided:** count 0 wire bytes, show a cache badge from `response.fromDiskCache`.
7. **Events after load.** `loadingFinished` can arrive after `loadEventFired`. **Decided:** totals are append-only and keep updating; verdict is computed from load time only, not from all requests finishing.
8. **Service workers mask cold loads (PRD §7).** **Decided:** whenever cache disabled, also `Network.setBypassServiceWorker({bypass:true})`.
9. **Debugger lost on crash/detach (PRD §7).** **Decided:** listen on `render-process-gone`/`'destroyed'`/debugger `'detach'`; re-attach, re-enable domains, re-apply settings, emit `pane:reattached`.
10. **Compare-mode labeled screenshot.** NativeImage can't draw text or composite. **Decided:** capture each pane in main → dataURLs → renderer offscreen canvas composites side-by-side with preset labels → main writes the PNG. (Single-pane stays pure NativeImage.)
11. **Load-timing t0.** **Decided:** `Page.lifecycleEvent name:'navigationStart'` (main frame) as t0; all CDP timestamps are MonotonicTime, so `loadMs = loadEventFired.timestamp − t0`. No wall-clock diff.
12. **Console double-logging.** Runtime and Log domains can both surface the same error. **Decided:** dedup in ConsoleTracker by `networkRequestId`/text+line.
13. **Log virtualization.** **Decided:** none for v1 — request counts are low on garbage-network loads; keyed mapped rows suffice. Revisit only past ~500 requests (out of scope).
14. **Packet loss (PRD §7).** Out of scope; `emulateNetworkConditions` is protocol-level only. Accepted.

---

## H. Out-of-scope guardrails (do not gold-plate)

- **No CLI, no headless, no CI/GitHub Action.** GUI app only. (ThrottleManager/RequestTracker are written cleanly enough for a *future* headless reuse, but build none of it now.)
- **No publishing** — no npm package, no releases page, no auto-update. Just the repo + local builds.
- **No config files.** All configuration is live in the UI. The only persisted state is the tiny `userData` JSON (last URL + last preset).
- **No accounts, no backend, no telemetry.** Fully offline except the pages it loads.
- **No packet loss / connection-drop simulation.**
- **Max two compare panes.** No N-pane generalization.
- **No light theme**, no gradients, no animation beyond the reload-button loading pulse.
- **No database, no analytics, no settings schema/migrations.**
- Keep the personality: preset names (Raw/Mashed/Boiled/Baked), the verdict line (`🥔 potato-proof` / `died on a potato`), the amber `#C8893A` accent. The tool about bloat must not be bloated.
