import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { AppEvent, PreloadBridge } from '@shared/ipc'

const bridge: PreloadBridge = {
  invoke: (method, ...args) => ipcRenderer.invoke('api', method, ...args),
  on: (listener) => {
    const handler = (_e: IpcRendererEvent, event: AppEvent): void => listener(event)
    ipcRenderer.on('event', handler)
    return () => ipcRenderer.removeListener('event', handler)
  },
  platform: process.platform,
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

contextBridge.exposeInMainWorld('agentbits', bridge)
