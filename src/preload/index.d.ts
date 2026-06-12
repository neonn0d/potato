import type { MainToRendererPayloads, RendererToMain } from '../shared/ipc'

declare global {
  interface Window {
    potato: {
      invoke: <C extends keyof RendererToMain>(
        channel: C,
        payload?: RendererToMain[C]['payload']
      ) => Promise<RendererToMain[C]['result']>
      on: <C extends keyof MainToRendererPayloads>(
        channel: C,
        cb: (payload: MainToRendererPayloads[C]) => void
      ) => () => void
    }
  }
}

export {}
