import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { OrgUnit } from '@shared/types'
import { SCRIPT_EXT, SKILL_LIMITS, type AgentSkill, type Skill } from '@shared/skills'
import { getDbPath } from '../db'
import { agentsRepo, unitsRepo } from '../db/repos'
import type { AgentCtx, ToolOutput } from '../connections/service'
import type { ToolSpec } from '../connections/tools'
import { decodeText } from '../files/extract'
import { t } from '../i18n'
import { skillsRepo } from './repo'

/**
 * Skills at run time: which skills an agent has (directly or through its units), the prompt section listing them,
 * the `skill_read` tool, and per-run copies on disk for CLI agents (Codex reads files itself; Claude Code agents
 * with terminal permission can run a skill's scripts). The copies are throwaway: editing them never changes the
 * installed skill.
 */

/** Units an agent belongs to, plus all their ancestors (a skill assigned to a company reaches its teams' members). */
function unitClosure(agentId: string, units: OrgUnit[]): Set<string> {
  const byId = new Map(units.map((u) => [u.id, u]))
  const out = new Set<string>()
  for (const u of units) {
    if (!u.members.some((m) => m.agentId === agentId)) continue
    let cur: OrgUnit | undefined = u
    while (cur && !out.has(cur.id)) {
      out.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return out
}

/** Enabled skills of an agent with where each comes from. Assigned to the root unit = every agent. */
export function skillsForAgent(agentId: string, opts: { includeDisabled?: boolean } = {}): AgentSkill[] {
  const units = unitsRepo.list()
  const root = units.find((u) => u.parentId === null)
  const mine = unitClosure(agentId, units)
  const names = new Map(units.map((u) => [u.id, u.name]))
  const out: AgentSkill[] = []
  for (const skill of skillsRepo.list()) {
    if (!skill.enabled && !opts.includeDisabled) continue
    const via = skill.assignments
      .filter((a) => (a.type === 'agent' ? a.id === agentId : a.id === root?.id || mine.has(a.id)))
      .map((a) => ({ type: a.type, id: a.id, name: a.type === 'agent' ? (agentsRepo.get(a.id)?.name ?? '') : (names.get(a.id) ?? '') }))
    if (via.length) out.push({ skill, via })
  }
  return out
}

export function skillNamesFor(agentId: string): string[] {
  return skillsForAgent(agentId).map((s) => s.skill.name)
}

export const SKILL_TOOLS: ToolSpec[] = [
  {
    name: 'skill_read',
    description:
      'Read one of your skills (instruction packages the user installed for you). Without `path` it returns the skill’s SKILL.md and the list of its files; with `path` it returns that file (text files only).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name, exactly as listed under "Skills"' },
        path: { type: 'string', description: 'Optional file inside the skill, e.g. reference/api.md' }
      },
      required: ['name'],
      additionalProperties: false
    }
  }
]
export const SKILL_TOOL_NAMES = new Set(SKILL_TOOLS.map((x) => x.name))

export function runSkillTool(ctx: AgentCtx, name: string, args: Record<string, unknown>): ToolOutput {
  const skillName = typeof args.name === 'string' ? args.name.trim() : ''
  const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim().replace(/\\/g, '/').replace(/^\.?\//, '') : 'SKILL.md'
  if (name !== 'skill_read') return { text: `Unknown tool: ${name}`, isError: true }
  const mine = skillsForAgent(ctx.agentId)
  const s = mine.find((x) => x.skill.name.toLowerCase() === skillName.toLowerCase())?.skill
  if (!s) return { text: `Unknown skill "${skillName}". Your skills: ${mine.map((x) => x.skill.name).join(', ') || '(none)'}`, isError: true }
  const files = skillsRepo.files(s.id)
  const f = files.find((x) => x.path.toLowerCase() === path.toLowerCase())
  if (!f) return { text: `No file "${path}" in skill ${s.name}. Files: ${files.map((x) => x.path).join(', ')}`, isError: true }
  ctx.log?.('tool', t('main:skills.log.read', { name: s.name, path: f.path }))
  if (!f.text) return { text: `${f.path} is not a text file (${f.size} bytes); it cannot be read here.`, isError: true }
  let text = decodeText(new Uint8Array(skillsRepo.file(s.id, f.path) ?? Buffer.alloc(0))).text
  if (text.length > SKILL_LIMITS.maxReadChars) text = text.slice(0, SKILL_LIMITS.maxReadChars) + '\n…[truncated]'
  const header = `Skill "${s.name}" — ${f.path}`
  const listing = f.path === 'SKILL.md' && files.length > 1 ? `\n\nFiles in this skill:\n${files.map((x) => `- ${x.path} (${x.size} bytes)`).join('\n')}` : ''
  return { text: `${header}\n\n${text}${listing}`, isError: false }
}

/**
 * The "## Skills" prompt section. `tool`: read with skill_read (Claude Code over MCP, APIs, demo). `paths`: the agent
 * reads the files itself from the per-run copies (Codex). `scriptDirs` adds the copy folder of skills with scripts
 * for agents allowed to run commands.
 */
export function skillsPrompt(agentId: string, opts: { mode: 'tool' | 'paths'; dirs?: Map<string, string>; scriptDirs?: boolean }): string {
  const list = skillsForAgent(agentId).slice(0, SKILL_LIMITS.maxListed)
  if (!list.length) return ''
  const lines = list.map(({ skill }) => {
    const dir = opts.dirs?.get(skill.name)
    let line = `- **${skill.name}**: ${skill.description || '(no description)'}`
    if (opts.mode === 'paths' && dir) line += `\n  SKILL.md: ${join(dir, 'SKILL.md')}`
    else if (opts.scriptDirs && dir && skill.hasScripts) line += `\n  Files (incl. scripts you may run): ${dir}`
    return line
  })
  const how =
    opts.mode === 'tool'
      ? 'Skills are instruction packages the user installed for you. When the work matches a skill’s description, read it first with the `skill_read` tool and follow it. A skill may refer to extra files in it; read them with `skill_read` (name + path).'
      : 'Skills are instruction packages the user installed for you. When the work matches a skill’s description, read its SKILL.md (path below) first and follow it; files it refers to are in the same folder.'
  return `## Skills\n${how}\n${lines.join('\n')}`
}

/** Per-run copies of an agent's skills under <data>/tmp/skills/<runKey>/<name>/. */
export function materializeSkills(agentId: string, runKey: string, only?: (s: Skill) => boolean): { dirs: Map<string, string>; dispose: () => void } {
  const list = skillsForAgent(agentId).map((x) => x.skill).filter((s) => (only ? only(s) : true))
  const dirs = new Map<string, string>()
  if (!list.length) return { dirs, dispose: () => undefined }
  const root = join(dirname(getDbPath()), 'tmp', 'skills', runKey.replace(/[^\w-]/g, ''))
  for (const s of list) {
    const dir = join(root, s.name)
    for (const [p, data] of skillsRepo.allFiles(s.id)) {
      const target = join(dir, ...p.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      if (SCRIPT_EXT.test(p) && process.platform !== 'win32') {
        try {
          chmodSync(target, 0o755)
        } catch {
          /* best effort */
        }
      }
    }
    dirs.set(s.name, dir)
  }
  return {
    dirs,
    dispose: () => {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        /* cleaned with <data>/tmp at the next start */
      }
    }
  }
}

