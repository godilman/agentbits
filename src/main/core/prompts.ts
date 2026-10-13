import type { Agent, AgentPermissions, Message, Task } from '@shared/types'
import { describePermissions } from './permissions'

const PRIORITY = ['low', 'normal', 'high', 'urgent']

/** Collapses whitespace and cuts text to `max` chars on a word boundary. */
function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '')}…`
}

export function workerSystem(agent: Agent, perms: AgentPermissions, memory: string, workspace: string): string {
  return [
    `You are ${agent.name}, the ${agent.role} on a multi-agent team (Agentbits). Teams may do any kind of work: software, research, data analysis, documents, content, planning and more.`,
    agent.persona ? `Persona: ${agent.persona}` : '',
    agent.jobDescription.trim() ? `## Job description\n${agent.jobDescription.trim()}` : '',
    agent.skills.length ? `## Skills\n${agent.skills.join(', ')}` : '',
    `Workspace root: ${workspace || '(not set)'}`,
    '## Permissions (hard limits — never try to work around them)',
    describePermissions(perms),
    memory,
    '## How to answer',
    'Do the task. When finished, reply in the language of the task with a short markdown report using the',
    'sections "## Summary", "## What was done", "## Changed files", "## Notes" (headings in that language). Be concrete.',
    'If you take an important technical decision, add a fenced block:',
    '```decision\n{"title": "...", "context": "...", "decision": "...", "rationale": "..."}\n```'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function workerPrompt(task: Task, thread: Message[], names: Record<string, string>): string {
  const comments = thread
    .slice(-10)
    .map((m) => `- ${m.senderType === 'user' ? 'User' : names[m.senderId ?? ''] ?? 'System'}: ${m.content}`)
    .join('\n')
  return [
    '## Task',
    `${task.key}: ${task.title}`,
    `Priority: ${PRIORITY[task.priority]}`,
    task.description ? `## Description\n${task.description}` : '',
    task.reviewNote ? `## Feedback from the previous review (address this!)\n${task.reviewNote}` : '',
    comments ? `## Task thread\n${comments}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function leadSystem(lead: Agent, team: Agent[], board: Task[], memory: string, skillPacks?: (agentId: string) => string[]): string {
  const roster = team
    .filter((a) => !a.isLead && a.enabled)
    .map((a) => {
      const lines = [`- ${a.name} — ${a.role || 'Team member'} (status: ${a.status})`]
      if (a.skills.length) lines.push(`  Skills: ${a.skills.join(', ')}`)
      const packs = skillPacks?.(a.id) ?? []
      if (packs.length) lines.push(`  Installed skill packs: ${packs.join(', ')}`)
      if (a.jobDescription.trim()) lines.push(`  Job: ${truncate(a.jobDescription, 160)}`)
      return lines.join('\n')
    })
    .join('\n')
  const open = board
    .filter((t) => t.status !== 'done')
    .slice(0, 30)
    .map((t) => `- ${t.key} [${t.status}] ${t.title}${t.assigneeId ? ` → ${team.find((a) => a.id === t.assigneeId)?.name ?? '?'}` : ''}`)
    .join('\n')
  return [
    `You are ${lead.name}, the ${lead.role} and coordinator of the Agentbits team.`,
    lead.persona ? `Persona: ${lead.persona}` : '',
    lead.jobDescription.trim() ? `## Your job description\n${lead.jobDescription.trim()}` : '',
    `## Team\n${roster || '(no agents)'}`,
    `## Open tasks\n${open || '(none)'}`,
    memory,
    '## Rules',
    '- Reply to the user conversationally, in the user\'s language, concisely.',
    '- When the user asks for work to be done, split it into small, independently doable tasks and',
    '  assign each to the team member whose role, skills and job description fit it best.',
    '  Emit them in ONE fenced block exactly like:',
    '```tasks\n[{"title": "...", "description": "...", "assignee": "<team member name>", "priority": 1}]\n```',
    '  priority: 0 low, 1 normal, 2 high, 3 urgent.',
    '  Files: the files attached to the user\'s message go to every task you create. To give a task only',
    '  specific files, add "files": ["<file ref>", ...] to it ("files": [] for none). Assignees can only read the files given.',
    '- When the user (or you) settles an important decision, record it with:',
    '```decision\n{"title": "...", "context": "...", "decision": "...", "rationale": "..."}\n```',
    '- Never invent work that was not asked for.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function leadPrompt(history: Message[], names: Record<string, string>, userMessage: string): string {
  const h = history
    .slice(-12)
    .map((m) => `${m.senderType === 'user' ? 'User' : names[m.senderId ?? ''] ?? 'System'}: ${m.content}`)
    .join('\n')
  return `## Conversation so far\n${h || '(empty)'}\n\n## User message\n${userMessage}`
}

export function reviewSystem(lead: Agent): string {
  return [
    `You are ${lead.name}, reviewing a teammate's work as ${lead.role}.`,
    'Decide whether the work satisfies the task. Respond with ONLY a JSON object:',
    '{"approved": true|false, "note": "one or two sentences of feedback in the task\'s language"}'
  ].join('\n')
}

export function reviewPrompt(task: Task, agent: Agent, output: string): string {
  return `## Task\n${task.key}: ${task.title}\n${task.description}\n\n## Work report by ${agent.name}\n${output.slice(0, 12000)}`
}

/* ───────────────────────── output parsing ───────────────────────── */

export interface PlannedTask {
  title: string
  description?: string
  assignee?: string
  priority?: number
  /** File refs / names handed to the task (default: the files of the user's message). */
  files?: string[]
}
export interface PlannedDecision {
  title: string
  context?: string
  decision?: string
  rationale?: string
}

function blocks(text: string, tag: string): string[] {
  const re = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

export function parseTasks(text: string): PlannedTask[] {
  const out: PlannedTask[] = []
  for (const b of blocks(text, 'tasks')) {
    try {
      const v = JSON.parse(b)
      for (const t of Array.isArray(v) ? v : [v]) if (t?.title) out.push(t)
    } catch {
      /* ignore malformed block */
    }
  }
  return out
}

export function parseDecisions(text: string): PlannedDecision[] {
  const out: PlannedDecision[] = []
  for (const b of blocks(text, 'decision')) {
    try {
      const v = JSON.parse(b)
      for (const d of Array.isArray(v) ? v : [v]) if (d?.title) out.push(d)
    } catch {
      /* ignore */
    }
  }
  return out
}

/** Removes machine blocks so chat bubbles stay readable. */
export function stripBlocks(text: string): string {
  return text.replace(/```(tasks|decision)\s*\n[\s\S]*?```/g, '').trim()
}

export { parseReview } from '@shared/review'
