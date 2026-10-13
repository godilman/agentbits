import type { PreloadBridge } from '../shared/ipc'

declare global {
  interface Window {
    agentbits: PreloadBridge
  }
}
export {}
