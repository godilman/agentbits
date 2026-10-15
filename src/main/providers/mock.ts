import type { Agent, ProviderTestResult } from '@shared/types'
import { demoKind, type DemoKind } from '@shared/demoKind'
import { agentsRepo } from '../db/repos'
import { t } from '../i18n'
import { sleep, type ProviderAdapter, type RunContext, type RunResult } from './types'

/**
 * Demo provider. Simulates realistic agent behaviour (tool calls, progress,
 * planning, reviews) without any API key, so the office, kanban and chat are
 * fully alive on first launch.
 */

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// Keywords in the user's message (Turkish + English).
const ROLE_KEYWORDS: [RegExp, RegExp][] = [
  [/front|arayüz|ui|ux|ekran|tasarım|css|react|sayfa|buton|form|interface|screen|design|page|button/i, /front/i], // i18n-ignore
  [/back|api|veritaban|database|db|sql|sunucu|server|endpoint|kimlik|auth/i, /back/i],
  [/test|qa|hata|bug|doğrula|kontrol|error|verify|check/i, /qa|test/i], // i18n-ignore
  [/build|deploy|ci|paket|package|sürüm|version|release|docker|devops/i, /devops|ops/i] // i18n-ignore
]

/* ── profile matching: skills + job description words ── */

// Frequent Turkish/English words that say nothing about expertise.
const STOPWORDS = new Set(
  've ile için gibi olarak olan daha kadar sonra önce gerekiyorsa sorumludur sorumlu yapar eder kısa notu teslimat çalışan ' + // i18n-ignore
    'temiz sağlar kurar tutar yazar yapılan the and for with from that this into ' + // i18n-ignore
    'responsible deliverable short note working clean ensures their them when'
    .split(' ')
    .map((w) => norm(w))
)

function norm(text: string): string {
  return text.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i') // dotless i
}

