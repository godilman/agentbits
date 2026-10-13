/** Review verdict parsing: only a real boolean approves (security review 2026-10-13). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { parseReview } from '../src/shared/review.ts'

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
console.log('review: verdict parsing ok')
