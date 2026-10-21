// Chat-first work (ADR-039/040): what #general says for a request (P2), what the lead sees of the project (P3), and the
// lead's questions answered in the chat (P4). Real SQLite, real orchestrator; the provider is a stub.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { requestsRepo, type UserRequest } from '../../src/main/core/requests'
import { questionsRepo } from '../../src/main/core/questions'
import { emit } from '../../src/main/events'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { Message } from '../../src/shared/types'
import type { RunContext } from '../../src/main/providers/types'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, what: string, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(20)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const o = orchestrator as any
const WRAP = 'the tasks you created for it have ended'
const usage = { tokensIn: 1, tokensOut: 1, costUsd: 0 }
const block = (tag: string, v: unknown): string => '```' + tag + '\n' + JSON.stringify(v) + '\n```'

// The lead's chat reply is set per step; it sees the system prompt and the prompt (kept for checks).
let leadReply: (ctx: RunContext) => string = () => 'Ok.'
const chats: RunContext[] = []
const wraps: RunContext[] = []
const gates = new Map<string, Promise<void>>()
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'chat') {
    chats.push(ctx)
    return { text: leadReply(ctx), ...usage }
  }
  if (ctx.mode === 'review') {
    if (ctx.system.includes(WRAP)) {
      wraps.push(ctx)
      const keys = [...new Set([...ctx.prompt.matchAll(/^### (TA-\d+)/gm)].map((m) => m[1]))]
      return { text: JSON.stringify({ answer: 'Done; here is what came of it.', important: [{ text: 'A finding.', tasks: [keys[0]] }], optional: [], conflicts: [], incomplete: [], next: '' }), ...usage }
    }
    return { text: '{"approved": true, "note": "ok", "summary": "Fine."}', ...usage }
  }
  ctx.onUsage?.({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
  const gate = [...gates.entries()].find(([title]) => ctx.prompt.includes(title))?.[1]
  await gate
  return { text: 'Report: checked.', ...usage }
}

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const root = mkdtempSync(join(tmpdir(), 'ab-cf-'))
  // An Astro-like folder: the lead gets hints, never "no backend".
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'site', dependencies: { astro: '5.0.0', tailwindcss: '4.0.0' }, scripts: { build: 'astro build', dev: 'astro dev' } }))
  writeFileSync(join(root, 'astro.config.mjs'), 'export default {}')
  writeFileSync(join(root, '.env'), 'SECRET_TOKEN=do-not-leak-123')
  mkdirSync(join(root, 'src'))
  const p = await call('projects:save', { name: 'Site', rootPath: root, unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: true, reviewByLead: true, raceMode: false, language: 'en', autoRecovery: false, runMaxMinutes: 0 })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  orchestrator.startProjectWork(p.id)
  const lead = projectLead(p.id)!
  const team = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  const general = (): Message[] => messagesRepo.list('general', 2000, p.id)
  const thread = (taskId: string): Message[] => messagesRepo.list(`task:${taskId}`, 500, p.id)
  const send = async (text: string): Promise<void> => {
    const n = chats.length
    team.forEach((a) => agentsRepo.setStatus(a.id, 'idle'))
    await call('messages:send', 'general', text, p.id)
    await until(() => chats.length > n && !o.aux.size, 'the lead replied')
    await wait(400)
  }
  const plan = (titles: string[]): string => 'On it.\n' + block('tasks', titles.map((title, i) => ({ title, assignee: team[i % team.length].name })))
  const latestRequest = (): UserRequest => requestsRepo.recent()[0]

  await step('P2: a request in #general — the start, then the combined result; its routine steps stay in the task threads', async () => {
    const before = general().length
    leadReply = () => plan(['check the links', 'check the forms'])
    await send('Is anything missing?')
    const r = latestRequest()
    await until(() => requestsRepo.get(r.id)!.results === 1, 'the answer')
    await wait(400)
    const said = general().slice(before)
    const texts = said.map((m) => m.content)
    const start = said.find((m) => m.senderType === 'system' && /split the work into 2 task/.test(m.content))!
    assert.ok(start, texts.join('\n'))
    assert.match(start.content, /^.+ split the work into 2 task\(s\): “check the links” \(.+\), “check the forms” \(.+\)\. The combined result comes here when they are done\. · TA-\d+, TA-\d+$/)
    assert.ok(!texts.some((x) => /is checking it|approved “check|for review/.test(x)), 'no routine step in #general:\n' + texts.join('\n'))
    assert.ok(!texts.some((x) => /Nothing (is )?needed from you/i.test(x)), 'no stock phrase')
    assert.equal(said.filter((m) => (m.meta?.request as { id?: string } | undefined)?.id === r.id && !m.meta?.status).length, 1, 'one combined result')
    // What happened to each task is in its own thread.
    for (const ref of r.tasks) {
      const th = thread(ref.id).map((m) => m.content)
      assert.ok(th.some((x) => /is checking it/.test(x)), th.join('\n'))
      assert.ok(th.some((x) => /approved/.test(x)), th.join('\n'))
    }
    // A task not made for a request still tells #general (without the stock phrase).
    const n = general().length
    const solo = tasksRepo.create({ title: 'solo work', projectId: p.id, assigneeId: team[0].id })
    team.forEach((a) => agentsRepo.setStatus(a.id, 'idle'))
    await call('tasks:start', solo.id)
    await until(() => tasksRepo.get(solo.id)!.status === 'done', 'solo done')
    await wait(400)
    const soloLines = general().slice(n).map((m) => m.content)
    assert.ok(soloLines.some((x) => /finished “solo work”; .+ is checking it/.test(x)), soloLines.join('\n'))
    assert.ok(!soloLines.some((x) => /Nothing (is )?needed from you/i.test(x)))
  })

  await step('P3: the lead plans with hints from the folder (read permission only), never told "no backend"', async () => {
    leadReply = () => 'Sure.'
    await send('What kind of project is this?')
    const sys = chats.at(-1)!.system
    assert.match(sys, /## Project at a glance \(signals read from the project folder; hints that may be incomplete or wrong, not facts\)/)
    assert.match(sys, /package\.json: depends on astro/)
    assert.doesNotMatch(sys, /no backend|static site/i)
    assert.doesNotMatch(sys, /do-not-leak-123/, 'no secret from .env')
    assert.match(sys, /Create only tasks that apply to this project, not one per team role/)
    // Without the lead's read permission: no look at the folder.
    getDb().prepare('UPDATE agent_permissions SET fs_read = 0 WHERE agent_id = ?').run(lead.id)
    await send('And now?')
    assert.doesNotMatch(chats.at(-1)!.system, /Project at a glance/)
    getDb().prepare('UPDATE agent_permissions SET fs_read = 1 WHERE agent_id = ?').run(lead.id)
    // Workers may say a task doesn't apply, as a finding.
    assert.match(chats.at(-1)!.system, /## Rules/)
  })

  await step('P4: a question gets a lasting key and a card; "Q-1: …" answers it directly; the task gets the answer', async () => {
    leadReply = (ctx) =>
      ctx.prompt.includes('Which domain') || ctx.system.includes('answers your question')
        ? 'Thanks, noted.'
        : plan(['set up the domain']) + '\n' + block('question', [{ text: 'Which domain should the site use?', task: 'TA-999' }])
    await send('Put the site online')
    const r = latestRequest()
    const q = questionsRepo.forRequest(r.id)[0]
    assert.equal(q.key, `Q-${q.seq}`)
    assert.equal(q.status, 'open')
    const card = messagesRepo.get(q.askedMessageId!)!
    assert.match(card.content, /asks \(Q-\d+\): Which domain should the site use\?/)
    assert.deepEqual((card.meta!.question as { status: string }).status, 'open')
    assert.ok(orchestrator.state().questions.some((x) => x.id === q.id), 'listed in Needs you')
    assert.doesNotMatch(general().find((m) => m.senderType === 'agent' && m.senderId === lead.id && /On it/.test(m.content))!.content, /```question|Which domain/)
    // The request's tasks end, but a question of it is open: no paid answer, a short status instead.
    await until(() => r.tasks.every((x) => tasksRepo.get(x.id)?.status === 'done'), 'tasks done')
    await wait(600)
    assert.equal(requestsRepo.get(r.id)!.calls, 0, 'no paid answer while its question is open')
    assert.ok(general().some((m) => (m.meta?.request as { id?: string } | undefined)?.id === r.id && m.meta?.status && new RegExp(`Q-${q.seq}`).test(m.content)))
    // Answered by its key.
    await send(`${q.key}: example.com, without www`)
    const after = questionsRepo.get(q.id)!
    assert.equal(after.status, 'answered')
    assert.equal(after.answer, 'example.com, without www')
    assert.match(chats.at(-1)!.system, new RegExp(`The user's message answers your question\\(s\\)[\\s\\S]*${q.key}: Which domain`))
    assert.equal((messagesRepo.get(q.askedMessageId!)!.meta!.question as { status: string }).status, 'answered')
    assert.ok(!orchestrator.state().questions.some((x) => x.id === q.id), 'gone from Needs you')
    // Now the request is answered, with the question and its answer in what the lead reads.
    await until(() => requestsRepo.get(r.id)!.results >= 1 && requestsRepo.get(r.id)!.calls === 1, 'answered after the question')
    assert.match(wraps.at(-1)!.prompt, /## Questions you asked the user for it[\s\S]*Which domain[\s\S]*example\.com, without www/)
  })

  await step('P4: a question about a task; an unclear answer ties nothing; the lead may tie one clear answer', async () => {
    let open!: () => void
    gates.set('write the about page', new Promise<void>((res) => (open = res)))
    leadReply = () => plan(['write the about page'])
    await send('Write an about page')
    const task = tasksRepo.get(latestRequest().tasks[0].id)!
    leadReply = () => block('question', [{ text: 'Formal or casual tone?', task: task.key }, { text: 'Include the team photos?', task: task.key }])
    await send('Go ahead')
    const [q1, q2] = questionsRepo.open(p.id).slice(-2)
    assert.equal(q1.taskId, task.id)
    // The lead says one message answers both: nothing closes; the user is asked to name the question.
    leadReply = () => block('answered', [{ question: q1.key }, { question: q2.key }]) + '\nOk.'
    await send('casual, and yes')
    assert.equal(questionsRepo.get(q1.id)!.status, 'open')
    assert.equal(questionsRepo.get(q2.id)!.status, 'open')
    assert.ok(general().slice(-3).some((m) => /couldn't tell which question this answers/.test(m.content)))
    // One clear answer, tied by the lead: closed; the running task gets it after its current step.
    leadReply = () => block('answered', [{ question: q1.key }]) + '\nGot it.'
    await send('casual please')
    assert.equal(questionsRepo.get(q1.id)!.status, 'answered')
    assert.equal(questionsRepo.get(q1.id)!.answer, 'casual please')
    // Tied by the lead (not by its key): passed on as the lead's reading of the user's message, not as a user instruction.
    assert.ok(thread(task.id).some((m) => m.senderType === 'agent' && m.senderId === lead.id && /The user's answer to Q-\d+ \(“Formal or casual tone\?”\), as the lead read their message: casual please/.test(m.content)))
    const queued = getDb().prepare("SELECT source, COUNT(*) AS n FROM agent_instructions WHERE task_id = ? AND status = 'queued' GROUP BY source").all(task.id) as { source: string; n: number }[]
    assert.deepEqual(queued, [{ source: 'lead', n: 1 }], 'the running run gets it after its current step, as the lead\'s note')
    // A key that isn't open: said, nothing changes.
    leadReply = () => 'Ok.'
    await send(`${q1.key}: actually formal`)
    assert.equal(questionsRepo.get(q1.id)!.answer, 'casual please')
    assert.ok(general().slice(-3).some((m) => new RegExp(`${q1.key} isn't an open question any more`).test(m.content)))
    // "Not needed": closed without an answer.
    await call('questions:drop', q2.id)
    assert.equal(questionsRepo.get(q2.id)!.status, 'dropped')
    assert.equal((messagesRepo.get(q2.askedMessageId!)!.meta!.question as { status: string }).status, 'dropped')
    open()
  })

  await step('P4: a later question about one of a request\'s tasks keeps the request from a paid answer until answered', async () => {
    let open!: () => void
    gates.set('write the FAQ', new Promise<void>((res) => (open = res)))
    leadReply = () => plan(['write the FAQ'])
    await send('Write a FAQ page')
    const r = latestRequest()
    const task = tasksRepo.get(r.tasks[0].id)!
    leadReply = () => block('question', [{ text: 'How many questions should it have?', task: task.key }])
    await send('Anything you need from me?')
    const q = questionsRepo.open(p.id).at(-1)!
    assert.equal(q.requestId, null, 'asked in a later reply')
    assert.equal(q.taskId, task.id)
    open()
    await until(() => tasksRepo.get(task.id)!.status === 'done', 'done')
    await wait(700)
    assert.equal(requestsRepo.get(r.id)!.calls, 0, 'no paid answer while a question about its task is open')
    await assert.rejects(call('requests:summarize', r.id), /question about this request is still open|nothing to write again/)
    leadReply = () => 'Thanks.'
    await send(`${q.key}: ten`)
    await until(() => requestsRepo.get(r.id)!.calls === 1 && requestsRepo.get(r.id)!.results === 1, 'answered after the question')
  })

  await step('P4: an answer in the chat is never an approval: a run waiting for approval stays waiting after "ok"', async () => {
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(team[0].id)
    leadReply = () => plan(['deploy the site']) + '\n' + block('question', [{ text: 'Shall I go ahead?' }])
    await send('Deploy it')
    const task = tasksRepo.get(latestRequest().tasks[0].id)!
    await until(() => runsRepo.list({ taskId: task.id, activeOnly: true })[0]?.status === 'awaiting_approval', 'awaiting approval')
    const q = questionsRepo.open(p.id).at(-1)!
    leadReply = () => block('answered', [{ question: q.key }]) + '\nOk.'
    await send('ok')
    await wait(500)
    assert.equal(runsRepo.list({ taskId: task.id, activeOnly: true })[0]?.status, 'awaiting_approval', 'still waiting for the approval button')
    assert.equal(questionsRepo.get(q.id)!.status, 'answered', 'the question is answered — that is all')
    await call('tasks:cancel', task.id)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  })

  await step('P4: questions survive a restart (key and status); the panel lists only open ones', async () => {
    const open = questionsRepo.open(p.id).map((q) => q.key)
    o.shutdown()
    o.closing = false
    o.busy.clear()
    o.active.clear()
    orchestrator.init()
    orchestrator.startProjectWork(p.id)
    assert.deepEqual(questionsRepo.open(p.id).map((q) => q.key), open)
    assert.deepEqual(
      orchestrator.state().questions.map((q) => q.key),
      questionsRepo.open().map((q) => q.key)
    )
    emit({ type: 'tasks:changed' })
  })

  await step('the message is not "remembered" back in its own reply; a message over the limit is refused (nothing stored)', async () => {
    leadReply = () => 'Sure.'
    const text = 'Remember that the staging server is called kumquat-seventeen.'
    await send(text)
    assert.doesNotMatch(chats.at(-1)!.system, /kumquat-seventeen/, 'its own memory entry is not recalled in its reply')
    const n = general().length
    await assert.rejects(call('messages:send', 'general', 'x'.repeat(20_001), p.id), /too long \(20001 characters; at most 20,000\)/)
    assert.equal(general().length, n)
  })

  await step('closed while a run waited for approval: held as "never started" (not "may have changed something")', async () => {
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(team[1].id)
    const task = tasksRepo.create({ title: 'needs an ok first', projectId: p.id, assigneeId: team[1].id })
    team.forEach((a) => agentsRepo.setStatus(a.id, 'idle'))
    await call('tasks:start', task.id)
    await until(() => runsRepo.list({ taskId: task.id, activeOnly: true })[0]?.status === 'awaiting_approval', 'awaiting approval')
    o.shutdown()
    o.closing = false
    o.busy.clear()
    o.approvals.clear()
    o.active.clear()
    orchestrator.init()
    orchestrator.startProjectWork(p.id)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    const held = orchestrator.state().held.find((h) => h.taskId === task.id)
    assert.ok(held, 'held for the user')
    assert.match(held!.reason, /waited for your approval; it never started/)
    const note = thread(task.id).at(-1)!.content
    assert.match(note, /nothing ran and nothing was changed/)
    assert.doesNotMatch(note, /may have|part of its work/)
  })

  await step('an older card is fetched only from its own project and channel (deleted, other project or channel: refused)', async () => {
    const q = questionsRepo.forRequest(requestsRepo.recent(500).find((r) => questionsRepo.forRequest(r.id).length)!.id)[0]
    const from = await call<Message[]>('messages:from', p.id, q.channel, q.askedMessageId!)
    assert.equal(from[0].id, q.askedMessageId)
    assert.equal(from.at(-1)!.id, general().at(-1)!.id, 'up to the newest')
    const other = await call('projects:save', { name: 'Other', rootPath: mkdtempSync(join(tmpdir(), 'ab-cf2-')), unitIds: [tpl.unitId] })
    await assert.rejects(call('messages:from', other.id, q.channel, q.askedMessageId!), /no longer in this chat/)
    await assert.rejects(call('messages:from', p.id, 'agent:someone', q.askedMessageId!), /no longer in this chat/)
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(q.askedMessageId)
    await assert.rejects(call('messages:from', p.id, q.channel, q.askedMessageId!), /no longer in this chat/)
  })

  console.log(`chatFlow e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