function tokens(text: string): string[] {
  return norm(text)
    .split(/[^\p{L}\p{N}#+]+/u)
    .filter(Boolean)
}

/** Crude stem that survives Turkish suffixes: "veritabanına" ~ "veritabanı". */
const stem = (w: string): string => w.slice(0, 5)

/** True if a (normalised) skill token appears in the text tokens. Short tokens (UI, API, QA) must match exactly. */
function tokenHit(skillTok: string, textToks: string[]): boolean {
  if (skillTok.length < 4) return textToks.includes(skillTok)
  const prefix = skillTok.slice(0, Math.max(4, skillTok.length - 2))
  return textToks.some((w) => w === skillTok || w.startsWith(prefix))
}

/** Scores each worker against the task text; returns every worker with the best score above the threshold. */
function profileMatch(text: string, workers: Agent[]): Agent[] {
  const textToks = tokens(text)
  const textStems = new Set(textToks.filter((w) => w.length >= 5 && !STOPWORDS.has(w)).map(stem))
  // Job-description stems shared by several workers are not discriminative.
  const jdStems = workers.map(
    (w) => new Set(tokens(w.jobDescription).filter((x) => x.length >= 5 && !STOPWORDS.has(x)).map(stem))
  )
  const df = new Map<string, number>()
  jdStems.forEach((set) => set.forEach((st) => df.set(st, (df.get(st) ?? 0) + 1)))
  const maxDf = Math.max(1, Math.floor(workers.length / 2))

  let best: Agent[] = []
  let bestScore = 0
  workers.forEach((w, i) => {
    let score = 0
    for (const skill of w.skills) {
      const st = tokens(skill)
      if (st.length && st.every((t) => tokenHit(t, textToks))) score += 3
    }
    let jd = 0
    jdStems[i].forEach((st) => {
      if (textStems.has(st) && (df.get(st) ?? 0) <= maxDf) jd++
    })
    score += Math.min(jd, 4)
    if (score > bestScore) {
      best = [w]
      bestScore = score
    } else if (score === bestScore && score > 0) best.push(w)
  })
  return bestScore >= 2 ? best : []
}

/** Among equally good candidates (e.g. duplicated developers), the one given the fewest tasks in this plan. */
function leastLoaded(candidates: Agent[], load: Map<string, number>): Agent | undefined {
  return [...candidates].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0]
}

function assigneeFor(text: string, fallbackIdx: number, team: Agent[] | undefined, leadId: string, load: Map<string, number>): string | undefined {
  const pool = team ?? agentsRepo.list()
  const workers = pool.filter((a) => !a.isLead && a.enabled && a.id !== leadId)
  const pick = (a: Agent | undefined): string | undefined => {
    if (a) load.set(a.id, (load.get(a.id) ?? 0) + 1)
    return a?.name
  }
  const byProfile = profileMatch(text, workers)
  if (byProfile.length) return pick(leastLoaded(byProfile, load))
  for (const [kw, role] of ROLE_KEYWORDS) {
    if (kw.test(text)) {
      const matching = workers.filter((w) => role.test(w.role))
      if (matching.length) return pick(leastLoaded(matching, load))
    }
  }
  return workers.length ? pick(workers[fallbackIdx % workers.length]) : undefined
}

function extractUserMessage(prompt: string): string {
  const m = prompt.match(/## User message\n([\s\S]*?)(\n## |$)/)
  return (m ? m[1] : prompt).trim()
}

async function stream(ctx: RunContext, text: string): Promise<void> {
  const words = text.split(/(\s+)/)
  for (let i = 0; i < words.length; i += 6) {
    await ctx.checkpoint()
    ctx.onText(words.slice(i, i + 6).join(''))
    await sleep(rand(25, 70), ctx.signal)
  }
}

function chatReply(ctx: RunContext): string {
  const filesPart = /## Files attached to this message\n([\s\S]*?)(\n### |$)/.exec(ctx.prompt)?.[1] ?? ''
  const fileCount = (filesPart.match(/^- \[[0-9a-f]{8}\]/gm) ?? []).length
  const reply = chatReplyText(ctx)
  return fileCount ? `${t('demo:chat.filesReceived', { count: fileCount })}\n\n${reply}` : reply
}

function chatReplyText(ctx: RunContext): string {
  const msg = extractUserMessage(ctx.prompt)
  // As the lead: a message naming one of the project's tasks is passed on to that task (```message block).
  const keys = ctx.system.includes('## Open tasks')
    ? [...new Set((msg.match(/\b[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}\b/g) ?? []).map((k) => k.toUpperCase()))].filter((k) => ctx.system.includes(`- ${k} [`))
    : []
  if (keys.length) {
    const notes = keys.map((task) => ({ task, text: msg.slice(0, 1000) }))
    return `${t('demo:chat.noteSent', { count: keys.length, keys: keys.join(', ') })}\n\n\`\`\`message\n${JSON.stringify(notes, null, 2)}\n\`\`\``
  }
  const words = msg.split(/\s+/).filter(Boolean)
  const isQuestion = /\?\s*$/.test(msg) || words.length < 4
  if (isQuestion) {
    return pick([t('demo:chat.idle.r1'), t('demo:chat.idle.r2'), t('demo:chat.idle.r3')])
  }
  const parts = msg
    .split(/(?:[.;\n]|,\s*(?:ve|ayrıca|sonra|and|also|then)\s+|\s+ve\s+ayrıca\s+|\s+and\s+also\s+)/i) // i18n-ignore
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3)
    .slice(0, 4)
  const load = new Map<string, number>()
  // "first …, then …": each step waits for the previous one (otherwise the parts run in parallel).
  const sequential = /\b(sonra|ardından|daha sonra|then|after that|afterwards)\b/i.test(msg) // i18n-ignore
  const items = (parts.length ? parts : [msg]).map((p, i) => ({
    title: p.charAt(0).toUpperCase() + p.slice(1, 90),
    description: t('demo:chat.taskDescription', { request: msg.slice(0, 280), scope: p }),
    assignee: assigneeFor(p, i, ctx.team, ctx.agent.id, load),
    after: sequential && i > 0 ? [i] : undefined,
    priority: i === 0 ? 2 : 1
  }))
  const lines = items.map((it) => `- **${it.title}** → ${it.assignee ?? t('demo:chat.unassigned')}`).join('\n')
  return (
    `${t('demo:chat.plan', { count: items.length })}\n\n${lines}\n\n` +
    `${t('demo:chat.planFooter')}\n\n` +
    '```tasks\n' +
    JSON.stringify(items, null, 2) +
    '\n```'
  )
}

/** What a simulated run of each kind of work touches. `final` is the closing tool call (code runs the tests). */
const KIND_PLAN: Record<DemoKind, { files: string[]; verbs: string[]; final?: string }> = {
  code: {
    files: ['src/components/LoginForm.tsx', 'src/api/tasks.ts', 'src/db/queries.ts', 'src/hooks/useValidation.ts', 'tests/e2e/kanban.spec.ts', 'src/styles/theme.css', 'README.md'],
    verbs: ['Read', 'Grep', 'Edit', 'Edit', 'Write'],
    final: 'Bash npm test -- --run'
  },
  research: {
    files: ['research/sources.md', 'research/notes.md', 'research/comparison.md', 'research/summary.md'],
    verbs: ['WebSearch', 'WebSearch', 'Read', 'Write', 'Edit']
  },
  content: {
    files: ['content/brief.md', 'content/draft.md', 'content/headlines.md', 'content/final.md'],
    verbs: ['Read', 'Write', 'Edit', 'Edit']
  },
  data: {
    files: ['data/input.csv', 'analysis/metrics.md', 'analysis/summary-table.md', 'analysis/report.md'],
    verbs: ['Read', 'Read', 'Write', 'Edit']
  }
}

// Keywords in the task text (Turkish + English).
const NEEDS_DATA = /veritaban|database|\bdb\b|sql|sorgu|query|tablo|table|stok|stock|inventory|sipari|order|müşteri|musteri|customer|rapor|report|sunucu|server|ssh|disk|log|servis|service/i // i18n-ignore
const WANTS_CHANGE = /güncelle|guncelle|update|değiştir|degistir|change|modify|sil\b|delete|remove|ekle|\badd\b|insert/i // i18n-ignore

/**
 * Demo provider + real connection tools: the decisions are scripted, but the calls
 * are real — they go through permissions, approvals and the audit log like any agent.
 */
async function useConnections(ctx: RunContext, text: string): Promise<string[]> {
  if (!ctx.callTool || !ctx.tools?.some((t) => t.name === 'connections_list') || !NEEDS_DATA.test(text)) return []
  const notes: string[] = []
  const listed = await ctx.callTool('connections_list', {})
  let conns: { name: string; type: string; access: string }[] = []
  try {
    conns = JSON.parse(listed.text)
  } catch {
    return [t('demo:connections.none')]
  }
  for (const c of conns.slice(0, 2)) {
    await ctx.checkpoint()
    await sleep(600, ctx.signal)
    if (c.type === 'ssh') {
      for (const cmd of ['uptime', 'df -h']) {
        const r = await ctx.callTool('ssh_exec', { connection: c.name, command: cmd })
        notes.push(`${c.name} $ ${cmd} → ${r.isError ? t('demo:connections.error') : t('demo:connections.ok')}`)
      }
      continue
    }
    const schema = await ctx.callTool('db_schema', { connection: c.name })
    const first = /^([^\s:]+):\s*([^\s,]+)/m.exec(schema.text)
    if (schema.isError || !first) {
      notes.push(t('demo:connections.schemaFailed', { name: c.name }))
      continue
    }
    const [, table, col] = first
    const q = await ctx.callTool('db_query', { connection: c.name, sql: `SELECT * FROM ${table} LIMIT 5` })
    notes.push(t(q.isError ? 'demo:connections.sampleReadError' : 'demo:connections.sampleRead', { name: c.name, table }))
    if (WANTS_CHANGE.test(text)) {
      // A harmless change (0 rows) that still needs write access — shows the permission / approval path.
      const u = await ctx.callTool('db_query', { connection: c.name, sql: `UPDATE ${table} SET ${col} = ${col} WHERE 1 = 0` })
      notes.push(t('demo:connections.changeAttempt', { name: c.name, result: u.isError ? u.text.slice(0, 160) : t('demo:connections.allowed') }))
    }
  }
  return notes
}

/**
 * Demo + real skills: picks the assigned skill whose name / description shares the most words with the task and
 * reads it with skill_read (transcript line, same access rules as a real agent).
 */
async function useSkills(ctx: RunContext, text: string): Promise<string[]> {
  if (!ctx.callTool || !ctx.tools?.some((x) => x.name === 'skill_read')) return []
  const listed = [...ctx.system.matchAll(/^- \*\*([a-z0-9-]+)\*\*: (.*)$/gm)].map((m) => ({ name: m[1], desc: m[2] }))
  if (!listed.length) return []
  const words = new Set(norm(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))
  const score = (s: { name: string; desc: string }): number =>
    norm(`${s.name.replace(/-/g, ' ')} ${s.desc}`)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && words.has(w)).length
  const best = listed.map((s) => ({ s, n: score(s) })).sort((a, b) => b.n - a.n)[0]
  if (!best || best.n === 0) return []
  await ctx.checkpoint()
  await sleep(400, ctx.signal)
  const r = await ctx.callTool('skill_read', { name: best.s.name })
  return [t(r.isError ? 'demo:skills.failed' : 'demo:skills.used', { name: best.s.name })]
}

