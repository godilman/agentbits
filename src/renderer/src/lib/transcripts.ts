import type { AgentLog } from '@shared/types'
import { bridge } from './api'

/**
 * Routes live transcript entries (`log:new`) to the agent terminal that shows them,
 * without going through the global store, so a busy agent never re-renders every pane.
 */
type Listener = (log: AgentLog) => void

const byAgent = new Map<string, Set<Listener>>()
const resetListeners = new Set<() => void>()
let started = false

function start(): void {
  if (started) return
  started = true
  bridge().on((e) => {
    if (e.type === 'log:new' && e.log.agentId) byAgent.get(e.log.agentId)?.forEach((l) => l(e.log))
    // Bulk deletes (data clean-up): panes reload from the database.
    else if (e.type === 'messages:changed') resetListeners.forEach((l) => l())
  })
}

export function subscribeTranscript(agentId: string, onLog: Listener, onReset: () => void): () => void {
  start()
  let set = byAgent.get(agentId)
  if (!set) byAgent.set(agentId, (set = new Set()))
  set.add(onLog)
  resetListeners.add(onReset)
  return () => {
    set!.delete(onLog)
    resetListeners.delete(onReset)
  }
}
