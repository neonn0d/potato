# Potato - PRD

Internal desktop tool for testing websites under garbage network and device conditions, live.

Version: 1.0 draft
Owner: Mentor (neonn0d)
Status: not published, internal only

---

## 1. Problem

The sites we build (Virtuverse games sites, Pretty Please, everything targeting Balkan / data-poor markets) get tested on dev machines with fast connections. Real users are on cheap Androids with 2G/3G. There's no quick way to *watch* a site load under those conditions and see exactly what's slow, what's heavy, and whether the page survives without JS. DevTools throttling exists but it's buried, fiddly, and gives you 47 metrics instead of an answer.

## 2. What Potato is

A standalone desktop app. One window. You type a URL, pick how bad the connection should be, hit reload, and watch the page load in a real embedded browser in real time, with a live log of every request, its size, and the running payload total.

It answers one question: **does this site survive on a potato?**

## 3. What Potato is NOT (v1)

- Not a CLI
- Not a CI tool / GitHub Action
- Not headless
- Not published anywhere (no npm, no releases page, just a repo)
- No config files. Everything is configured in the UI, live
- No accounts, no backend, no telemetry. Fully offline except the pages it loads

## 4. Platforms

Linux (Debian, primary dev machine), Windows, macOS. One codebase, builds for all three.

## 5. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | It IS Chromium. `webContents.debugger` gives direct CDP access to the embedded browser pane. Tauri can't do this (WebKit/WebView2, no proper throttling). |
| Browser pane | `WebContentsView` | Modern replacement for BrowserView. Real Chromium rendering the target site. |
| Throttling | CDP via `webContents.debugger.attach('1.3')` | `Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate` |
| Request log | CDP `Network.*` events | `requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed` |
| Console capture | CDP `Runtime.consoleAPICalled`, `Log.entryAdded` | Page errors surface in our log panel |
| UI | Plain HTML/CSS/JS or Preact in the renderer | It's 5 controls and 2 panels. No Next.js, no React bloat. The tool about bloat should not be bloated. |
| Packaging | electron-builder | deb + AppImage, nsis (Win), dmg (Mac) |

No database. Settings persist to a tiny JSON in `userData` (last URL, last preset) just so it reopens where you left it.

## 6. UI spec

### 6.1 Layout

Single window, three regions. Left sidebar (controls), main area (browser), bottom panel (logs). Sidebar fixed ~280px, log panel resizable by dragging, collapsible.

```
┌────────────┬──────────────────────────────────────────┐
│  POTATO 🥔 │  [ url bar........................ ] [⟳] │
│            ├──────────────────────────────────────────┤
│ PRESET     │                                          │
│ ◉ Raw      │                                          │
│ ○ Mashed   │                                          │
│ ○ Boiled   │            LIVE BROWSER PANE             │
│ ○ Baked    │         (WebContentsView, real           │
│ ○ Custom   │          Chromium, you watch it          │
│            │          load in real time)              │
│ CUSTOM     │                                          │
│ ↓ [250]kbps│                                          │
│ ↑ [50] kbps│                                          │
│ ⏱ [800] ms │                                          │
│ CPU [4x ▾] │                                          │
│            ├──────────────────────────────────────────┤
│ JS  [on●]  │ LOGS                    [Network|Console]│
│ Cache[off●]│ 200 GET /index.html      12.4 KB   1.2s  │
│ Device     │ 200 GET /main.js        184.2 KB   6.8s  │
│ [Cheap ▾]  │ 200 GET /hero.webp       96.1 KB   4.1s  │
│            │ ✗   GET /font.woff2     timeout          │
│ ─────────  │                                          │
│ TOTAL      │                                          │
│ 1.24 MB    │                                          │
│ JS 480 KB  │                                          │
│ IMG 620 KB │                                          │
│ Load 14.2s │                                          │
│            │                                          │
│ [📷 Shot]  │                                          │
└────────────┴──────────────────────────────────────────┘
```

### 6.2 Visual direction

