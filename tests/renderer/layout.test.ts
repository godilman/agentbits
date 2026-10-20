// Narrow windows: when the side panel folds and when the guide opens over the content instead of beside it.
import assert from 'node:assert/strict'
import { fitLayout, MAIN_MIN } from '@/lib/layout'
import { done, step } from './kit'

async function main(): Promise<void> {
  await step('the board needs four 230 px columns', () => assert.equal(MAIN_MIN, 988))
  await step('guide closed: the panel folds only when the board would not fit beside it', () => {
    assert.deepEqual(fitLayout(1366, 300, false), { folded: false, guideOverlay: false })
    assert.deepEqual(fitLayout(1100, 300, false), { folded: true, guideOverlay: false })
  })
  await step('a wide window: the guide stays beside the content, the panel stays open', () => {
    assert.deepEqual(fitLayout(1700, 300, true), { folded: false, guideOverlay: false })
  })
  await step('the guide fits beside only with the panel folded: folded, guide beside (as before)', () => {
    assert.deepEqual(fitLayout(1500, 300, true), { folded: true, guideOverlay: false })
  })
  await step('the board would get too narrow beside the guide: the guide opens over it and the panel is not folded for it', () => {
    assert.deepEqual(fitLayout(1366, 300, true), { folded: false, guideOverlay: true })
    assert.deepEqual(fitLayout(1100, 300, true), { folded: true, guideOverlay: true })
  })
  await step('a wider saved panel folds earlier; its width is an input, never changed', () => {
    assert.equal(fitLayout(1366, 400, false).folded, true)
    assert.equal(fitLayout(1388, 400, false).folded, false)
  })
  done('layout')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
