// Tiny sync JSON persistence in userData: { lastUrl, settings }.
// Spec: potato-plan.md D (settingsStore).
import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PersistedState } from '../shared/types'
import type { ISettingsStore } from './contracts'

const FILE_NAME = 'potato-state.json'

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

export const settingsStore: ISettingsStore = {
  load(): PersistedState | undefined {
    try {
      return JSON.parse(readFileSync(filePath(), 'utf8')) as PersistedState
    } catch {
      // Missing or corrupt file — start fresh.
      return undefined
    }
  },

  save(state: PersistedState): void {
    const file = filePath()
    const tmp = `${file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      renameSync(tmp, file)
    } catch {
      // Persistence is best-effort; never crash the app over it.
    }
  }
}
