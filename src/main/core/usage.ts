import type { UsageSummary } from '@shared/types'
import { usageReportingFor } from '@shared/steering'
import { agentsRepo, providersRepo } from '../db/repos'
import { APP_SESSION_STARTED_AT, emptyTotals, usageRepo } from '../db/usage'
import { orchestrator } from './orchestrator'

/** Token usage per agent: all time, this app session and the task it is working on now. */
export function usageSummary(projectId?: string | null): UsageSummary {
  const by = usageRepo.byAgent(projectId)
  const def = providersRepo.getDefault()
  const agents = agentsRepo.list().map((a) => {
    const u = by.get(a.id)
    const run = orchestrator.activeRunOf(a.id)
    const provider = (a.providerId && providersRepo.get(a.providerId)) || def
    return {
      agentId: a.id,
      allTime: u?.allTime ?? emptyTotals(),
      session: u?.session ?? emptyTotals(),
      currentTaskId: run?.taskId ?? null,
      currentTask: run ? usageRepo.forTask(run.taskId, a.id) : null,
      reporting: usageReportingFor(provider?.kind ?? 'mock')
    }
  })
  const totals = usageRepo.totals(projectId)
  return { sessionStartedAt: APP_SESSION_STARTED_AT, agents, allTime: totals.allTime, session: totals.session }
}
