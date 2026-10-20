// Drafts before the saved list arrives: edits are kept per field and nothing is saved until the list is merged; a
// text-only edit keeps the saved attachments. Real src/renderer/src/lib/drafts.ts.
import './stubs/window'
import assert from 'node:assert/strict'
import { draftKey, loadDrafts, setDraft, useDrafts } from '@/lib/drafts'
import { done, F, fake, later, P, saves, step, wait } from './kit'

const draft = (ch = 'general') => useDrafts.getState().drafts[draftKey(P, ch)]

async function main(): Promise<void> {
  const list = later<unknown[]>()
  fake.handlers['drafts:list'] = () => list.promise
  fake.handlers['drafts:save'] = () => undefined
  const loading = loadDrafts()

  await step('before the list: a text edit is shown but not saved (the attachments are not known yet)', async () => {
    setDraft(P, 'general', { text: 'new text' })
    setDraft(P, 'agent:n', { files: [F('f3')] })
    setDraft(P, 'agent:n', { files: [F('f3'), F('f4')] })
    setDraft(P, 'agent:n', { files: [F('f4')] }) // f3 added and removed again
    assert.equal(draft()?.text, 'new text')
    await wait(450) // past the typing delay: still nothing written
    assert.equal(saves().length + saves('agent:n').length, 0, 'nothing saved yet')
  })

  await step('the list arrives (old text + F1): new text and F1 both stay; then saved once, merged', async () => {
    list.resolve([
      { projectId: P, channel: 'general', text: 'old text', files: [F('f1')] },
      { projectId: P, channel: 'agent:n', text: 'dm', files: [F('f2'), F('f3')] },
      { projectId: P, channel: 'task:t', text: 'untouched', files: [] }
    ])
    await loading
    assert.equal(draft()?.text, 'new text')
    assert.deepEqual(draft()?.files.map((f) => f.id), ['f1'])
    assert.deepEqual(saves(), [{ projectId: P, channel: 'general', text: 'new text', files: [F('f1')] }])
  })

  await step('attachments: the saved ones stay, the one added meanwhile joins, the one removed meanwhile stays gone', () => {
    assert.equal(draft('agent:n')?.text, 'dm')
    assert.deepEqual(draft('agent:n')?.files.map((f) => f.id), ['f2', 'f4'])
    assert.deepEqual(saves('agent:n').at(-1)?.files.map((f) => f.id), ['f2', 'f4'])
  })

  await step('an untouched draft comes as saved and is not written again', () => {
    assert.equal(draft('task:t')?.text, 'untouched')
    assert.equal(saves('task:t').length, 0)
  })

  await step('after the list: edits save again', async () => {
    setDraft(P, 'general', { text: 'later' }, true)
    assert.equal(saves().at(-1)?.text, 'later')
    assert.deepEqual(saves().at(-1)?.files.map((f) => f.id), ['f1'])
  })
  done('drafts-load')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
