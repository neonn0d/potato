import { contextBridge, ipcRenderer } from 'electron'
import type { MainToRendererPayloads, RendererToMain } from '../shared/ipc'

const api = {
  invoke: <C extends keyof RendererToMain>(
    channel: C,
    payload?: RendererToMain[C]['payload']
  ): Promise<RendererToMain[C]['result']> => ipcRenderer.invoke(channel, payload),

  on: <C extends keyof MainToRendererPayloads>(
    channel: C,
    cb: (payload: MainToRendererPayloads[C]) => void
  ): (() => void) => {
    const listener = (_event: unknown, payload: MainToRendererPayloads[C]): void => cb(payload)
    ipcRenderer.on(channel, listener as never)
    return () => {
      ipcRenderer.removeListener(channel, listener as never)
    }
  }
}

contextBridge.exposeInMainWorld('potato', api)

export type PotatoApi = typeof api
