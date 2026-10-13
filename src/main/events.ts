import { BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/ipc'

type Listener = (e: AppEvent) => void
const listeners = new Set<Listener>()

/** Broadcast an event to every renderer window and in-process listeners. */
export function emit(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('event', event)
  }
  for (const l of listeners) l(event)
}

export function onEvent(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function toast(level: 'info' | 'success' | 'error', text: string): void {
  emit({ type: 'toast', level, text })
}
