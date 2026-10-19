// Live chat replies end to end (main process): start / update / complete / error / cancelled, one id per reply, the
// per-reply 60 ms limit, nothing after the end, hidden blocks never streamed, the stored message tied to its stream,
// and Claude Code's token stream (--include-partial-messages, decided before the run; never started twice).
// Real SQLite, real orchestrator and IPC handlers; providers are stubs (a fake `claude` script for Claude Code).
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, providersRepo, settingsRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { onEvent } from '../../src/main/events'
import { getAdapter } from '../../src/main/providers'
import type { RunContext } from '../../src/main/providers/types'
import type { ReplyStreamEvent } from '../../src/shared/replyStream'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, what: string, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(10)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve((handlers as any)[name](...args))

// Every stream event, with the time it was sent.
const events: (ReplyStreamEvent & { at: number })[] = []
onEvent((e) => {
  if (e.type === 'reply:stream') {
    const { type: _t, ...ev } = e
    events.push({ ...ev, at: Date.now() })
  }
})
const of = (replyId: string) => events.filter((e) => e.replyId === replyId)
const replyIdsFor = (agentId: string) => [...new Set(events.filter((e) => e.agentId === agentId).map((e) => e.replyId))]
const lastState = (replyId: string) => of(replyId).at(-1)?.state

