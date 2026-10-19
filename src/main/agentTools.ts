import type { AgentCtx, ToolOutput } from './connections/service'
import { connectionsFor } from './connections/service'
import { CONNECTION_TOOLS, runTool, type ToolSpec } from './connections/tools'
import { FILE_READ_TOOLS, FILE_SAVE_TOOL, FILE_TOOL_NAMES, runFileTool } from './files/tools'
import { readableFiles } from './files/service'
import { SKILL_TOOLS, SKILL_TOOL_NAMES, runSkillTool, skillsForAgent } from './skills/service'
import { APP_READ_TOOL_NAMES, appReadToolsFor, appToolsFor, isAppTool, runAppReadTool, runAppTool } from './apps/service'
import { TEAM_TOOL, runTeamTool } from './core/team'
import { WEB_TOOL, runWebTool, webToolFor } from './web/tool'
import { PROJECT_MEMORY_TOOL_NAMES, projectMemoryTools, runProjectMemoryTool } from './projectMemory/service'

/**
 * Every tool an agent may call, decided per agent and run: connection tools only
 * with at least one granted connection (in chat only the reading ones, without db_export; db_query refuses writes there), file read tools only
 * with at least one readable file, file_save only while working on a task, skill_read with at least one skill.
 */
export function agentTools(ctx: AgentCtx): ToolSpec[] {
  const out: ToolSpec[] = []
  if (connectionsFor(ctx.agentId).length) out.push(...(ctx.mode === 'chat' ? CONNECTION_TOOLS.filter((x) => x.name !== 'ssh_exec' && x.name !== 'db_export') : CONNECTION_TOOLS))
  if (readableFiles(ctx.agentId, ctx.projectId, ctx.taskId).length) out.push(...FILE_READ_TOOLS)
  if (ctx.mode !== 'chat' && ctx.projectId) out.push(FILE_SAVE_TOOL)
  if (skillsForAgent(ctx.agentId).length) out.push(...SKILL_TOOLS)
  out.push(...appToolsFor(ctx.agentId))
  out.push(...appReadToolsFor(ctx.agentId))
  // The browser permission: read public web pages (all providers; Claude Code's own WebFetch needs the network one).
  out.push(...webToolFor(ctx.agentId))
  // Parallel work: who else is working in the project and on which files (task runs only).
  if (ctx.mode !== 'chat' && ctx.projectId && ctx.runId) out.push(TEAM_TOOL)
  // The project's memory folder (task and chat: the user may say "remember this" in chat).
  out.push(...projectMemoryTools(ctx.projectId))
  return out
}

export async function runAgentTool(ctx: AgentCtx, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  if (name === TEAM_TOOL.name) return runTeamTool(ctx)
  if (PROJECT_MEMORY_TOOL_NAMES.has(name)) return runProjectMemoryTool(ctx, name, args)
  if (name === WEB_TOOL.name) return runWebTool(ctx, args)
  if (APP_READ_TOOL_NAMES.has(name)) return runAppReadTool(ctx, name, args)
  if (SKILL_TOOL_NAMES.has(name)) return runSkillTool(ctx, name, args)
  if (isAppTool(name)) return runAppTool(ctx, name, args)
  if (FILE_TOOL_NAMES.has(name)) {
    if (name === 'file_save' && ctx.mode === 'chat') return { text: 'file_save is only available while working on a task.', isError: true }
    return runFileTool(ctx, name, args)
  }
  if (ctx.mode === 'chat' && name === 'ssh_exec') return { text: 'ssh_exec is only available while working on a task.', isError: true }
  return runTool(ctx, name, args)
}
