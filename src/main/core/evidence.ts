import type { RunEvidence } from '@shared/types'
import { getDb } from '../db'
import { runsRepo } from '../db/repos'
import { auditRepo } from '../connections/repo'

/**
 * What a run really did, read from its tool record (agent_logs) and the connection audit — not from the worker's
 * report. Only Claude Code records each tool call with its result; for other providers commands and files are unknown
 * (said so, not guessed). The Demo provider is a simulation: nothing. A tool call is not its effect: a write counts as
 * written only when its result says so, and a missing or shortened record never turns into "did not happen".
 * Tests: `tests/e2e/result.e2e.ts`.
 */
const WRITE_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit) (.+)$/
const LATEST = 30
const MAX_FAILED = 20
const MAX_ITEMS = 40

/** How much of the worker's report the lead's review reads (`reviewPrompt`). */
export const REVIEW_REPORT_CHARS = 12_000

export function providerOfRun(runId: string): string | null {
  const r = getDb().prepare("SELECT provider FROM token_usage WHERE run_id = ? AND mode = 'task' ORDER BY id DESC LIMIT 1").get(runId) as
    | { provider: string }
    | undefined
  return r?.provider ?? null
}

type Row = { level: string; message: string; meta: string | null }

export function runEvidence(runId: string): RunEvidence | null {
  const run = runsRepo.get(runId)
  if (!run) return null
  const provider = providerOfRun(runId)
  const simulated = provider === 'mock'
  const toolRecord = provider === 'claude-cli'
  // Every tool call, result and refusal of the run (not a newest-N window: an early failure must not drop out).
  const rows = simulated
    ? []
    : (getDb()
        .prepare(
          `SELECT level, message, meta FROM agent_logs WHERE run_id = ?
             AND (level = 'tool' OR message LIKE '↳%' OR meta LIKE '%"denied"%') ORDER BY id`
        )
        .all(runId) as Row[])
  const logs = rows.map((r) => ({ level: r.level, message: r.message, meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null }))
  const recordMissing = toolRecord && (getDb().prepare('SELECT COUNT(*) AS n FROM agent_logs WHERE run_id = ?').get(runId) as { n: number }).n === 0
  const results = new Map<string, 'ok' | 'error'>()
  const refusedTargets = new Set<string>()
  const denied: string[] = []
  for (const l of logs) {
    const id = typeof l.meta?.toolUseId === 'string' ? l.meta.toolUseId : null
    if (id && l.message.startsWith('↳')) results.set(id, l.level === 'error' ? 'error' : 'ok')
    const d = l.meta?.denied as { tool?: string; target?: string } | undefined
    if (d) {
      denied.push(`${d.tool ?? '?'}${d.target ? ` ${d.target}` : ''}`)
      if (d.target) refusedTargets.add(`${d.tool}\u0000${d.target}`)
    }
  }
  const all: RunEvidence['commands'] = []
  // Per file: did any attempt work (a later failure doesn't undo it), and how did the latest one end.
  const writes = new Map<string, { written: boolean; last: RunEvidence['fileWrites'][number]['last'] }>()
  for (const l of logs) {
    if (l.level !== 'tool' || !toolRecord) continue
    const id = typeof l.meta?.toolUseId === 'string' ? l.meta.toolUseId : ''
    const result = results.get(id) ?? 'unknown'
    if (l.message.startsWith('Bash ')) all.push({ command: l.message.slice(5).trim(), result })
    const w = WRITE_TOOLS.exec(l.message)
    if (w) {
      const path = w[2].trim()
      // A refusal is known by tool + path only: it explains a failed attempt, never a successful one.
      const last = result === 'error' && refusedTargets.has(`${w[1]}\u0000${path}`) ? 'refused' : result
      writes.set(path, { written: (writes.get(path)?.written ?? false) || result === 'ok', last })
    }
  }
  // A failure that the same command later got past is told apart from one that stayed.
  all.forEach((c, i) => {
    if (c.result === 'error' && all.slice(i + 1).some((x) => x.command === c.command && x.result === 'ok')) c.fixedLater = true
  })
  const failed = all.filter((c) => c.result === 'error')
  // The counts come from everything; the lists are shortened (and say by how much).
  const keep = new Set<number>()
  all.forEach((c, i) => c.result === 'error' && keep.size < MAX_FAILED && keep.add(i))
  for (let i = Math.max(0, all.length - LATEST); i < all.length; i++) keep.add(i)
  const commands = all.filter((_, i) => keep.has(i))
  const files = [...writes].map(([path, w]) => ({ path, ...w }))
  const listedFiles = [...files.filter((f) => f.written), ...files.filter((f) => !f.written)].slice(0, MAX_ITEMS)
  const writtenCount = files.filter((f) => f.written).length
  for (const a of auditRepo.list({ runId, result: 'denied', limit: MAX_ITEMS })) denied.push(`${a.connectionName || a.action}: ${a.action} ${a.detail}`.trim())
  return {
    runId,
    status: run.status,
    endedAt: run.endedAt,
    provider,
    simulated,
    toolRecord,
    recordMissing,
    commands,
    commandCount: {
      total: all.length,
      failed: failed.length,
      failedNotFixed: failed.filter((c) => !c.fixedLater).length,
      unknown: all.filter((c) => c.result === 'unknown').length,
      notListed: all.length - commands.length,
      failedNotListed: failed.length - commands.filter((c) => c.result === 'error').length
    },
    fileWrites: listedFiles,
    fileCount: {
      total: files.length,
      written: writtenCount,
      notWritten: files.length - writtenCount,
      notListed: files.length - listedFiles.length,
      writtenNotListed: writtenCount - listedFiles.filter((f) => f.written).length
    },
    denied: denied.slice(0, MAX_ITEMS),
    reportCut: (run.output?.length ?? 0) > REVIEW_REPORT_CHARS
  }
}