// The Demo adapter's place is taken by a script per step.
let behave: (ctx: RunContext) => Promise<string> = async () => 'tamam'
getAdapter('mock').run = async (ctx: RunContext) => ({ text: await behave(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 })

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p1 = await call('projects:save', { name: 'P1', rootPath: mkdtempSync(join(tmpdir(), 'ab-rs1-')), unitIds: [tpl.unitId] })
  const p2 = await call('projects:save', { name: 'P2', rootPath: mkdtempSync(join(tmpdir(), 'ab-rs2-')), unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, memoryLearn: 'off' })
  orchestrator.init()
  const ada = agentsRepo.save({ name: 'Ada', role: 'Developer' } as never)
  const channel = `agent:${ada.id}`
  const send = (text: string, pid = p1.id) => call('messages:send', channel, text, pid)
  const stored = (pid: string) => messagesRepo.list(channel, 50, pid).filter((m) => m.senderType === 'agent')

  await step('a reply streams: start → updates → complete; the stored message carries its id and the same text', async () => {
    behave = async (ctx) => {
      const parts = ['Merhaba, ', 'bu bir ', 'canlı ', 'yanıt.']
      for (const p of parts) {
        ctx.onText(p)
        await wait(80)
      }
      return parts.join('')
    }
    await send('selam')
    const [rid] = replyIdsFor(ada.id)
    await until(() => lastState(rid) === 'complete', 'complete')
    const evs = of(rid)
    assert.equal(evs[0].state, 'start')
    assert.ok(evs.filter((e) => e.state === 'update').length >= 2, 'several updates')
    const done = evs.at(-1)!
    const msg = stored(p1.id).at(-1)!
    assert.equal(done.messageId, msg.id)
    assert.equal(msg.meta?.replyId, rid)
    assert.equal(msg.content, 'Merhaba, bu bir canlı yanıt.')
    assert.ok(msg.content.startsWith(evs.filter((e) => e.state === 'update').at(-1)!.text!), 'the last update is the start of the stored text')
  })

  await step('60 ms per reply: a burst of chunks makes few updates; nothing comes after the end', async () => {
    const before = events.length
    behave = async (ctx) => {
      for (let i = 0; i < 200; i++) ctx.onText('x')
      await wait(150)
      for (let i = 0; i < 200; i++) ctx.onText('y')
      return 'x'.repeat(200) + 'y'.repeat(200)
    }
    await send('çok parça')
    await until(() => events.slice(before).some((e) => e.state === 'complete'), 'complete')
    const rid = events.slice(before)[0].replyId
    const ups = of(rid).filter((e) => e.state === 'update')
    assert.ok(ups.length <= 3, `400 chunks → ${ups.length} updates`)
    for (let i = 1; i < ups.length; i++) assert.ok(ups[i].at - ups[i - 1].at >= 50, 'updates of one reply are spaced')
    await wait(200)
    assert.equal(of(rid).at(-1)!.state, 'complete', 'no timer fires after the end')
  })

  await step('hidden blocks never stream, also split across chunks; normal code blocks do', async () => {
    const before = events.length
    const reply = 'Bakalım.\n```js\nconst a = 1\n```\nSonra ```ta' + 'sks\n[{"title":"GIZLI-GOREV"}]\n```\n```learn\n[{"text":"GIZLI-OGRENME"}]\n```\nBitti.'
    behave = async (ctx) => {
      for (const c of reply.match(/[\s\S]{1,3}/g)!) {
        ctx.onText(c)
        await wait(7)
      }
      return reply
    }
    await send('plan')
    await until(() => events.slice(before).some((e) => e.state === 'complete'), 'complete')
    const rid = events.slice(before)[0].replyId
    for (const e of of(rid)) assert.doesNotMatch(e.text ?? '', /GIZLI|```(t|ta|tas|task|tasks|l|le|lea|lear|learn)\s*$/, JSON.stringify(e.text))
    assert.ok(of(rid).some((e) => /```js\nconst a = 1/.test(e.text ?? '')), 'the code block streamed')
    assert.ok(of(rid).some((e) => e.hiding === 'tasks'), 'while the tasks block is written the bubble says so')
    assert.equal(stored(p1.id).at(-1)!.content, 'Bakalım.\n```js\nconst a = 1\n```\nSonra \n\nBitti.')
  })

  await step('two replies in the same channel at the same time: separate ids, each ends with its own message', async () => {
    const before = events.length
    behave = async (ctx) => {
      const me = ctx.prompt.includes('birinci') ? 'BIRINCI' : 'IKINCI'
      for (let i = 0; i < 4; i++) {
        ctx.onText(`${me}-${i} `)
        await wait(40)
      }
      return `${me} bitti`
    }
    await Promise.all([send('birinci soru'), send('ikinci soru')])
    await until(() => events.slice(before).filter((e) => e.state === 'complete').length === 2, 'two completes')
    const ids = [...new Set(events.slice(before).map((e) => e.replyId))]
    assert.equal(ids.length, 2)
    for (const id of ids) {
      const texts = of(id).map((e) => e.text ?? '').join('|')
      assert.ok(!(texts.includes('BIRINCI') && texts.includes('IKINCI')), 'a reply never carries the other one’s text')
      const msg = stored(p1.id).find((m) => m.id === of(id).at(-1)!.messageId)!
      assert.equal(msg.meta?.replyId, id)
    }
  })

  await step('error before the first chunk: start → error, no update, no agent message', async () => {
    const before = events.length
    const msgs = stored(p1.id).length
    behave = async () => {
      throw new Error('sağlayıcı yanıt vermedi')
    }
    await send('hata')
    await until(() => events.slice(before).some((e) => e.state === 'error'), 'error')
    const rid = events.slice(before)[0].replyId
    assert.deepEqual(of(rid).map((e) => e.state), ['start', 'error'])
    assert.equal(stored(p1.id).length, msgs)
  })

  await step('cancel racing the last chunk: cancelled is the last word, late chunks are dropped, nothing stored', async () => {
    const before = events.length
    const msgs = stored(p1.id).length
    let ctxRef: RunContext | null = null
    behave = (ctx) =>
      new Promise((resolve) => {
        ctxRef = ctx
        ctx.onText('yarım ')
        // The provider keeps talking after the stop (longer than one 60 ms window), returns as if nothing happened,
        // and still sends a chunk after that.
        ctx.signal.addEventListener('abort', () => {
          ctx.onText('geç parça')
          setTimeout(() => ctx.onText('geç ikinci'), 70)
          setTimeout(() => resolve('yarım geç parça'), 140)
          setTimeout(() => ctx.onText('daha geç'), 200)
        })
      })
    await send('iptal edilecek')
    await until(() => !!ctxRef && events.slice(before).length > 0, 'started')
    ctxRef!.onText('son parça')
    await orchestrator.stopProject(p1.id)
    await wait(400)
    const rid = events.slice(before)[0].replyId
    const evs = of(rid)
    assert.equal(evs.at(-1)!.state, 'cancelled')
    assert.equal(evs.filter((e) => e.state === 'cancelled' || e.state === 'complete' || e.state === 'error').length, 1, 'one end')
    assert.ok(!evs.some((e) => /geç/.test(e.text ?? '')), 'no chunk after the stop')
    assert.equal(stored(p1.id).length, msgs)
  })

  await step('replies of two projects at once carry their own project (the chat shows each where it belongs)', async () => {
    const before = events.length
    behave = async (ctx) => {
      ctx.onText(ctx.prompt.includes('P2 sorusu') ? 'p2 cevabı' : 'p1 cevabı')
      await wait(100)
      return ctx.prompt.includes('P2 sorusu') ? 'p2 cevabı' : 'p1 cevabı'
    }
    await Promise.all([send('P1 sorusu', p1.id), send('P2 sorusu', p2.id)])
    await until(() => events.slice(before).filter((e) => e.state === 'complete').length === 2, 'two completes')
    for (const e of events.slice(before).filter((x) => x.text)) assert.equal(e.projectId === p2.id, e.text === 'p2 cevabı')
  })

  // Claude Code: a fake `claude` that answers --version / --help and prints stream-json. Windows can't run a script by
  // its #! line: there it is started through a .cmd shim, the way an npm-installed claude is.
  const win = process.platform === 'win32'
  const dir = mkdtempSync(join(tmpdir(), 'ab-claude-'))
  const script = join(dir, 'claude.js')
  const binary = (name: string): string => {
    if (!win) {
      const p = join(dir, name)
      writeFileSync(p, readFileSync(script))
      chmodSync(p, 0o755)
      return p
    }
    const p = join(dir, `${name}.cmd`)
    writeFileSync(p, '@node "%~dp0claude.js" %*\r\n')
    return p
  }
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2); const d = ${JSON.stringify(dir)}
if (a[0] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0) }
if (a[0] === '--help') { console.log(fs.existsSync(d + '/partial') ? 'Options:\\n  --include-partial-messages  Include partial message chunks' : 'Options:\\n  --print'); process.exit(0) }
fs.appendFileSync(d + '/runs', JSON.stringify(a) + '\\n')
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const text = 'Tamam.\\n\`\`\`tasks\\n[{"title":"GIZLI"}]\\n\`\`\`\\nBitti.'
process.stdin.resume(); process.stdin.on('end', async () => {
  out({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' })
  if (a.includes('--include-partial-messages')) {
    out({ type: 'stream_event', event: { type: 'message_start' } })
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    for (const c of text.match(/[\\s\\S]{1,4}/g)) { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } } }); await new Promise((r) => setTimeout(r, 15)) }
    out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
  }
  out({ type: 'assistant', message: { id: 'msg1', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } } })
  out({ type: 'result', result: text, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } })
})
`
  )
  const fake = binary('claude')
  const runs = (): string[][] => {
    try {
      return readFileSync(join(dir, 'runs'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }
  const cli = providersRepo.save({ kind: 'claude-cli', label: 'Claude Code', model: '', cliPath: fake } as never)
  const claudeAgent = agentsRepo.save({ name: 'Kod', role: 'Developer', providerId: cli.id } as never)
  const cliChannel = `agent:${claudeAgent.id}`

  await step('Claude Code without --include-partial-messages: no retry, one run, the reply still arrives whole', async () => {
    const before = events.length
    await call('messages:send', cliChannel, 'merhaba', p2.id)
    await until(() => events.slice(before).some((e) => e.state === 'complete' || e.state === 'error'), 'end', 15000)
    assert.equal(events.slice(before).at(-1)!.state, 'complete', JSON.stringify(events.slice(before).at(-1)))
    assert.equal(runs().length, 1, 'started once')
    assert.ok(!runs()[0].includes('--include-partial-messages'))
    assert.equal(messagesRepo.list(cliChannel, 10, p2.id).filter((m) => m.senderType === 'agent').at(-1)!.content, 'Tamam.\n\nBitti.')
  })

  await step('Claude Code with it (help says so, read before the run): token stream, hidden block never shown', async () => {
    writeFileSync(join(dir, 'partial'), '')
    // The answer of --help is cached per binary: a copy of the script is a new binary.
    const fake2 = binary('claude2')
    providersRepo.save({ cliPath: fake2 } as never, cli.id)
    const before = events.length
    await call('messages:send', cliChannel, 'tekrar', p2.id)
    await until(() => events.slice(before).some((e) => e.state === 'complete' || e.state === 'error'), 'end', 15000)
    const evs = events.slice(before)
    assert.equal(evs.at(-1)!.state, 'complete', JSON.stringify(evs.at(-1)))
    assert.ok(runs().at(-1)!.includes('--include-partial-messages'))
    assert.equal(runs().length, 2, 'one more run, no retry')
    const ups = evs.filter((e) => e.state === 'update')
    assert.ok(ups.length >= 2, `streamed in parts (${ups.length})`)
    for (const e of ups) assert.doesNotMatch(e.text ?? '', /GIZLI|```(t|ta|tas|task|tasks)\s*$/, JSON.stringify(e.text))
    assert.equal(messagesRepo.list(cliChannel, 10, p2.id).filter((m) => m.senderType === 'agent').at(-1)!.content, 'Tamam.\n\nBitti.')
  })

  orchestrator.shutdown()
  console.log(`replyStream e2e: ${count} steps ok`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
