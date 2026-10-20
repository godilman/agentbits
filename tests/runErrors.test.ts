/** Provider errors → kind (explained to the user in their language). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { errorDetail, runErrorKind } from '../src/shared/runErrors.ts'

const cases: [string, ReturnType<typeof runErrorKind>][] = [
  ['Anthropic 401: {"type":"authentication_error"}', 'auth'],
  ['Not logged in · Please run /login', 'auth'],
  ['The operation was aborted due to timeout', 'timeout'],
  ['Request timed out after 600s', 'timeout'],
  ['TypeError: fetch failed', 'network'],
  ['connect ECONNREFUSED 127.0.0.1:443', 'network'],
  ['getaddrinfo ENOTFOUND api.anthropic.com', 'network'],
  ['Anthropic 529: {"type":"overloaded_error"}', 'overloaded'],
  ['OpenAI 429: Rate limit reached', 'overloaded'],
  ['OpenAI 503 Service Unavailable', 'overloaded'],
  ['claude exit code 1: something broke', 'exit'],
  ['Unexpected token in JSON', 'other'],
  // Not auth: a broader pattern would pause every agent on these.
  ['403 Forbidden from the project API the agent called', 'other'],
  ['authentication module test failed', 'other']
]
for (const [raw, kind] of cases) assert.equal(runErrorKind(raw), kind, raw)

assert.equal(errorDetail('\n\nfirst line\nsecond'), 'first line')
assert.equal(errorDetail('x'.repeat(300)).length, 201)

console.log('runErrors: kinds ok')
