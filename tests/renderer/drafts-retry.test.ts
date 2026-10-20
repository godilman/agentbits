// Drafts when the saved list can't be read: shown, tried again, and the retry merges the same safe way.
// Real src/renderer/src/lib/drafts.ts.
import './stubs/window'
import assert from 'node:assert/strict'
import { draftKey, loadDrafts, setDraft, useDrafts } from '@/lib/drafts'
import { toasts } from './stubs/store'
import { done, F, fake, P, saves, step, wait } from './kit'

const draft = () => useDrafts.getState().drafts[draftKey(P, 'general')]

async function main(): Promise<void> {
  let fails = 1
  fake.handlers['drafts:list'] = () => {
    if (fails-- > 0) throw new Error('disk busy')
    return [{ projectId: P, channel: 'general', text: 'saved', files: [F('f1')] }]
  }
  fake.handlers['drafts:save'] = () => undefined

  await step('a failed list is shown, nothing is assumed (no save, not loaded)', async () => {
    await loadDrafts()
    assert.ok(toasts.some((x) => x.level === 'error' && /draftsLoadFailed/.test(x.text) && /disk busy/.test(x.text)))
    assert.equal(useDrafts.getState().loaded, false)
    setDraft(P, 'general', { text: 'typed while it failed' })
    assert.equal(saves().length, 0)
  })

  await step('the retry merges: the typed text and the saved attachment both stay, then it is saved', async () => {
    await wait(5300)
    assert.equal(useDrafts.getState().loaded, true)
    assert.equal(draft()?.text, 'typed while it failed')
    assert.deepEqual(draft()?.files.map((f) => f.id), ['f1'])
    assert.deepEqual(saves().at(-1), { projectId: P, channel: 'general', text: 'typed while it failed', files: [F('f1')] })
  })
  done('drafts-retry')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
