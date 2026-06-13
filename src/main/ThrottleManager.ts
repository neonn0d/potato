// Pure applier of Settings → CDP commands on a pane's debugger session.
// Source of truth: potato-plan.md section D (ThrottleManager) + section A.2 param shapes.
import { DEVICES, KBPS_TO_BYTES_PER_SEC } from '../shared/presets'
import type { Settings } from '../shared/types'

export class ThrottleManager {
  private last: Settings | undefined
  /** True while a device UA override is active, so 'none' knows to restore the original. */
  private uaOverridden = false

  /**
   * @param originalUA the pane webContents' UA captured at pane creation —
   * CDP has no "clear UA override" command, so returning to device 'none'
   * re-applies this instead.
   */
  constructor(private readonly originalUA: string) {}

  lastApplied(): Settings | undefined {
    return this.last
  }

  async apply(dbg: Electron.Debugger, settings: Settings): Promise<void> {
    // A detached debugger rejects every sendCommand — log and continue, never throw.
    // Some commands HANG instead of rejecting (renderer mid-spawn) — per-command
    // timeout so one stuck command can't abandon the rest of the settings.
    const send = async (method: string, params?: Record<string, unknown>): Promise<void> => {
      try {
        await Promise.race([
          dbg.sendCommand(method, params),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('timed out after 2000ms')), 2000)
          )
        ])
      } catch (err) {
        console.error(`[ThrottleManager] ${method} failed:`, err)
      }
    }

    // Throughput is BYTES/sec; presets are kbps (×125). 0 kbps = unthrottled
    // (CDP: -1 disables the limit) — used by the Normal preset.
    await send('Network.emulateNetworkConditions', {
      offline: false,
      latency: settings.latencyMs,
      downloadThroughput:
        settings.downKbps > 0 ? settings.downKbps * KBPS_TO_BYTES_PER_SEC : -1,
      uploadThroughput: settings.upKbps > 0 ? settings.upKbps * KBPS_TO_BYTES_PER_SEC : -1
    })
    await send('Emulation.setCPUThrottlingRate', { rate: settings.cpuRate })
    await send('Network.setCacheDisabled', { cacheDisabled: !settings.cacheEnabled })
    // Cache off must mean "true first visit" — bypass service workers too.
    await send('Network.setBypassServiceWorker', { bypass: !settings.cacheEnabled })
    await send('Emulation.setScriptExecutionDisabled', { value: !settings.jsEnabled })

    if (settings.device === 'none') {
      await send('Emulation.clearDeviceMetricsOverride')
      await send('Emulation.setTouchEmulationEnabled', { enabled: false })
      if (this.uaOverridden) {
        await send('Emulation.setUserAgentOverride', { userAgent: this.originalUA })
        this.uaOverridden = false
      }
    } else {
      const d = DEVICES[settings.device]
      await send('Emulation.setDeviceMetricsOverride', {
        width: d.width,
        height: d.height,
        deviceScaleFactor: d.deviceScaleFactor,
        mobile: true
      })
      await send('Emulation.setUserAgentOverride', { userAgent: d.userAgent })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      this.uaOverridden = true
    }

    this.last = settings
  }
}
