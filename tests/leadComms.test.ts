/** Lead → team notes and report excerpts (only the lead talks to the team). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { MAX_LEAD_MESSAGES, MAX_LEAD_MESSAGE_CHARS, parseLeadMessages, reportExcerpt } from '../src/shared/leadComms.ts'

const msg = (body: string): string => `Sure.\n\`\`\`message\n${body}\n\`\`\`\nDone.`

assert.deepEqual(parseLeadMessages(msg('[{"task": "ta-12", "text": "  Use the 2025 prices.  "}]')), [{ task: 'TA-12', text: 'Use the 2025 prices.' }])
assert.deepEqual(parseLeadMessages(msg('{"task": "[WEB-3]", "text": "ok"}')), [{ task: 'WEB-3', text: 'ok' }])
// invalid items are dropped, valid ones kept
assert.deepEqual(
  parseLeadMessages(msg('[{"task": "TA-1"}, {"text": "no key"}, {"task": "TA-2", "text": ""}, {"task": "not a key", "text": "x"}, {"task": 5, "text": "x"}, {"task": "TA-3", "text": "keep"}]')),
  [{ task: 'TA-3', text: 'keep' }]
)
assert.deepEqual(parseLeadMessages(msg('{ broken')), [])
assert.deepEqual(parseLeadMessages('no block at all, task TA-1'), [])
// other block types are not messages
assert.deepEqual(parseLeadMessages('```tasks\n[{"task": "TA-1", "text": "x"}]\n```'), [])
// limits
const many = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ task: `TA-${i + 1}`, text: 'x' })))
assert.equal(parseLeadMessages(msg(many)).length, MAX_LEAD_MESSAGES)
assert.equal(parseLeadMessages(msg(JSON.stringify({ task: 'TA-1', text: 'y'.repeat(9000) })))[0].text.length, MAX_LEAD_MESSAGE_CHARS)

const report = '## Summary\nCompared five competitors.\n\n## What was done\n- a\n- b\n\n## Notes\nPrices for X are from 2024.'
assert.equal(reportExcerpt(report), 'Compared five competitors. · Notes: Prices for X are from 2024.')
assert.equal(reportExcerpt('## Özet\nBitti.\n\n## Notlar\nYok.'), 'Bitti. · Notes: Yok.') // i18n-ignore
assert.equal(reportExcerpt('plain text report'), 'plain text report')
assert.ok(reportExcerpt(`## Summary\n${'word '.repeat(300)}`, 100).length <= 100)
console.log('leadComms: messages and excerpts ok')
