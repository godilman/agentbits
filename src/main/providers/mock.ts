import type { Agent, ProviderTestResult } from '@shared/types'
import { demoIsWork, demoKind, demoParts, type DemoKind } from '@shared/demoKind'
import { agentsRepo } from '../db/repos'
import { t } from '../i18n'
import { sleep, type ProviderAdapter, type RunContext, type RunResult } from './types'

/**
 * Demo provider. Simulates agent behaviour (progress, planning, reviews) without any API key, so the office, kanban
 * and chat are alive on first launch. A simulation only: it never calls a tool (no connection, SSH, app, file or
 * skill call — `ctx.callTool` is not used), and everything it reports says so.
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
  const reply = chatReplyText(ctx) + learnedFrom(ctx)
  return fileCount ? `${t('demo:chat.filesReceived', { count: fileCount })}\n\n${reply}` : reply
}

/** Graph memory: a sentence like "from now on …" / "bundan sonra …" is something lasting about the user (```learn block). */
function learnedFrom(ctx: RunContext): string {
  if (!ctx.system.includes('## Learning about the user')) return ''
  const cue = /\b(always|from now on|i prefer|bundan sonra|her zaman|her seferinde|tercih ederim)\b/i // i18n-ignore
  const sentence = extractUserMessage(ctx.prompt)
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .find((s) => cue.test(s))
  if (!sentence) return ''
  const item = { text: sentence.charAt(0).toUpperCase() + sentence.slice(1, 300), kind: 'preference', topics: [t('demo:chat.learnTopic')] }
  return `\n\n${t('demo:chat.learned')}\n\n\`\`\`learn\n${JSON.stringify([item], null, 2)}\n\`\`\``
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
  if (!demoIsWork(msg)) {
    return pick([t('demo:chat.idle.r1'), t('demo:chat.idle.r2'), t('demo:chat.idle.r3')])
  }
  const parts = demoParts(msg)
  const load = new Map<string, number>()
  // "first …, then …": each step waits for the previous one (otherwise the parts run in parallel).
  const sequential = /\b(sonra|ardından|daha sonra|then|after that|afterwards)\b/i.test(msg) // i18n-ignore
  const items = (parts.length ? parts : [msg]).map((p, i) => ({
    // A file name or URL first ("math.js …") keeps its case.
    title: (/^\S*[./]/.test(p) ? p.charAt(0) : p.charAt(0).toUpperCase()) + p.slice(1, 90),
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
  for (let i = 0; i < steps; i++) {
    await ctx.checkpoint()
    await sleep(rand(1400, 3200), ctx.signal)
    ctx.onUsage?.({ input: Math.round(rand(40, 260)), output: Math.round(rand(60, 340)), cacheRead: ctxTokens, cacheWrite: 0, costUsd: 0 })
    const file = pick(plan.files)
    const last = i === steps - 1
    const action = last ? 'final' : i < 2 ? plan.verbs[0] : pick(plan.verbs)
    if (action === 'final') {
      if (plan.final) ctx.onLog('tool', t('demo:task.simulatedStep', { step: plan.final }))
      await sleep(900, ctx.signal)
      ctx.onLog('output', t(`demo:kinds.${kind}.final`))
    } else {
      // Example names only: nothing is read, written or searched (and no file is reported as written).
      const target = action === 'Grep' ? '"TODO|FIXME"' : action === 'WebSearch' ? JSON.stringify(title.slice(0, 60)) : file
      ctx.onLog('tool', t('demo:task.simulatedStep', { step: `${action} ${target}` }))
      if (action === 'Edit' || action === 'Write') touched.push(file)
    }
    ctx.onProgress(Math.round(((i + 1) / steps) * 92))
  }
  const files = [...new Set(touched)]
  const summary =
    `> ${t('demo:report.simulated')}\n\n` +
    `## ${t('demo:report.summary')}\n${t('demo:report.completed', { title })}\n\n` +
    (instruction
      ? `## ${t('demo:report.instruction')}\n> ${instruction.slice(0, 400)}\n\n${t('demo:report.instructionApplied')}\n\n`
      : '') +
    `## ${t('demo:report.done')}\n${(['done1', 'done2', 'done3'] as const).map((n) => `- ${t(`demo:kinds.${kind}.${n}`)}`).join('\n')}\n\n` +
    `## ${t('demo:report.exampleFiles')}\n${files.length ? files.map((f) => `- \`${f}\``).join('\n') : `- ${t('demo:report.reviewOnly')}`}\n\n` +
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
      // Acceptance criteria: the winner meets every one, the other attempt misses the first.
      const n = Number(/have exactly (\d+) entries each/.exec(ctx.system)?.[1] ?? 0)
      const winner = Math.random() < 0.5 ? 'A' : 'B'
      const check = (won: boolean): { met: boolean; note: string }[] => Array.from({ length: n }, (_, i) => ({ met: won || i > 0, note: '' }))
      text = JSON.stringify({ winner, note: `${t('demo:review.simulated')} ${t('demo:review.race')}`, ...(n ? { criteriaA: check(winner === 'A'), criteriaB: check(winner === 'B') } : {}) })
    } else if (ctx.mode === 'review') {
      await sleep(rand(1500, 3000), ctx.signal)
      const approved = Math.random() < 0.85
      const kind = demoKind(ctx.prompt.split('\n## Work report by')[0])
      // Acceptance criteria: one check per criterion (all met when approved, the first one missed otherwise).
      const n = Number(/"criteria" has exactly (\d+) entries/.exec(ctx.system)?.[1] ?? 0)
      text = JSON.stringify({
        approved,
        ...(n ? { criteria: Array.from({ length: n }, (_, i) => ({ met: approved || i > 0, note: '' })) } : {}),
        // Never reads like a real check: nothing was run or verified.
        note: `${t('demo:review.simulated')} ${
          approved
            ? pick([t('demo:review.approved.r1'), t('demo:review.approved.r2'), t('demo:review.approved.r3')])
            : pick([t(`demo:kinds.${kind}.rejected1`), t(`demo:kinds.${kind}.rejected2`)])
        }`
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
