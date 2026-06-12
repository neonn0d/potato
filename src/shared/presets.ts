// Preset + device tables. Source of truth: PRD §6.3 and potato-plan.md §A.5.
// CDP Network.emulateNetworkConditions takes BYTES/sec: bytes_per_sec = kbps * 125.
import type { DeviceId, PresetId, Settings } from './types'

export const KBPS_TO_BYTES_PER_SEC = 125

export interface PresetDef {
  id: Exclude<PresetId, 'custom'>
  label: string
  downKbps: number
  upKbps: number
  latencyMs: number
  cpuRate: 1 | 2 | 4 | 6 | 8
  /** verdict threshold: load event under this = 🥔 potato-proof */
  thresholdMs: number
  blurb: string
}

export const PRESETS: Record<Exclude<PresetId, 'custom'>, PresetDef> = {
  raw: {
    id: 'raw',
    label: '🥔 Raw',
    downKbps: 50,
    upKbps: 20,
    latencyMs: 1000,
    cpuRate: 6,
    thresholdMs: 30_000,
    blurb: 'PSP-tier. EDGE/2G, ancient device'
  },
  mashed: {
    id: 'mashed',
    label: 'Mashed',
    downKbps: 250,
    upKbps: 50,
    latencyMs: 800,
    cpuRate: 4,
    thresholdMs: 15_000,
    blurb: 'Bad 2G/3G, cheap Android'
  },
  boiled: {
    id: 'boiled',
    label: 'Boiled',
    downKbps: 750,
    upKbps: 250,
    latencyMs: 300,
    cpuRate: 2,
    thresholdMs: 8_000,
    blurb: 'Mediocre 3G'
  },
  baked: {
    id: 'baked',
    label: 'Baked',
    downKbps: 4000,
    upKbps: 1000,
    latencyMs: 100,
    cpuRate: 1,
    thresholdMs: 4_000,
    blurb: 'Slow 4G, baseline sanity check'
  }
}

export const PRESET_ORDER: Array<Exclude<PresetId, 'custom'>> = ['raw', 'mashed', 'boiled', 'baked']

/** Verdict threshold for a settings object; custom falls back to the nearest preset vibe (Mashed). */
export function thresholdFor(settings: Settings): number {
  if (settings.preset !== 'custom') return PRESETS[settings.preset].thresholdMs
  return 15_000
}

export interface DeviceProfile {
  id: DeviceId
  label: string
  width: number
  height: number
  deviceScaleFactor: number
  userAgent: string
}

export const DEVICES: Record<Exclude<DeviceId, 'none'>, DeviceProfile> = {
  cheapAndroid: {
    id: 'cheapAndroid',
    label: 'Cheap Android',
    width: 360,
    height: 640,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
  },
  oldIphone: {
    id: 'oldIphone',
    label: 'Old iPhone',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'
  }
}

export function defaultSettings(): Settings {
  const p = PRESETS.mashed
  return {
    preset: 'mashed',
    downKbps: p.downKbps,
    upKbps: p.upKbps,
    latencyMs: p.latencyMs,
    cpuRate: p.cpuRate,
    jsEnabled: true,
    cacheEnabled: false,
    device: 'none'
  }
}

export function settingsFromPreset(id: Exclude<PresetId, 'custom'>, base?: Settings): Settings {
  const p = PRESETS[id]
  const b = base ?? defaultSettings()
  return {
    ...b,
    preset: id,
    downKbps: p.downKbps,
    upKbps: p.upKbps,
    latencyMs: p.latencyMs,
    cpuRate: p.cpuRate
  }
}