Dev tool, dark theme only. Near-black background, monospace for all numbers and the log (JetBrains Mono or system mono), a single potato-brown/amber accent (#C8893A range) for the active preset, totals, and the reload button. Status colors: green 2xx, amber 3xx/slow, red 4xx/5xx/timeout. No gradients, no animation except a subtle pulse on the reload button while the page is loading. The personality comes from the preset names and the verdict line, not from decoration.

### 6.3 Controls (left sidebar)

**Presets** (radio group). Selecting one applies instantly to the next load:

| Preset | Down | Up | Latency | CPU | Meant to simulate |
|---|---|---|---|---|---|
| 🥔 Raw | 50 kbps | 20 kbps | 1000 ms | 6x | PSP-tier. EDGE/2G, ancient device |
| Mashed | 250 kbps | 50 kbps | 800 ms | 4x | Bad 2G/3G, cheap Android |
| Boiled | 750 kbps | 250 kbps | 300 ms | 2x | Mediocre 3G |
| Baked | 4 Mbps | 1 Mbps | 100 ms | 1x | Slow 4G, baseline sanity check |
| Custom | user values | user values | user values | user pick | Whatever you want |

Selecting Raw/Mashed/Boiled/Baked fills the custom fields with its values (so you can see the numbers and nudge them, which flips the radio to Custom).

**Custom fields:** download kbps, upload kbps, latency ms (number inputs). CPU throttle: dropdown 1x / 2x / 4x / 6x / 8x.

**Toggles:**
- JS on/off. Off = CDP `Emulation.setScriptExecutionDisabled({value:true})` (what DevTools' own checkbox uses; applies on next load). The killer feature: flip it off, reload, and see if the site renders anything at all.
- Cache on/off (default off). Off = `Network.setCacheDisabled(true)` so every reload is a cold load like a first-time user.

**Device dropdown:** None (desktop viewport) / Cheap Android (360x640, DPR 2, touch, Android UA) / Old iPhone (375x667, DPR 2, touch, iOS UA). Implemented via `Emulation.setDeviceMetricsOverride` + `Emulation.setUserAgentOverride` + `Emulation.setTouchEmulationEnabled`.

**Totals block** (live, updates as requests finish):
- Total transferred (encoded bytes over the wire)
- Breakdown: JS / Images / Fonts / CSS / Other
- Load time: navigation start to `load` event (and DOMContentLoaded shown smaller)
- Verdict line after load completes: "🥔 potato-proof" if load event under threshold for the current preset, "died on a potato" otherwise. Thresholds hardcoded per preset (e.g. Raw: 30s, Mashed: 15s, Boiled: 8s, Baked: 4s). It's a vibe check, not science.

**📷 Shot button:** captures the browser pane to PNG, saves to `~/Pictures/potato/` with timestamp + preset in the filename (`cricketpandit-mashed-2026-06-12-1432.png`). For pasting into Slack at Angus.

**💾 Save log button:** exports the current session to a single self-contained HTML file (the network table, console errors, totals, verdict, and the screenshot embedded) saved next to the screenshots. One file you can attach or archive. Also offers raw HAR export from the same data for opening in DevTools later.

### 6.4 Browser pane

- Real `WebContentsView`, navigates to whatever's in the URL bar
- **Compare mode** (toggle in the top bar, off by default): splits the main area into two panes loading the same URL simultaneously. Left pane uses the sidebar settings, right pane has its own mini preset picker in its header (default: Baked, so the typical use is "your settings vs a normal connection"). Each pane gets its own WebContentsView + debugger session + request tracking. Totals block shows two columns side by side. Log panel gains a Left/Right filter chip. Reload reloads both at once, so you watch one finish while the other is still crawling. That visual gap IS the argument
- Screenshot in compare mode captures both panes in one image, each labeled with its preset
- Reload button (and Enter in URL bar) triggers a fresh navigation with current settings applied
- Changing any setting mid-load does NOT interrupt; settings apply on next reload. (Simpler, predictable, and matches how you'd actually use it)
- Loading state: thin amber progress indication on the reload button, plus elapsed timer ticking live in the totals block, so a 40 second Raw load *feels* like 40 seconds. That's the point
- Page is fully interactive after load: you can click around, navigate, fill forms, all still throttled. Subsequent navigations also get logged

### 6.5 Log panel (bottom)

Two tabs:

**Network tab.** One row per request, appended live in order:
`status | method | path (truncated, full URL on hover) | type | size | time`
- Color coded by status, failed/timeout rows in red with reason
- Rows appear at `requestWillBeSent` in a pending state, fill in on `loadingFinished`/`loadingFailed`
- Click a row → small detail flyout: full URL, request/response headers, timing breakdown
- Filter chips: All / JS / IMG / Font / CSS / XHR / Failed
- Counter in the tab label: "Network (47)"

**Console tab.** Page console output via CDP: errors, warnings, logs. Errors red. Counter badge for errors specifically, because a JS error under throttling that you don't get on fast connections is exactly the bug this tool exists to find.

Clear button wipes both on demand. Reload auto-clears.

## 7. Architecture

```
main process
├── creates BrowserWindow (the app shell, loads renderer UI)
├── creates WebContentsView (target site pane), attaches debugger (CDP 1.3)
├── ThrottleManager: applies Network.emulateNetworkConditions,
│   Emulation.setCPUThrottlingRate, cache + JS + device settings
├── RequestTracker: subscribes to Network.* CDP events, aggregates
│   per-request records + running totals, streams to renderer via IPC
└── ConsoleTracker: Runtime/Log CDP events → IPC

renderer (the UI)
├── sidebar controls → IPC → main applies settings
├── network log table ← IPC stream
├── console log ← IPC stream
└── totals/verdict ← IPC aggregate updates
```

Single IPC channel pattern: renderer sends `settings:update`, `nav:load`, `shot:capture`; main streams `net:request`, `net:update`, `console:entry`, `totals:update`, `nav:state`.

Gotchas to handle:
- Debugger must re-attach after the WebContentsView's webContents is recreated (crashes, some navigations). Listen for `destroyed`/`render-process-gone` and re-attach + re-apply settings.
- `Network.emulateNetworkConditions` throttles at the protocol level, it won't perfectly simulate radio behavior (no packet loss). Good enough. Packet loss simulation is a non-goal for v1.
- Service workers can mask cold-load behavior. With cache disabled also call `Network.setBypassServiceWorker(true)` so reload = true first visit.
- Redirect chains: count every hop's bytes into totals.

## 8. Milestones

**M1 - it loads and throttles (the proof)**
Window + WebContentsView + URL bar + reload. Debugger attached, Mashed preset hardcoded, watch a site load slow. ~1 evening.

**M2 - controls**
All presets, custom fields, CPU, JS toggle, cache toggle. Settings apply on reload. ~1 evening.

**M3 - the log**
Network tab live rows, totals block with breakdown, load timer, verdict line. This is where it becomes useful. ~1-2 evenings.

**M4 - polish**
Console tab, device emulation, screenshot button, request detail flyout, filters, settings persistence, app icon (a potato). ~1-2 evenings.

**M5 - compare mode + exports**
Second pane with own debugger session, dual totals, combined screenshot, HTML log export + HAR. ~2 evenings.

**M6 - builds**
electron-builder configs for deb/AppImage, Windows, macOS. ~1 evening.

Realistic total: a bit over a week of evenings for something genuinely done. M1-M4 alone is already a usable tool, ship yourself that first.

## 9. Future ideas (explicitly out of scope for v1)

- Headless mode reusing ThrottleManager + RequestTracker for CI later, if ever wanted
- Packet loss / connection drop simulation
- More than two compare panes

## 10. Success criteria

v1 is done when: open Potato, paste a Virtuverse site URL, hit compare (Mashed vs Baked), watch the gap, flip JS off and reload to see what survives, hit Shot, drop the labeled side-by-side PNG in Slack. Under 60 seconds from launch to screenshot.
