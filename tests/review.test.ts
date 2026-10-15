/** Review verdict parsing: only a real boolean approves (security review 2026-10-13). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { acceptanceList, judgeCriteria, parseRaceVerdict, parseReview, pickRival } from '../src/shared/review.ts'

const no = (text: string): void => assert.equal(parseReview(text).approved, false, text)
assert.deepEqual(parseReview('Looks good.\n{"approved": true, "note": "ok"}'), { approved: true, note: 'ok', valid: true })
no('{"approved": false, "note": "missing tests"}')
no('{"approved": "false"}')
no('{"approved": "true"}')
no('not approved')
no('onaylanmadı, testler eksik')
no('{"note": "approved"}')
no('{"approved": 1}')
no('{ broken json approved')
no('')
assert.equal(parseReview('not approved').valid, false)
assert.equal(parseReview('{"approved": false, "note": "x"}').valid, true)
// several JSON blocks that disagree: no verdict (the user decides)
assert.deepEqual(parseReview('Example: {"approved": true}\nVerdict: {"approved": false, "note": "fix"}').valid, false)
no('Example: {"approved": true}\nVerdict: {"approved": false, "note": "fix"}')
// review 2026-10-13 (2nd pass): a nested approved:true must not override the outer false
no('{"approved": false, "note": "x", "meta": {"approved": true}}')
// any second "approved" in the verdict object (nested or repeated) makes it ambiguous: the user decides
assert.equal(parseReview('{"approved": false, "note": "x", "meta": {"approved": true}}').valid, false)
no('{"note": "quoted", "details": {"approved": true}}')
no('{"approved": false, "approved": true}')
assert.equal(parseReview('{"approved": false, "approved": true}').valid, false)
// a verdict string inside a string is not a verdict
no('{"note": "{\\"approved\\": true}"}')
// agreeing repeats are fine
assert.equal(parseReview('{"approved": true, "note": "a"} ... {"approved": true, "note": "b"}').note, 'b')
assert.equal(parseReview('```json\n{"approved": true, "note": "fine"}\n```').approved, true)
// race mode: which of two attempts wins
assert.deepEqual(parseRaceVerdict('B is more complete.\n{"winner": "B", "note": "tests included"}'), { winner: 'B', note: 'tests included', valid: true })
for (const bad of ['{"winner": "b"}', '{"winner": "C"}', '{"winner": 2}', 'B wins', '{"winner": "A", "winner": "B"}', '{"note": "x", "detail": {"winner": "A"}}', '{"winner": "A"} {"winner": "B"}', '']) {
  assert.equal(parseRaceVerdict(bad).valid, false, bad)
}
assert.equal(parseRaceVerdict('{"winner": "A", "note": "a"} {"winner": "A", "note": "b"}').note, 'b')
// Neither attempt does the task: "none" is a verdict; per-attempt criteria checks come along.
assert.deepEqual(parseRaceVerdict('{"winner": "none", "note": "both miss tests"}'), { winner: 'none', note: 'both miss tests', valid: true })
const rv = parseRaceVerdict('{"winner": "A", "note": "x", "criteriaA": [{"met": true}], "criteriaB": [{"met": false}]}')
assert.deepEqual(judgeCriteria(['has tests'], rv.criteriaA)?.[0].met, true)
assert.deepEqual(judgeCriteria(['has tests'], rv.criteriaB)?.[0].met, false)
assert.equal(judgeCriteria(['has tests'], parseRaceVerdict('{"winner": "A"}').criteriaA), null)

// Race rival: never the same provider+model; another provider kind first; nobody suitable → null.
const c = (id: string, key: string): { id: string; key: string } => ({ id, key })
assert.equal(pickRival('anthropic||opus', [c('a', 'anthropic||opus')]), null)
assert.equal(pickRival('anthropic||opus', []), null)
assert.equal(pickRival('anthropic||opus', [c('a', 'anthropic||sonnet'), c('b', 'codex-cli||gpt')])?.id, 'b')
assert.equal(pickRival('anthropic||opus', [c('a', 'anthropic||opus'), c('b', 'anthropic||sonnet')])?.id, 'b')
assert.equal(pickRival('openai|https://x/v1|m', [c('a', 'openai|http://127.0.0.1:11434/v1|m')])?.id, 'a')
// Acceptance criteria: list markers stripped; each criterion needs a real boolean check, in the right count.
assert.deepEqual(acceptanceList('- Tests pass\n2) Turkish UI\n\n[x] don\'t touch db/\n'), ['Tests pass', 'Turkish UI', "don't touch db/"])
const crit = ['Tests pass', 'Turkish UI']
const v = parseReview('{"approved": true, "note": "ok", "criteria": [{"met": true}, {"met": false, "note": "English labels"}]}')
assert.deepEqual(judgeCriteria(crit, v.criteria), [{ text: 'Tests pass', met: true, note: '' }, { text: 'Turkish UI', met: false, note: 'English labels' }])
assert.equal(judgeCriteria(crit, undefined), null)
assert.equal(judgeCriteria(crit, [{ met: true }]), null)
assert.equal(judgeCriteria(crit, [{ met: true }, { met: 'yes' }]), null)
assert.deepEqual(judgeCriteria([], undefined), null)
console.log('review: verdict and race verdict parsing ok')