/**
 * Demo + real apps (MCP): when the task names a connected app, calls one of its tools that runs without approval and
 * whose required arguments are simple (strings get the task title); if the task asks for a change, also tries one
 * tool that needs the user's approval — the request shows up in the approval dock like any agent's.
 */
async function useApps(ctx: RunContext, text: string, title: string): Promise<string[]> {
  if (!ctx.callTool || !ctx.tools?.some((x) => x.name.startsWith('app_'))) return []
  const lower = text.toLocaleLowerCase()
  const tools = ctx.tools
    .filter((x) => x.name.startsWith('app_'))
    .map((x) => ({ spec: x, app: /^\[App: ([^·\]]+?)(?: · |\])/.exec(x.description)?.[1]?.trim() ?? '', approve: x.description.includes('needs the user’s approval') }))
    .filter((x) => x.app && lower.includes(x.app.toLocaleLowerCase()))
  const argsFor = (schema: Record<string, unknown>): Record<string, unknown> | null => {
    const props = (schema.properties ?? {}) as Record<string, { type?: string }>
    const out: Record<string, unknown> = {}
    for (const k of (schema.required as string[] | undefined) ?? []) {
      const ty = props[k]?.type
      if (ty === 'string') out[k] = title
      else if (ty === 'number' || ty === 'integer') out[k] = 1
      else if (ty === 'boolean') out[k] = false
      else return null
    }
    return out
  }
  const notes: string[] = []
  const pickTool = (approve: boolean) => tools.find((x) => x.approve === approve && argsFor(x.spec.inputSchema))
  const chosen = [pickTool(false), WANTS_CHANGE.test(text) ? pickTool(true) : undefined].filter((x): x is NonNullable<typeof x> => !!x)
  for (const c of chosen) {
    await ctx.checkpoint()
    await sleep(500, ctx.signal)
    const r = await ctx.callTool(c.spec.name, argsFor(c.spec.inputSchema)!)
    const tool = c.spec.name.split('__').pop() ?? c.spec.name
    notes.push(t(r.isError ? 'demo:apps.failed' : 'demo:apps.used', { app: c.app, tool, error: r.text.slice(0, 160) }))
  }
  return notes
}

