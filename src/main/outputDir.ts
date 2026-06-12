// Where shots + exports get saved: a `shots/` folder NEXT TO THE APP (the
// patato project folder in dev). Falls back through candidates because a
// packaged app's own directory (asar / /opt) is read-only.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let resolved: string | undefined

export function outputDir(): string {
  if (resolved) return resolved
  const candidates = [
    // dev (`electron .` from the project): the project folder itself
    ...(app.isPackaged ? [] : [path.join(app.getAppPath(), 'shots')]),
    // packaged: next to the binary if writable (portable/AppImage-adjacent use)
    path.join(path.dirname(process.execPath), 'shots'),
    // last resort: userData is always writable
    path.join(app.getPath('userData'), 'shots')
  ]
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      resolved = dir
      return dir
    } catch {
      // not writable — try the next candidate
    }
  }
  // unreachable in practice; userData mkdir cannot fail
  resolved = app.getPath('userData')
  return resolved
}