/**
 * The lead review of a run (since it started): who, and whether it was the Demo provider. A race is judged once, its
 * usage recorded on the original task: the other attempt finds it there (`also`), nothing is counted twice.
 */
export function reviewOfRun(taskIds: string[], runStartedAt: string): { agentId: string; provider: string } | null {
  const ids = taskIds.filter(Boolean)
  if (!ids.length) return null
  const r = getDb()
    .prepare(
      `SELECT agent_id, provider FROM token_usage WHERE task_id IN (${ids.map(() => '?').join(',')}) AND mode = 'review' AND created_at >= ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(...ids, runStartedAt) as { agent_id: string; provider: string } | undefined
  return r ? { agentId: r.agent_id, provider: r.provider } : null
}

const MARK = { ok: 'finished', error: 'FAILED', unknown: 'result not recorded' } as const

/** The evidence as the lead's review reads it (English, like the rest of the prompt). */
export function evidenceSection(e: RunEvidence, diff: { files: string[]; text: string; cut: boolean } | null): string {
  const lines: string[] = ["## Evidence from the tool record (what really ran; the report above is the worker's own account)"]
  const n = e.commandCount
  if (!e.toolRecord) lines.push('- This provider does not report its tool calls: which commands ran (e.g. tests) is not known.')
  else if (e.recordMissing) lines.push('- The tool record of this run is not available: what ran is not known.')
  else if (!n.total) lines.push('- No shell command ran in this run (so no test ran).')
  else {
    lines.push(`- Shell commands: ${n.total} ran, ${n.failed} failed${n.failed ? ` (${n.failed - n.failedNotFixed} later succeeded when run again)` : ''}, ${n.unknown} without a recorded result.`)
    lines.push(...e.commands.map((c) => `  - \`${c.command}\` → ${MARK[c.result]}${c.fixedLater ? ' (succeeded later)' : ''}`))
    if (n.notListed)
      lines.push(
        `  - … ${n.notListed} more commands not listed${n.failedNotListed ? `, ${n.failedNotListed} of them FAILED` : ' (all failures are listed above)'}.`
      )
  }
  if (diff) {
    lines.push(diff.files.length ? `- Files changed (git): ${diff.files.join(', ')}` : '- No file changed (git).')
    if (diff.text) lines.push('```diff', diff.text, '```')
    if (diff.cut) lines.push('- The diff is longer; only its start is shown.')
  } else if (e.toolRecord && !e.recordMissing) {
    const f = e.fileCount
    const written = e.fileWrites.filter((w) => w.written)
    const more = (k: number): string => (k ? ` (+${k} more not listed)` : '')
    if (!f.written) lines.push(f.total ? '- No successful write with file tools is recorded (every attempt failed, was refused or has no recorded result).' : '- No file tool was used.')
    else lines.push(`- Written with file tools (${f.written}): ${written.map((w) => w.path).join(', ')}${more(f.writtenNotListed)}`)
    const after = written.filter((w) => w.last !== 'ok')
    if (after.length) lines.push(`- Written, but a later attempt ${after.map((w) => `on ${w.path} ${w.last === 'unknown' ? 'has no result' : w.last === 'refused' ? 'was refused' : 'FAILED'}`).join('; ')} (the earlier change stays).`)
    const by = (r: string): string[] => e.fileWrites.filter((w) => !w.written && w.last === r).map((w) => w.path)
    if (by('error').length) lines.push(`- No successful write recorded, every attempt FAILED: ${by('error').join(', ')}`)
    if (by('refused').length) lines.push(`- No successful write recorded, refused: ${by('refused').join(', ')}`)
    if (by('unknown').length) lines.push(`- Not known whether written (no result recorded): ${by('unknown').join(', ')}`)
    if (f.notListed > f.writtenNotListed) lines.push(`- … ${f.notListed - f.writtenNotListed} more files without a recorded successful write are not listed.`)
    if (n.total) lines.push('- Shell commands may also have changed files; those are not tracked here (no git working copy).')
  }
  if (e.denied.length) lines.push('- Refused during the run (the work may be incomplete):', ...e.denied.map((d) => `  - ${d}`))
  if (e.reportCut) lines.push(`- The report is longer than the ${REVIEW_REPORT_CHARS} characters shown above.`)
  return lines.join('\n')
}
