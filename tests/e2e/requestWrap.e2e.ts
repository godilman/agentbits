// A user's chat request → the tasks the lead created → one combined answer and report (ADR-039).
// Real SQLite, real orchestrator; the provider is a stub (the lead's chat, the work, the reviews and the answer).
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, reportsRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { factsLine, MAX_WRAP_CALLS, recordedChanges, requestsRepo, type UserRequest } from '../../src/main/core/requests'
import { emit } from '../../src/main/events'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { Agent, Message, Task } from '../../src/shared/types'
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

// The stub provider. The lead's chat reply plans the tasks below; work and answers are set per step.
let plan: { title: string; assignee: string }[] = []
const gates = new Map<string, Promise<void>>() // task title → the run ends only after this
const fails = new Set<string>() // task titles whose run fails
let wrapReply: (ctx: RunContext) => Promise<string> = async (ctx) => good(ctx)
const wraps: RunContext[] = []
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'chat') return { text: 'On it.\n```tasks\n' + JSON.stringify(plan) + '\n```', ...usage }
  if (ctx.mode === 'review') {
    if (ctx.system.includes(WRAP)) {
      wraps.push(ctx)
      return { text: await wrapReply(ctx), ...usage }
    }
    return { text: '{"approved": true, "note": "ok", "summary": "Looks fine."}', ...usage }
  }
  const title = plan.find((x) => ctx.prompt.includes(x.title))?.title ?? [...gates.keys(), ...fails].find((x) => ctx.prompt.includes(x)) ?? ''
  ctx.onUsage?.({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 }) // as the Demo provider reports it
  await gates.get(title)
  if (fails.has(title)) throw new Error('boom: the work failed')
  return { text: `Report on ${title}: two broken links found in docs.`, ...usage }
}
/** A valid answer naming the request's own tasks (from the prompt). */
function good(ctx: RunContext, extra: Record<string, unknown> = {}): string {
  const keys = [...new Set([...ctx.prompt.matchAll(/^### (TA-\d+)/gm)].map((m) => m[1]))]
  return JSON.stringify({
    answer: 'Your project has a few gaps; the important ones are below.',
    important: [{ text: 'Two broken links in the docs.', tasks: keys.slice(0, 2) }],
    optional: [{ text: 'Add alt texts.', tasks: [keys[0]] }],
    conflicts: [],
    incomplete: [],
    next: 'Shall I fix the links?',
    ...extra
  })
}

const general = (pid: string): Message[] => messagesRepo.list('general', 1000, pid)
const forReq = (pid: string, id: string): Message[] => general(pid).filter((m) => (m.meta?.request as { id?: string } | undefined)?.id === id)
const answers = (pid: string, id: string): Message[] => forReq(pid, id).filter((m) => !m.meta?.status)
const statuses = (pid: string, id: string): Message[] => forReq(pid, id).filter((m) => m.meta?.status)
const req = (id: string): UserRequest => requestsRepo.get(id)!
const customReports = (pid: string): { title: string; bodyMd: string }[] => reportsRepo.list().filter((r) => r.projectId === pid && r.kind === 'custom')

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p = await call('projects:save', { name: 'Site', rootPath: mkdtempSync(join(tmpdir(), 'ab-rq-')), unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: true, reviewByLead: true, raceMode: false, language: 'en', autoRecovery: false, runMaxMinutes: 0 })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  orchestrator.startProjectWork(p.id)
  const lead = projectLead(p.id)!
  const team = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  const idleAll = (): void => team.forEach((a) => agentsRepo.setStatus(a.id, 'idle'))

  /** Sends a chat message; the lead plans `titles` (one per team member); returns the request and its tasks. */
  const ask = async (text: string, titles: string[], who: Agent[] = team): Promise<{ r: UserRequest; tasks: Task[] }> => {
    plan = titles.map((title, i) => ({ title, assignee: who[i % who.length].name }))
    const total = (): number => (getDb().prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }).n
    const before = total()
    idleAll()
    await call('messages:send', 'general', text, p.id)
    await until(() => total() > before, 'the request')
    const r = requestsRepo.recent(1)[0]
    return { r, tasks: r.tasks.map((x) => tasksRepo.get(x.id)!) }
  }
  const allDone = (tasks: Task[]): boolean => tasks.every((x) => tasksRepo.get(x.id)?.status === 'done')
  // Reviews and answers in flight have ended (a run held open by a gate may go on).
  const settle = async (): Promise<void> => {
    await until(() => !o.reviewing.size && !o.requestWraps.size, 'quiet')
    await wait(500) // the debounced look
  }

  await step('the request is answered once, in its chat, with one report — only after all its tasks ended', async () => {
    let open!: () => void
    gates.set('check the SEO', new Promise<void>((r) => (open = r)))
    const { r, tasks } = await ask('Is anything missing in the project?', ['check the links', 'check accessibility', 'check the SEO'])
    assert.equal(tasks.length, 3)
    assert.equal(r.channel, 'general')
    await until(() => tasks.filter((x) => tasksRepo.get(x.id)?.status === 'done').length === 2, 'two done')
    await settle()
    assert.equal(wraps.length, 0, 'no answer while one task still runs')
    assert.equal(forReq(p.id, r.id).length, 0, 'no status line while work goes on')
    open()
    await until(() => req(r.id).results === 1, 'the answer')
    const a = answers(p.id, r.id)
    assert.equal(a.length, 1)
    assert.equal(a[0].senderType, 'agent')
    assert.equal(a[0].senderId, lead.id)
    assert.match(a[0].content, /^Your project has a few gaps/)
    assert.match(a[0].content, /Two broken links in the docs\. \(TA-\d+, TA-\d+\)/)
    assert.match(a[0].content, /From the records: 3 tasks done · 3 tasks were a Demo simulation/)
    const rep = customReports(p.id)
    assert.equal(rep.length, 1)
    assert.equal(rep[0].title, 'Result: Is anything missing in the project?')
    assert.match(rep[0].bodyMd, /## Important\n- Two broken links/)
    assert.match(rep[0].bodyMd, /## Tasks\n\| Task \| Who \| Outcome \| Changes \(from the record\) \|/)
    assert.match(rep[0].bodyMd, /Report text seen \(characters shown \/ total\): TA-\d+: \d+\/\d+/)
    assert.equal((a[0].meta!.request as { reportId: string }).reportId, reportsRepo.list().find((x) => x.title === rep[0].title)!.id)
    // The model saw the whole request and each task's outcome and report.
    assert.match(wraps[0].prompt, /Is anything missing in the project\?/)
    assert.match(wraps[0].prompt, /Outcome: done \(approved by the lead\)/)
    // More events, another look: nothing new.
    for (let i = 0; i < 3; i++) emit({ type: 'tasks:changed' })
    o.requestsSweep()
    await settle()
    assert.equal(wraps.length, 1, 'not written twice')
    assert.equal(answers(p.id, r.id).length, 1)
    assert.equal(customReports(p.id).length, 1)
    assert.equal(req(r.id).calls, 1)
    assert.ok(allDone(tasks))
    // Answered by the lead: "write the summary again" (an old button) asks for nothing new — refused, nothing paid.
    await assert.rejects(call('requests:summarize', r.id), /nothing to write again/)
    assert.equal(req(r.id).calls, 1)
  })

  await step('a later change (a task done again): one update, said so', async () => {
    const r = requestsRepo.recent()[0]
    const t1 = tasksRepo.get(r.tasks[0].id)!
    await call('tasks:move', t1.id, 'todo')
    idleAll()
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'done again')
    await until(() => req(r.id).results === 2, 'the update')
    await settle()
    const a = answers(p.id, r.id)
    assert.equal(a.length, 2)
    assert.match(a[1].content, /^\*\*Update:\*\* /)
    assert.ok(customReports(p.id).some((x) => x.title === 'Update: Is anything missing in the project?'))
    assert.match(wraps.at(-1)!.prompt, /## Your earlier answer to this request/)
    assert.equal(req(r.id).calls, 2)
  })

  await step('after the answer, editing a title or description, reordering the card or deleting a task costs nothing and writes nothing', async () => {
    const { r, tasks } = await ask('Check the colors', ['check the colors'], [team[0]])
    await until(() => req(r.id).results === 1, 'answered')
    await settle()
    const t1 = tasks[0]
    tasksRepo.update(t1.id, { title: 'check the colours', description: 'typo fixed' })
    emit({ type: 'tasks:changed' })
    await settle()
    await call('tasks:move', t1.id, 'done', 0)
    await call('tasks:move', t1.id, 'done', 5)
    await settle()
    await call('tasks:delete', t1.id)
    await settle()
    assert.equal(req(r.id).calls, 1)
    assert.equal(req(r.id).results, 1)
    assert.equal(forReq(p.id, r.id).length, 1)
  })

  await step('a race\'s losing attempt is "not used", not done; a task waiting to be merged is waiting, not done', async () => {
    const { r, tasks } = await ask('Write the intro', ['write the intro'], [team[0]])
    await until(() => req(r.id).results === 1, 'answered')
    // (the race itself is tested elsewhere; here its outcome as a request sees it)
    getDb().prepare("UPDATE tasks SET race_result = 'lost' WHERE id = ?").run(tasks[0].id)
    const loser = (o as any).requestOutcome(tasks[0].id)
    assert.equal(loser.kind, 'superseded')
    const views = o.requestViews(o.requestRefs(req(r.id)))
    assert.match(factsLine(views), /1 race attempt not used/)
    getDb().prepare('UPDATE tasks SET race_result = NULL WHERE id = ?').run(tasks[0].id)
    // A worktree task approved but not merged yet: waiting for the user, so no paid answer.
    const wt = await call('projects:save', { name: 'Copies', rootPath: mkdtempSync(join(tmpdir(), 'ab-rqwt-')), unitIds: [tpl.unitId], isolation: 'worktree' })
    const task = tasksRepo.create({ title: 'merge me', projectId: wt.id, assigneeId: team[0].id })
    mkdirSync(o.worktreeDir(wt.id, task.key), { recursive: true })
    tasksRepo.move(task.id, 'done')
    const out = o.requestOutcome(task.id)
    assert.equal(out.kind, 'waiting')
    assert.equal(out.why, 'user')
    assert.match(out.reason, /waiting to be merged/)
  })

  await step('a task that simply has not started yet is no reason for a status line (nothing for the user to act on)', async () => {
    settingsRepo.update({ autopilot: false })
    const { r, tasks } = await ask('Check the menus', ['check the main menu', 'check the footer menu'])
    idleAll()
    await call('tasks:start', tasks[0].id)
    await until(() => tasksRepo.get(tasks[0].id)!.status === 'done', 'one done')
    await settle()
    await wait(500)
    assert.equal(forReq(p.id, r.id).length, 0, 'no status for a task that only waits to be started')
    settingsRepo.update({ autopilot: true })
    idleAll()
    await until(() => req(r.id).results === 1, 'answered once the other ran')
  })

  await step('a task waiting for the user: a short status (free, once), no paid answer; cancelling it: partly done, not a success', async () => {
    fails.add('check the forms')
    const { r, tasks } = await ask('Check the forms and the footer', ['check the forms', 'check the footer'])
    const failed = tasks.find((x) => x.title === 'check the forms')!
    await until(() => orchestrator.state().held.some((h) => h.taskId === failed.id), 'held')
    await until(() => statuses(p.id, r.id).length === 1, 'the status line')
    await settle()
    const before = wraps.length
    assert.match(statuses(p.id, r.id)[0].content, /^“Check the forms and the footer” — From the records: 1 task done, 1 waiting for you · 1 task was a Demo simulation\. Waiting: TA-\d+; their cards are in the chat\./)
    assert.doesNotMatch(statuses(p.id, r.id)[0].content, /Nothing (is )?needed from you/)
    emit({ type: 'orchestrator:changed' })
    await settle()
    assert.equal(statuses(p.id, r.id).length, 1, 'once per state')
    assert.equal(answers(p.id, r.id).length, 0)
    assert.equal(wraps.length, before, 'no paid answer while it waits')
    // An approval waiting for the user is not "done" either.
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(team[2].id)
    const { r: r2, tasks: t2 } = await ask('Check the images', ['check the images'], [team[2]])
    await until(() => runsRepo.list({ taskId: t2[0].id, activeOnly: true })[0]?.status === 'awaiting_approval', 'awaiting approval')
    await until(() => statuses(p.id, r2.id).length === 1, 'its status')
    await settle()
    assert.match(statuses(p.id, r2.id)[0].content, /1 waiting for you\. Waiting: TA-\d+/)
    assert.equal(answers(p.id, r2.id).length, 0)
    assert.equal(wraps.length, before)
    await call('tasks:cancel', t2[0].id)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    await until(() => forReq(p.id, r2.id).some((m) => /none of its tasks/.test(m.content)), 'its end')
    assert.match(forReq(p.id, r2.id).at(-1)!.content, /none of its tasks was completed \(From the records: 1 cancelled\)/)
    assert.equal(wraps.length, before, 'nothing done: no model call')
    // Cancelling the held one ends the first request: a partly-done answer.
    fails.delete('check the forms')
    await call('tasks:cancel', failed.id)
    await until(() => req(r.id).results === 1, 'the answer')
    const a = answers(p.id, r.id)
    assert.match(a[0].content, /^\*\*Partly done\.\*\* /)
    assert.match(a[0].content, /From the records: 1 task done, 1 cancelled/)
    assert.match(wraps.at(-1)!.prompt, /Outcome: cancelled by the user \(not done\)/)
  })

  await step('a new message in between: each request is answered for its own tasks', async () => {
    let open!: () => void
    gates.set('audit the styles', new Promise<void>((r) => (open = r)))
    const A = await ask('Audit the styles', ['audit the styles'], [team[0]])
    const B = await ask('Check the sitemap', ['check the sitemap'], [team[1]])
    await until(() => req(B.r.id).results === 1, 'B answered')
    const promptB = wraps.at(-1)!.prompt
    assert.ok(promptB.includes(B.tasks[0].key) && !promptB.includes(A.tasks[0].key))
    assert.equal(req(A.r.id).results, 0)
    open()
    await until(() => req(A.r.id).results === 1, 'A answered')
    const promptA = wraps.at(-1)!.prompt
    assert.ok(promptA.includes(A.tasks[0].key) && !promptA.includes(B.tasks[0].key))
  })

  await step('its tasks change while the answer is written: not published as current (counted); answered once for the new state', async () => {
    let release!: () => void
    let first = true
    wrapReply = async (ctx) => {
      if (first) {
        first = false
        await new Promise<void>((r) => (release = r))
      }
      return good(ctx)
    }
    const { r, tasks } = await ask('Check the 404 page', ['check the 404 page'], [team[0]])
    await until(() => req(r.id).state === 'wrapping', 'writing')
    tasksRepo.update(tasks[0].id, { reviewNote: 'a new note meanwhile' }) // what the answer is about changed
    emit({ type: 'tasks:changed' })
    release()
    await until(() => req(r.id).results === 1, 'answered')
    await settle()
    assert.equal(req(r.id).calls, 2, 'the stale call is counted')
    assert.equal(answers(p.id, r.id).length, 1, 'only the current one is published')
    wrapReply = async (ctx) => good(ctx)
  })

  await step('writing the result fails once: written later, once, without another model call', async () => {
    const create = reportsRepo.create
    let thrown = false
    reportsRepo.create = (r) => {
      if (!thrown && r.kind === 'custom') {
        thrown = true
        throw new Error('disk full')
      }
      return create.call(reportsRepo, r)
    }
    try {
      const { r } = await ask('Check the favicon', ['check the favicon'], [team[1]])
      await until(() => thrown && req(r.id).state === 'publishing', 'the failed write')
      const calls = wraps.length
      assert.equal(forReq(p.id, r.id).length, 0, 'nothing half-written')
      assert.ok(req(r.id).draft, 'the result is kept')
      o.requestsSweep()
      await until(() => req(r.id).results === 1, 'written')
      o.requestsSweep()
      await settle()
      assert.equal(answers(p.id, r.id).length, 1)
      assert.equal(customReports(p.id).filter((x) => x.title === 'Result: Check the favicon').length, 1)
      assert.equal(wraps.length, calls, 'no new model call')
    } finally {
      reportsRepo.create = create
    }
  })

  await step('a deleted task stays in the request: said, not silently dropped', async () => {
    let open!: () => void
    gates.set('check the RSS feed', new Promise<void>((r) => (open = r)))
    const { r, tasks } = await ask('Check the blog', ['check the blog posts', 'check the RSS feed'])
    const rss = tasks.find((x) => x.title === 'check the RSS feed')!
    await until(() => tasksRepo.get(tasks[0].id)?.status === 'done', 'one done')
    await call('tasks:cancel', rss.id)
    open()
    await until(() => req(r.id).results === 1 && !o.active.size, 'answered: partly done, once its run had stopped')
    await settle()
    await wait(800)
    assert.equal(req(r.id).results, 1, "the cancelled task's run ending later is no new result")
    assert.equal(req(r.id).calls, 1)
    // Editing the cancelled task changes nothing to say: no paid update.
    tasksRepo.update(rss.id, { description: 'edited after it was cancelled' })
    emit({ type: 'tasks:changed' })
    await settle()
    assert.equal(req(r.id).calls, 1, 'a cancelled task stays cancelled until it is reopened')
    // Deleted after the answer: the answer already covered it; nothing new is written or paid for.
    await call('tasks:delete', rss.id)
    await settle()
    assert.equal(req(r.id).calls, 1)
    assert.equal(req(r.id).results, 1)
    // Deleted before the answer (its agent is off, so it never started): the answer says so.
    const off = team[team.length - 1]
    getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(off.id)
    const B = await ask('Check the archive pages', ['check the tags page', 'check the archive'], [team[0], off])
    const arch = B.tasks.find((x) => x.title === 'check the archive')!
    await until(() => tasksRepo.get(B.tasks[0].id)?.status === 'done', 'one done')
    await settle()
    assert.equal(req(B.r.id).results, 0, 'not answered while one waits')
    await call('tasks:delete', arch.id)
    await until(() => req(B.r.id).results === 1, 'answered')
    getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(off.id)
    assert.match(wraps.at(-1)!.prompt, new RegExp(`### ${arch.key}\\nTitle \\(data\\): "check the archive"\\nAssignee: unknown\\nOutcome: deleted \\(no record left; it can no longer be reported\\)`))
    assert.match(answers(p.id, B.r.id)[0].content, /1 deleted/)
    const rep = customReports(p.id).find((x) => x.title === 'Result: Check the archive pages')!
    assert.match(rep.bodyMd, new RegExp(`\\| ${arch.key} · check the archive \\| — \\| deleted \\(can no longer be reported\\) \\| — \\|`))
  })

  await step('the model fails or answers unclearly: the records\' summary (free, no claims); never retried on its own; the user may ask again within the budget', async () => {
    wrapReply = async () => {
      throw new Error('fetch failed')
    }
    const { r } = await ask('Check the contact page', ['check the contact page'], [team[0]])
    await until(() => req(r.id).results === 1, 'the summary')
    await settle()
    const m = forReq(p.id, r.id)
    assert.equal(m.length, 1)
    assert.equal(m[0].senderType, 'system')
    assert.match(m[0].content, /couldn't write the combined result; the tasks' reports are in the combined report\. Why: .+/)
    assert.doesNotMatch(m[0].content, /verified|tested|works/)
    assert.equal((m[0].meta!.request as { retry: boolean }).retry, true)
    assert.ok(customReports(p.id).some((x) => x.title === 'From the records: Check the contact page' && /Written from the records only/.test(x.bodyMd) && /Report on check the contact page/.test(x.bodyMd)))
    const calls = wraps.length
    emit({ type: 'tasks:changed' })
    o.requestsSweep()
    await settle()
    assert.equal(wraps.length, calls, 'not retried on its own')
    // The user asks again: counted in the same budget.
    wrapReply = async () => 'not json at all'
    await call('requests:summarize', r.id)
    await until(() => req(r.id).results === 2, 'second')
    assert.match(forReq(p.id, r.id).at(-1)!.content, /couldn't write the combined result; .* Why: .*answer couldn't be read$/)
    wrapReply = async (ctx) => good(ctx)
    await call('requests:summarize', r.id)
    await until(() => req(r.id).results === 3, 'third')
    assert.doesNotMatch(forReq(p.id, r.id).at(-1)!.content, /Update:/, "the lead's first answer, not an update of the records' summary")
    assert.equal(req(r.id).calls, MAX_WRAP_CALLS)
    await assert.rejects(call('requests:summarize', r.id), /summaries this request may use are used up/)
    assert.equal(wraps.length, calls + 2)
    // Out of budget: a later change is said once (no call); the next ones are only recorded.
    const t0 = tasksRepo.get(r.tasks[0].id)!
    const n = forReq(p.id, r.id).length
    for (const note of ['first change', 'second change']) {
      tasksRepo.update(t0.id, { reviewNote: note })
      emit({ type: 'tasks:changed' })
      await settle()
    }
    assert.equal(wraps.length, calls + 2, 'no call past the budget')
    assert.equal(forReq(p.id, r.id).length, n + 1, 'the budget is said once')
    assert.match(forReq(p.id, r.id).at(-1)!.content, /summaries this request may use are used up/)
  })

  await step('points are checked: one without a source, or naming a task not in this request, is left out (and said)', async () => {
    wrapReply = async (ctx) =>
      good(ctx, {
        important: [
          { text: 'Valid point.', tasks: [[...ctx.prompt.matchAll(/^### (TA-\d+)/gm)][0][1]] },
          { text: 'No source.', tasks: [] },
          { text: 'Someone else.', tasks: ['TA-999'] }
        ]
      })
    const { r } = await ask('Check the header', ['check the header'], [team[1]])
    await until(() => req(r.id).results === 1, 'answered')
    const a = answers(p.id, r.id)[0].content
    assert.match(a, /Valid point\./)
    assert.doesNotMatch(a, /No source|Someone else/)
    assert.match(customReports(p.id).find((x) => x.title === 'Result: Check the header')!.bodyMd, /2 point\(s\) left out/)
    wrapReply = async (ctx) => good(ctx)
  })

  await step('a long request is not silently cut: the model is told; the message stays whole', async () => {
    const text = 'Check everything. ' + 'x'.repeat(7000)
    const { r } = await ask(text, ['check everything'], [team[0]])
    await until(() => req(r.id).results === 1, 'answered')
    assert.match(wraps.at(-1)!.prompt, /\(The request is longer; only its first 6000 characters are shown\.\)/)
    assert.match(customReports(p.id).at(0)!.bodyMd, /The request was longer than what was given/)
    assert.equal(messagesRepo.get(r.messageId!)!.content.length, text.length)
  })

  await step('what the records say about changes: never "unchanged" from a missing write', () => {
    const t = tasksRepo.create({ title: 'evidence', projectId: p.id, assigneeId: team[0].id })
    const runWith = (provider: string, tools: [string, string][]): void => {
      const run = runsRepo.create(t.id, team[0].id, 'succeeded', p.id)
      getDb().prepare("INSERT INTO token_usage (agent_id, run_id, task_id, project_id, mode, provider, model, input, output, cache_read, cache_write, cost_usd, estimated, session_id, created_at) VALUES (?,?,?,?, 'task', ?, 'm', 1, 1, 0, 0, 0, 0, 'test', ?)").run(team[0].id, run.id, t.id, p.id, provider, new Date().toISOString())
      const add = getDb().prepare('INSERT INTO agent_logs (run_id, agent_id, task_id, project_id, level, message, meta, created_at) VALUES (?,?,?,?,?,?,?,?)')
      add.run(run.id, team[0].id, t.id, p.id, 'status', 'started', null, new Date().toISOString())
      for (const [msg, res] of tools) {
        const id = `toolu_${randomUUID()}`
        add.run(run.id, team[0].id, t.id, p.id, 'tool', msg, JSON.stringify({ toolUseId: id }), new Date().toISOString())
        add.run(run.id, team[0].id, t.id, p.id, 'debug', `↳ ${res}`, JSON.stringify({ toolUseId: id }), new Date().toISOString())
      }
    }
    runWith('claude-cli', [['Read src/a.ts', 'ok']])
    assert.equal(recordedChanges(t.id).kind, 'noWrites')
    runWith('claude-cli', [['Bash npm test', 'ok']])
    assert.equal(recordedChanges(t.id).kind, 'unknown', 'a shell command may change files')
    runWith('claude-cli', [['Write src/b.ts', 'ok']])
    const c = recordedChanges(t.id)
    assert.equal(c.kind, 'changed')
    assert.deepEqual(c.files, ['src/b.ts'])
    assert.equal(c.partlyUnknown, true)
    const t2 = tasksRepo.create({ title: 'evidence 2', projectId: p.id, assigneeId: team[0].id })
    const run = runsRepo.create(t2.id, team[0].id, 'succeeded', p.id)
    getDb().prepare("INSERT INTO token_usage (agent_id, run_id, task_id, project_id, mode, provider, model, input, output, cache_read, cache_write, cost_usd, estimated, session_id, created_at) VALUES (?,?,?,?, 'task', 'openai', 'm', 1, 1, 0, 0, 0, 0, 'test', ?)").run(team[0].id, run.id, t2.id, p.id, new Date().toISOString())
    assert.equal(recordedChanges(t2.id).kind, 'unknown', 'no tool record: not known')
    const line = factsLine([
      { ref: { id: 'a', key: 'TA-1', title: 'a' }, outcome: { kind: 'done', by: 'lead' }, assignee: null, changes: { kind: 'noWrites', files: [], partlyUnknown: false }, reviewNote: null, report: null },
      { ref: { id: 'b', key: 'TA-2', title: 'b' }, outcome: { kind: 'done', by: 'lead' }, assignee: null, changes: { kind: 'unknown', files: [], partlyUnknown: true }, reviewNote: null, report: null }
    ])
    assert.equal(line, "From the records: 2 tasks done · no file write in the record of 1 task, changes can't be verified in 1 task")
    assert.doesNotMatch(line, /unchanged|nothing changed|only reviewed/i)
  })

  await step('every request is followed at any age: 205 newer ones in another project push nothing out, and cost nothing', async () => {
    let open!: () => void
    gates.set('check the old gate', new Promise<void>((res) => (open = res)))
    // (agents not used by the previous step: after a run an agent takes a short break)
    const A = await ask('Old answered request', ['check the old answer'], [team[3]])
    await until(() => req(A.r.id).results === 1, 'A answered', 40_000)
    const B = await ask('Old open request', ['check the old gate'], [team[4]])
    // A long history elsewhere: 205 newer requests in another project, each settled for its (unchanged) state.
    const other = await call('projects:save', { name: 'History', rootPath: mkdtempSync(join(tmpdir(), 'ab-rqh-')), unitIds: [tpl.unitId] })
    const t = tasksRepo.create({ title: 'old work', projectId: other.id, assigneeId: team[2].id })
    tasksRepo.move(t.id, 'done')
    await wait(20) // the history is newer than A and B
    for (let i = 0; i < 205; i++) {
      const h = requestsRepo.create({ projectId: other.id, channel: 'general', messageId: null, text: `history ${i}`, leadId: lead.id, tasks: [{ id: t.id, key: t.key, title: t.title }], fileNames: [] })
      requestsRepo.update(h.id, { answeredBasis: o.requestBasis(o.requestRefs(h)) })
    }
    const newest = requestsRepo.recent(200).map((x) => x.id)
    assert.ok(!newest.includes(A.r.id) && !newest.includes(B.r.id), 'A and B are older than the newest 200')
    const callsBefore = wraps.length
    // B's work ends: it is answered although 205 newer requests exist.
    open()
    await until(() => req(B.r.id).results === 1, 'B answered', 40_000)
    // A's result changes later: one update.
    await call('tasks:move', A.tasks[0].id, 'todo')
    idleAll()
    await until(() => req(A.r.id).results === 2, 'A updated', 40_000)
    // The settled history costs nothing: no call for it, and it isn't looked at again on every event.
    await settle()
    assert.equal(wraps.length, callsBefore + 2)
    assert.equal((getDb().prepare('SELECT COALESCE(SUM(calls), 0) AS n FROM requests WHERE project_id = ?').get(other.id) as { n: number }).n, 0)
    assert.ok(!requestsRepo.pending().some((x) => x.projectId === other.id), 'nothing of the history is pending')
    // A change in the history's task makes them pending again; with nothing new to say they settle without a message.
    tasksRepo.update(t.id, { title: 'old work (renamed)' })
    emit({ type: 'tasks:changed' })
    await settle()
    assert.ok(!requestsRepo.pending().some((x) => x.projectId === other.id), 'settled again after one look')
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM messages WHERE project_id = ?").get(other.id) as { n: number }).n, 0)
  })

  await step('after a restart: opening calls no model; an interrupted answer becomes the records\' summary; a new state is answered once the work is started', async () => {
    wrapReply = () => new Promise<string>(() => undefined) // cut off by the "quit"
    const { r } = await ask('Check the robots file', ['check the robots file'], [team[1]])
    await until(() => req(r.id).state === 'wrapping', 'writing')
    const calls = wraps.length
    // A second request whose tasks end while the work isn't started.
    const restart = (): void => {
      o.shutdown()
      o.closing = false
      o.busy.clear()
      o.requestWraps.clear()
      o.active.clear()
      orchestrator.init()
    }
    restart()
    await until(() => req(r.id).results === 1, 'the interrupted summary')
    const m = forReq(p.id, r.id).at(-1)!
    assert.match(m.content, /couldn't write the combined result; .* Why: the app closed while it was being written$/)
    wrapReply = async (ctx) => good(ctx)
    plan = [{ title: 'check the manifest', assignee: team[0].name }]
    const count = (): number => (getDb().prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number }).n
    const before = count()
    await call('messages:send', 'general', 'Check the manifest', p.id)
    await until(() => count() > before, 'the request')
    const r2 = requestsRepo.recent(1)[0]
    await call('tasks:move', r2.tasks[0].id, 'done', undefined, true) // done by the user, work not started
    await wait(800)
    assert.equal(wraps.length, calls, 'nothing calls the model before the work is started')
    assert.equal(req(r2.id).results, 0)
    orchestrator.startProjectWork(p.id)
    await until(() => req(r2.id).results === 1, 'answered after the start')
    assert.equal(wraps.length, calls + 1)
    assert.match(wraps.at(-1)!.prompt, /Outcome: done \(moved to Done by the user; not reviewed by the lead\)/)
    assert.equal(req(r.id).results, 1, 'the interrupted one is not called again on its own')
  })

  await step('the lead on Claude Code: the answer is made like its review (same adapter path)', async () => {
    getDb()
      .prepare("INSERT INTO providers (id, kind, label, model, cli_path, is_default) VALUES ('cc-test', 'claude-cli', 'Claude Code', 'opus', 'claude', 0)")
      .run()
    getDb().prepare("UPDATE agents SET provider_id = 'cc-test' WHERE id = ?").run(lead.id)
    const seen: RunContext[] = []
    getAdapter('claude-cli').run = async (ctx: RunContext) => {
      seen.push(ctx)
      if (ctx.mode === 'chat') return { text: 'On it.\n```tasks\n' + JSON.stringify(plan) + '\n```', ...usage }
      if (ctx.system.includes(WRAP)) return { text: good(ctx), ...usage }
      return { text: '{"approved": true, "note": "ok", "summary": "Fine."}', ...usage }
    }
    const { r } = await ask('Check the print styles', ['check the print styles'], [team[0]])
    await until(() => req(r.id).results === 1, 'answered')
    const wrapCall = seen.find((c) => c.system.includes(WRAP))!
    assert.equal(wrapCall.mode, 'review')
    assert.equal(wrapCall.mcpConfigPath, undefined)
    assert.equal(answers(p.id, r.id)[0].senderId, lead.id)
  })

  console.log(`requestWrap e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
