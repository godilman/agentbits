// The live feed shows one line per event; the shown agent status is the same on every screen. Real renderer modules.
import './stubs/window'
import assert from 'node:assert/strict'
import type { Message } from '@shared/types'
import { dedupeFeed } from '@/lib/feed'
import { shownStatus } from '@/lib/format'
import { done, step } from './kit'

let n = 0
const msg = (channel: string, content: string, senderId: string | null, at: number, event?: string, senderType?: Message['senderType']): Message =>
  ({
    id: `m${++n}`,
    projectId: 'p',
    channel,
    senderType: senderType ?? (senderId ? 'agent' : 'system'),
    senderId,
    content,
    createdAt: new Date(1_000_000 + at).toISOString(),
    meta: event ? { event } : null
  }) as Message
const shown = (ms: Message[]): string[] => dedupeFeed(ms).map((m) => `${m.channel}:${m.content}`)

async function main(): Promise<void> {
  await step('one event posted to #general and the task thread (shared meta.event): shown once, the #general line', () => {
    const tt = msg('task:t1', 'Approved: looks good', 'lead', 0, 'e1')
    const g = msg('general', 'TA-1 approved (Nehir): looks good', 'lead', 20, 'e1')
    assert.deepEqual(shown([tt, g]), ['general:TA-1 approved (Nehir): looks good'])
  })
  await step('a race result to #general and two task threads: one line', () => {
    const ms = [msg('general', 'TA-1 won over TA-2', 'lead', 0, 'e2'), msg('task:t1', 'TA-1 won over TA-2', 'lead', 0, 'e2'), msg('task:t2', 'TA-1 won over TA-2', 'lead', 0, 'e2')]
    assert.deepEqual(shown(ms), ['general:TA-1 won over TA-2'])
  })
  await step('the review: a lead note in the task thread and a different #general message naming that task both stay', () => {
    const tt = msg('task:t1', 'Bu görev için yalnız testleri çalıştır', 'lead', 0)
    const g = msg('general', 'TA-1 dağıtımı ertelendi; sunucuya dokunma', 'lead', 1000)
    assert.equal(dedupeFeed([tt, g]).length, 2)
  })
  await step('the review: "TA-11 approved" in #general does not hide a TA-1 note', () => {
    const tt = msg('task:t1', 'Not: önce yedek al', 'lead', 0)
    const g = msg('general', 'TA-11 onaylandı', 'lead', 500)
    assert.equal(dedupeFeed([tt, g]).length, 2)
  })
  await step('the review: a user note in a task thread and a system #general event (both sender null) both stay', () => {
    const user = msg('task:t1', 'Şunu da ekle', null, 0, undefined, 'user')
    const sys = msg('general', '🔀 TA-1: merged', null, 300)
    assert.equal(dedupeFeed([user, sys]).length, 2)
  })
  await step('the same text in two task threads (two events) and repeated same text without an event id: all stay', () => {
    const a = msg('task:t1', 'Tests passed', 'w', 0)
    const b = msg('task:t2', 'Tests passed', 'w', 10)
    const c = msg('task:t1', 'Tests passed', 'w', 20)
    assert.equal(dedupeFeed([a, b, c]).length, 3)
    assert.equal(dedupeFeed([msg('task:t1', 'x', 'w', 0, 'e3'), msg('task:t2', 'x', 'w', 0, 'e4')]).length, 2)
  })
  await step('a run waiting for approval or paused is not "working" or "idle" anywhere', () => {
    const a = { id: 'a1', status: 'idle' as const }
    assert.equal(shownStatus(a, [{ agentId: 'a1', status: 'awaiting_approval' }]).label, 'agentStatus.awaitingApproval')
    assert.equal(shownStatus({ ...a, status: 'working' }, [{ agentId: 'a1', status: 'paused' }]).label, 'agentStatus.paused')
    assert.equal(shownStatus({ ...a, status: 'working' }, [{ agentId: 'other', status: 'paused' }]).label, 'agentStatus.working')
  })
  done('feed')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
