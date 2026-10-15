/** Graph memory: ```learn blocks and memory refs. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { memoryRef, parseLearn } from '../src/shared/memoryGraph.ts'

assert.equal(memoryRef('3FA9C1D2-0000-4000-8000-000000000000'), 'm:3fa9c1')

const reply = (json: string): string => `Tamam.\n\n\`\`\`learn\n${json}\n\`\`\``
assert.deepEqual(parseLearn(reply('[{"text": "Kısa plan ister", "kind": "preference", "topics": ["Çalışma"], "replaces": "m:3fa9c1"}]')), [
  { text: 'Kısa plan ister', kind: 'preference', topics: ['Çalışma'], replaces: 'm:3fa9c1' }
])
// One object instead of a list; unknown kind → preference; bad ref and non-string topics dropped.
assert.deepEqual(parseLearn(reply('{"text": "PHP 5.5", "kind": "other", "topics": ["PHP", 3, " "], "replaces": "m:zz"}')), [
  { text: 'PHP 5.5', kind: 'preference', topics: ['PHP'], replaces: null }
])
assert.equal(parseLearn(reply('[{"text": "a fact", "kind": "fact"}]'))[0].kind, 'fact')
// Malformed, empty or oversized items are ignored; at most 5 items.
for (const bad of ['not json', '[{"kind": "fact"}]', '[{"text": ""}]', `[{"text": "${'x'.repeat(501)}"}]`, '[null, 3]']) assert.deepEqual(parseLearn(reply(bad)), [], bad)
assert.equal(parseLearn(reply(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ text: `t${i}` }))))).length, 5)
// Other fenced blocks are not learn blocks.
assert.deepEqual(parseLearn('```tasks\n[{"text": "x"}]\n```'), [])
console.log('memoryGraph: learn blocks and refs ok')
