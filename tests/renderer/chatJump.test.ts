// "Show in chat" from Needs you: the target card is shown even when it is older than the loaded history — fetched only
// from its own project's channel, merged into the history (nothing loaded is dropped, drafts untouched), then scrolled to
// and focused for the keyboard. A deleted card is said; nothing changes then.
import './stubs/dom'
import assert from 'node:assert/strict'
import { El } from './stubs/dom'
import { jumpStep, mergeHistory, type JumpEnv, type JumpTarget } from '@/lib/chatJump'
import type { Message } from '@shared/types'
import { done, fake, step } from './kit'

const msg = (id: string, at: string, extra: Partial<Message> = {}): Message =>
  ({ id, channel: 'general', senderType: 'system', senderId: null, content: id, meta: null, createdAt: at, projectId: 'p1', ...extra }) as Message

async function main(): Promise<void> {
  // The loaded tail of #general (the newest), and the store's history it lives in.
  const history: Record<string, Message[]> = { 'p1:general': [msg('m200', '2026-10-21T10:00:00Z'), msg('m201', '2026-10-21T10:01:00Z')] }
  const toasts: string[] = []
  const rendered = new Map<string, El & { scrolled?: boolean }>()
  const env = (over: Partial<JumpEnv> = {}): JumpEnv => ({
    activeProjectId: 'p1',
    channel: 'general',
    loaded: history['p1:general'],
    setChannel: (c) => void toasts.push(`channel ${c}`),
    addMessages: (p, c, ms) => void (history[`${p}:${c}`] = mergeHistory(history[`${p}:${c}`] ?? [], ms)),
    element: (id) => {
      if (!history['p1:general'].some((m) => m.id === id)) return null
      const el = rendered.get(id) ?? Object.assign(new El(`msg-${id}`, 'auto', true), { scrollIntoView: () => void (el.scrolled = true) })
      rendered.set(id, el)
      return el as never
    },
    toast: (_l, text) => void toasts.push(text),
    goneText: 'chat:jump.gone',
    ...over
  })
  const old: JumpTarget = { projectId: 'p1', channel: 'general', id: 'q1card' }

  await step('a loaded card: scrolled to and focused (keyboard users land on it); nothing fetched', async () => {
    fake.calls.length = 0
    const s = await jumpStep({ ...old, id: 'm201' }, env(), false)
    assert.equal(s, 'shown')
    assert.equal(rendered.get('m201')!.scrolled, true)
    assert.equal((globalThis as any).document.activeElement, rendered.get('m201'))
    assert.equal(fake.calls.length, 0)
  })

  await step('another channel: it is opened first; a project still opening: wait (nothing fetched, nothing switched)', async () => {
    toasts.length = 0
    assert.equal(await jumpStep({ ...old, channel: 'agent:a1' }, env(), false), 'switched')
    assert.deepEqual(toasts, ['channel agent:a1'])
    assert.equal(await jumpStep(old, env({ activeProjectId: 'p2' }), false), 'wait')
    assert.equal(await jumpStep(old, env({ loaded: undefined }), false), 'wait')
    assert.equal(fake.calls.length, 0)
  })

  await step('an old open question, older than the loaded history: its part is fetched from its own channel and added; then shown and focused', async () => {
    fake.calls.length = 0
    fake.handlers['messages:from'] = (p: string, c: string, id: string) => {
      assert.deepEqual([p, c, id], ['p1', 'general', 'q1card'])
      // From the card to the newest — overlapping the loaded tail (m200 with older meta).
      return [msg('q1card', '2026-10-01T09:00:00Z', { meta: { question: { id: 'q1', key: 'Q-1', status: 'open' } } }), msg('m150', '2026-10-15T09:00:00Z'), msg('m200', '2026-10-21T10:00:00Z', { content: 'stale copy' })]
    }
    const live = msg('m202', '2026-10-21T10:02:00Z') // arrived meanwhile
    history['p1:general'] = [...history['p1:general'], live]
    const first = await jumpStep(old, env(), false)
    assert.equal(first, 'loading')
    assert.deepEqual(history['p1:general'].map((m) => m.id), ['q1card', 'm150', 'm200', 'm201', 'm202'], 'merged in order, nothing dropped')
    assert.equal(history['p1:general'].find((m) => m.id === 'm200')!.content, 'm200', 'the loaded copy wins')
    const second = await jumpStep(old, env(), true)
    assert.equal(second, 'shown')
    assert.equal((globalThis as any).document.activeElement, rendered.get('q1card'))
    assert.ok(!fake.calls.some((c) => c.name === 'drafts:save' || c.name === 'drafts:clear'), 'drafts untouched')
    assert.equal(fake.calls.filter((c) => c.name === 'messages:from').length, 1, 'fetched once')
  })

  await step('a deleted card (or another project\'s): said, history and focus left as they were', async () => {
    const before = history['p1:general'].map((m) => m.id)
    const focused = (globalThis as any).document.activeElement
    toasts.length = 0
    fake.handlers['messages:from'] = () => {
      throw new Error('That message is no longer in this chat (deleted, or the chat was cleared)')
    }
    assert.equal(await jumpStep({ ...old, id: 'gone' }, env(), false), 'gone')
    assert.deepEqual(toasts, ['That message is no longer in this chat (deleted, or the chat was cleared)'])
    assert.deepEqual(history['p1:general'].map((m) => m.id), before)
    assert.equal((globalThis as any).document.activeElement, focused)
    // Fetched once already and still not there: no second fetch, said.
    toasts.length = 0
    const n = fake.calls.length
    assert.equal(await jumpStep({ ...old, id: 'gone' }, env(), true), 'gone')
    assert.equal(fake.calls.length, n)
    assert.deepEqual(toasts, ['chat:jump.gone'])
  })

  await step('merging: each message once, oldest first, loaded copies kept', () => {
    const a = msg('a', '2026-01-01T00:00:00Z')
    const b = msg('b', '2026-01-02T00:00:00Z', { content: 'loaded b' })
    const out = mergeHistory([b], [a, msg('b', '2026-01-02T00:00:00Z', { content: 'fetched b' })])
    assert.deepEqual(out.map((m) => [m.id, m.content]), [['a', 'a'], ['b', 'loaded b']])
    assert.deepEqual(mergeHistory([a], []), [a])
  })

  done('chatJump')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