/**
 * Demo + real file tools: reads the task's attachments part by part (the same
 * permission checks and transcript lines as a real agent) and saves a summary
 * with file_save, so the whole attachment flow can be tried without a model.
 */
async function useFiles(ctx: RunContext, taskKey: string): Promise<string[]> {
  if (!ctx.callTool || !ctx.tools?.some((t) => t.name === 'files_list')) return []
  const listed = await ctx.callTool('files_list', {})
  let rows: { ref: string; name: string; type: string; image?: string; parts: number; status: string; note?: string; instructionLikeLines?: number; forThisTask?: boolean }[] = []
  try {
    rows = JSON.parse(listed.text)
  } catch {
    return []
  }
  const mine = rows.filter((r) => r.forThisTask)
  const notes: string[] = []
  for (const r of (mine.length ? mine : rows).slice(0, 4)) {
    await ctx.checkpoint()
    await sleep(500, ctx.signal)
    // `image` (dimensions) is set only for images; `type` is a display label that depends on the language.
    if (r.image !== undefined) {
      const img = await ctx.callTool('file_read', { file: r.ref })
      notes.push(t(img.isError ? 'demo:files.imageFailed' : 'demo:files.imageRead', { name: r.name }))
      continue
    }
    if (!r.parts) {
      notes.push(`${t('demo:files.noText', { name: r.name })}${r.note ? ` (${r.note})` : ''}`)
      continue
    }
    const read = await ctx.callTool('file_read', { file: r.ref, part: 1 })
    const body = read.text.replace(/^<<<FILE[^\n]*\n/, '').replace(/\n<<<END FILE[\s\S]*$/, '')
    const gist = body
      .split('\n')
      .map((l) => l.replace(/^\[[^\]]+\]$/, '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' / ')
      .slice(0, 220)
    notes.push(t('demo:files.partsSummary', { name: r.name, type: r.type, count: r.parts, gist: read.isError ? read.text.slice(0, 160) : gist }))
    if (r.parts > 2) {
      await ctx.callTool('file_read', { file: r.ref, part: r.parts })
      notes.push(`  - ${t('demo:files.firstAndLast', { parts: r.parts })}`)
    }
    if (r.instructionLikeLines) notes.push(`  - ${t('demo:files.instructionLike', { name: r.name, count: r.instructionLikeLines })}`)
  }
  if (notes.length && ctx.tools.some((t) => t.name === 'file_save')) {
    const saved = await ctx.callTool('file_save', {
      name: t('demo:files.summaryFileName', { key: taskKey.toLowerCase() || t('demo:files.summaryFileFallback') }),
      content: `# ${t('demo:files.summaryTitle', { key: taskKey })}\n\n${notes.map((n) => (n.startsWith('  ') ? n : `- ${n}`)).join('\n')}\n`
    })
    notes.push(saved.isError ? t('demo:files.summaryFailed', { error: saved.text }) : t('demo:files.summarySaved'))
  }
  return notes
}

async function taskWork(ctx: RunContext): Promise<string> {
  // A continuation after a direct user instruction: the original task prompt is in history.
  const original = ctx.history?.find((h) => h.role === 'user')?.content ?? ctx.prompt
  // Only the user's words (the prompt also carries the English wrapper around them).
  const instruction = ctx.history?.length
    ? ctx.prompt.replace(/^## [^\n]*\n/, '').split('\n\nTake this into account')[0].trim()
    : null
  const title = (original.match(/## Task\s+\S+: (.*)/)?.[1] ?? t('demo:task.defaultTitle')).trim()
  // Only the task itself (not its thread) and the agent's profile decide what kind of work this looks like.
  const kind = demoKind(original.split('\n## Task thread')[0], `${ctx.agent.role} ${ctx.agent.skills.join(' ')}`)
  const plan = KIND_PLAN[kind]
  const steps = instruction ? Math.round(rand(3, 5)) : Math.round(rand(6, 9))
  const touched: string[] = []
  // Simulated usage (clearly marked as estimated in the UI): the context is re-read on every step, mostly from cache.
  const ctxTokens = Math.round((ctx.system.length + original.length) / 4)
  ctx.onUsage?.({ input: ctxTokens, output: 0, cacheRead: 0, cacheWrite: Math.round(ctxTokens * 0.8), costUsd: 0 })
  if (instruction) ctx.onLog('info', t('demo:task.logInstruction', { text: instruction.slice(0, 160) }))
  else ctx.onLog('info', t('demo:task.logAnalyzing', { title }))
  const connectionNotes = await useConnections(ctx, `${original}\n${instruction ?? ''}`)
  const fileNotes = instruction ? [] : await useFiles(ctx, original.match(/## Task\s+(\S+):/)?.[1] ?? '')
  const skillNotes = instruction ? [] : await useSkills(ctx, original)
  const appNotes = instruction ? [] : await useApps(ctx, original, title)
  for (let i = 0; i < steps; i++) {
    await ctx.checkpoint()
    await sleep(rand(1400, 3200), ctx.signal)
    ctx.onUsage?.({ input: Math.round(rand(40, 260)), output: Math.round(rand(60, 340)), cacheRead: ctxTokens, cacheWrite: 0, costUsd: 0 })
    const file = pick(plan.files)
    const last = i === steps - 1
    const action = last ? 'final' : i < 2 ? plan.verbs[0] : pick(plan.verbs)
    if (action === 'final') {
      if (plan.final) ctx.onLog('tool', plan.final)
      await sleep(900, ctx.signal)
      ctx.onLog('output', t(`demo:kinds.${kind}.final`, { count: Math.round(rand(8, 40)) }))
    } else {
      const target = action === 'Grep' ? '"TODO|FIXME"' : action === 'WebSearch' ? JSON.stringify(title.slice(0, 60)) : file
      ctx.onLog('tool', `${action} ${target}`)
      if (action === 'Edit' || action === 'Write') {
        touched.push(file)
        ctx.onFileWritten?.(file)
      }
    }
    ctx.onProgress(Math.round(((i + 1) / steps) * 92))
  }
  const files = [...new Set(touched)]
  const summary =
    `## ${t('demo:report.summary')}\n${t('demo:report.completed', { title })}\n\n` +
    (connectionNotes.length ? `## ${t('demo:report.connections')}\n${connectionNotes.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
    (appNotes.length ? `## ${t('demo:report.apps')}\n${appNotes.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
    (skillNotes.length ? `## ${t('demo:report.skills')}\n${skillNotes.map((n) => `- ${n}`).join('\n')}\n\n` : '') +
    (fileNotes.length ? `## ${t('demo:report.files')}\n${fileNotes.map((n) => (n.startsWith('  ') ? n : `- ${n}`)).join('\n')}\n\n` : '') +
    (instruction
      ? `## ${t('demo:report.instruction')}\n> ${instruction.slice(0, 400)}\n\n${t('demo:report.instructionApplied')}\n\n`
      : '') +
    `## ${t('demo:report.done')}\n${(['done1', 'done2', 'done3'] as const).map((n) => `- ${t(`demo:kinds.${kind}.${n}`)}`).join('\n')}\n\n` +
    `## ${t(kind === 'code' ? 'demo:report.changedFiles' : 'demo:report.deliverables')}\n${files.length ? files.map((f) => `- \`${f}\``).join('\n') : `- ${t('demo:report.reviewOnly')}`}\n\n` +
    `## ${t('demo:report.notes')}\n- ${t('demo:report.demoNote')}`
  await stream(ctx, summary)
  return summary
}

/** Demo "custom report": a Markdown summary built from the report data the lead was given. */
function demoReport(ctx: RunContext): string {
  const request = ctx.prompt.replace(/^## Report request\n/, '').trim()
  const section = (name: string): string[] => {
    const m = new RegExp(`### ${name}\\n([\\s\\S]*?)(?=\\n### |$)`).exec(ctx.system)
    return (m?.[1] ?? '').split('\n').filter((l) => l.startsWith('- '))
  }
  const board = /Board: ([^\n]*)/.exec(ctx.system)?.[1] ?? ''
  const open = section('Open tasks')
  const done = section('Recently done')
  const decisions = section('Decisions')
  return [
    `# ${request.slice(0, 80)}`,
    '',
    `## ${t('demo:customReport.summary')}`,
    board ? `- ${board}` : `- ${t('demo:customReport.noData')}`,
    '',
    `## ${t('demo:customReport.open', { count: open.length })}`,
    ...(open.length ? open.slice(0, 10) : [`- ${t('demo:customReport.none')}`]),
    '',
    `## ${t('demo:customReport.done', { count: done.length })}`,
    ...(done.length ? done.slice(0, 10) : [`- ${t('demo:customReport.none')}`]),
    '',
    `## ${t('demo:customReport.decisions', { count: decisions.length })}`,
    ...(decisions.length ? decisions.slice(0, 8) : [`- ${t('demo:customReport.none')}`]),
    '',
    `> ${t('demo:report.demoNote')}`
  ].join('\n')
}

export const mockAdapter: ProviderAdapter = {
  async run(ctx: RunContext): Promise<RunResult> {
    let text: string
    if (ctx.mode === 'chat' && ctx.system.includes('## Report data')) {
      await sleep(rand(900, 1800), ctx.signal)
      text = demoReport(ctx)
      await stream(ctx, text)
    } else if (ctx.mode === 'chat') {
      await sleep(rand(700, 1600), ctx.signal)
      text = chatReply(ctx)
      await stream(ctx, text)
    } else if (ctx.mode === 'review' && ctx.prompt.includes('\n## Attempt A by ')) {
      await sleep(rand(1500, 3000), ctx.signal)
      text = JSON.stringify({ winner: Math.random() < 0.5 ? 'A' : 'B', note: t('demo:review.race') })
    } else if (ctx.mode === 'review') {
      await sleep(rand(1500, 3000), ctx.signal)
      const approved = Math.random() < 0.85
      const kind = demoKind(ctx.prompt.split('\n## Work report by')[0])
      text = JSON.stringify({
        approved,
        note: approved
          ? pick([t('demo:review.approved.r1'), t('demo:review.approved.r2'), t('demo:review.approved.r3')])
          : pick([t(`demo:kinds.${kind}.rejected1`), t(`demo:kinds.${kind}.rejected2`)])
      })
    } else {
      text = await taskWork(ctx)
    }
    const tokensIn = Math.round((ctx.system.length + ctx.prompt.length) / 4)
    const tokensOut = Math.round(text.length / 4)
    if (ctx.mode === 'task') ctx.onUsage?.({ input: 0, output: tokensOut, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
    else ctx.onUsage?.({ input: tokensIn, output: tokensOut, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
    return { text, tokensIn, tokensOut, costUsd: 0 }
  },
  async test(): Promise<ProviderTestResult> {
    return { ok: true, message: t('demo:test.ready') }
  }
}
