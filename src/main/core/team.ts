import type { AgentCtx, ToolOutput } from '../connections/service'
import type { ToolSpec } from '../connections/tools'

/**
 * What the team is doing right now, per project (in memory; the orchestrator keeps it up to date): who works on which
 * task and which files their run has written so far. Agents see it at the start of a run and through `team_status`, so
 * parallel developers know who is touching what. Isolation itself is the git worktree mode (project setting).
 */
export interface TeamRun {
  runId: string
  agentId: string
  agentName: string
  projectId: string
  taskKey: string
  title: string
  /** Paths written by the run (as the provider reported them), newest last. */
  touched: string[]
  /** The same paths normalised for comparison (slashes, Windows case). */
  keys: string[]
}

const runs = new Map<string, TeamRun>()

export const teamState = {
  start(r: Omit<TeamRun, 'touched' | 'keys'>): void {
    runs.set(r.runId, { ...r, touched: [], keys: [] })
  },
  end(runId: string): void {
    runs.delete(runId)
  },
  /**
   * Records a written path; returns the other runs of the project that already wrote the same path
   * (a possible conflict).
   */
  touch(runId: string, path: string): TeamRun[] {
    const r = runs.get(runId)
    if (!r || !path) return []
    const k = normalize(path)
    if (!r.keys.includes(k)) {
      r.keys.push(k)
      r.touched.push(path.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      if (r.keys.length > 200) (r.keys.shift(), r.touched.shift())
    }
    return [...runs.values()].filter((o) => o.runId !== runId && o.projectId === r.projectId && o.keys.includes(k))
  },
  /** The other runs of a project (not `exceptRunId`). */
  others(projectId: string, exceptRunId: string | null): TeamRun[] {
    return [...runs.values()].filter((o) => o.projectId === projectId && o.runId !== exceptRunId)
  }
}

/** Paths compare the same however the provider wrote them (slashes, a leading "./", Windows case). */
function normalize(p: string): string {
  const s = p.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** Prompt / tool text: teammates' current tasks and the files they wrote. */
export function describeTeam(projectId: string, exceptRunId: string | null): string {
  const list = teamState.others(projectId, exceptRunId)
  if (!list.length) return ''
  return list
    .map((o) => `- ${o.agentName}: ${o.taskKey} ${o.title}${o.touched.length ? `\n  files written so far: ${o.touched.slice(-15).join(', ')}` : ''}`)
    .join('\n')
}

export const TEAM_TOOL: ToolSpec = {
  name: 'team_status',
  description:
    'Who else in your project is working right now, on which task, and which files they have written so far. Call it before editing a file that a teammate might also be changing, and coordinate (choose other files, or leave a note in your report) instead of overwriting their work.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}

export function runTeamTool(ctx: AgentCtx): ToolOutput {
  if (!ctx.projectId) return { text: 'No project.', isError: true }
  const text = describeTeam(ctx.projectId, ctx.runId ?? null)
  return { text: text || 'Nobody else in this project is working right now.', isError: false }
}
