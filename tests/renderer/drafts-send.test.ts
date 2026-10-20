// Drafts after a send: only what was sent goes, from the draft it was sent from. Real src/renderer/src/lib/drafts.ts.
import './stubs/window'
import assert from 'node:assert/strict'
import { clearSent, draftKey, draftSnapshot, loadDrafts, setDraft, useDrafts } from '@/lib/drafts'
import { done, F, fake, P, saves, step, wait } from './kit'

const draft = (ch = 'general') => useDrafts.getState().drafts[draftKey(P, ch)]

async function main(): Promise<void> {
  fake.handlers['drafts:list'] = () => []
  fake.handlers['drafts:save'] = () => undefined
  await loadDrafts()

  await step('a send clears its text and its attachments', () => {
    setDraft(P, 'general', { text: 'A', files: [F('a')] })
    const snap = draftSnapshot(P, 'general')
    clearSent(P, 'general', { textRev: snap.textRev, fileIds: ['a'] })
    assert.equal(draft(), undefined)
    assert.deepEqual(saves().at(-1), { projectId: P, channel: 'general', text: '', files: [] })
  })

  await step('A sent, box emptied, B typed, A succeeds: B stays (the edit mark is never reused)', async () => {
    setDraft(P, 'general', { text: 'A' })
    const snap = draftSnapshot(P, 'general')
    setDraft(P, 'general', { text: '' })
    assert.equal(draft(), undefined, 'the emptied draft is gone')
    setDraft(P, 'general', { text: 'B' })
    clearSent(P, 'general', { textRev: snap.textRev, fileIds: [] })
    assert.equal(draft()?.text, 'B')
    await wait(450) // typing is saved after a moment
    assert.equal(saves().at(-1)?.text, 'B', 'B is what gets saved')
  })

  await step('A sent, emptied, the same A typed again: a new edit, kept', () => {
    setDraft(P, 'general', { text: '' })
    setDraft(P, 'general', { text: 'A' })
    const snap = draftSnapshot(P, 'general')
    setDraft(P, 'general', { text: '' })
    setDraft(P, 'general', { text: 'A' })
    clearSent(P, 'general', { textRev: snap.textRev, fileIds: [] })
    assert.equal(draft()?.text, 'A')
  })

  await step('edited during the send: the edit stays; a file added meanwhile stays', () => {
    setDraft(P, 'general', { text: 'first', files: [F('x')] })
    const snap = draftSnapshot(P, 'general')
    setDraft(P, 'general', { text: 'second' })
    setDraft(P, 'general', { files: [F('x'), F('y')] })
    clearSent(P, 'general', { textRev: snap.textRev, fileIds: ['x'] })
    assert.equal(draft()?.text, 'second')
    assert.deepEqual(draft()?.files.map((f) => f.id), ['y'])
  })

  await step('a send from one channel leaves another channel alone', () => {
    setDraft(P, 'general', { text: 'in A', files: [F('a1')] })
    const snap = draftSnapshot(P, 'general')
    setDraft(P, 'agent:n', { text: 'in B', files: [F('b1')] })
    clearSent(P, 'general', { textRev: snap.textRev, fileIds: ['a1'] })
    assert.equal(draft('agent:n')?.text, 'in B')
    assert.deepEqual(draft('agent:n')?.files.map((f) => f.id), ['b1'])
    assert.equal(draft(), undefined)
  })

  await step('a suggestion sent (not the draft text): the typed text stays', () => {
    setDraft(P, 'general', { text: 'my words' })
    clearSent(P, 'general', { textRev: -1, fileIds: [] })
    assert.equal(draft()?.text, 'my words')
  })
  done('drafts-send')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
