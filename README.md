# Potato 🥔

Desktop tool for watching websites load on garbage connections. Type a URL, pick how bad the network should be, watch it crawl in a real Chromium pane with a live request log.

Answers one question: **does this site survive on a potato?**

Built because our sites get tested on dev machines with fiber, but real users are on cheap Androids with 2G/3G.

## Run

```
npm install
npm run dev        # dev with hot reload
npx electron .     # run the built app (npm run build first)
npm run dist       # build .deb + .AppImage into release/
```

## Presets

| Preset | Down | Up | Latency | CPU | Simulates |
|---|---|---|---|---|---|
| 🥔 Raw | 50 kbps | 20 kbps | 1000 ms | 6x | EDGE/2G, ancient device |
| Mashed | 250 kbps | 50 kbps | 800 ms | 4x | Bad 2G/3G, cheap Android |
| Boiled | 750 kbps | 250 kbps | 300 ms | 2x | Mediocre 3G |
| Baked | 4 Mbps | 1 Mbps | 100 ms | 1x | Slow 4G |

Plus custom values, CPU throttling, JS on/off (the killer feature: flip it off and see if the site renders anything at all), cold-cache mode, and device emulation (viewport + UA + touch).

When the page finishes you get a verdict: `🥔 potato-proof` or `died on a potato`. Thresholds are a vibe check, not science.

Screenshots and HTML/HAR session exports land in `shots/`.

## How it works

Electron, because the embedded pane has to be real Chromium: throttling and request tracking go through `webContents.debugger` (Chrome DevTools Protocol). Plain Preact UI, no backend, no telemetry, settings live in one tiny JSON.

Heads up if you touch the code: Electron's debugger API silently drops some CDP events ([electron#37491](https://github.com/electron/electron/issues/37491)) — `loadingFinished`, `lifecycleEvent` and friends can just never arrive. Everything in `src/main/` that depends on a CDP event has a native-event or estimate fallback. Sizes shown with `≈` are estimated from Content-Length. See `potato-prd.md` and `potato-plan.md` for the full spec.

Internal tool. Not published, no releases, no support.
