/** Transcript redaction of secret-looking text (security review #21). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { redactDeep, redactSecrets } from '../src/shared/redact.ts'

const gone = (input: string, secret: string): void => {
  const out = redactSecrets(input)
  assert.ok(!out.includes(secret), `${input} → ${out}`)
  assert.ok(out.includes('••••'), out)
}
gone('key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnopqrstuvwxyz')
gone('OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456', 'GhIjKlMnOpQrStUvWxYz')
gone('token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB', '0123456789abcdefghijklmnopqrstuvwxyz')
gone('github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz')
gone('aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'IOSFODNN7EXAMPLE')
gone('AIzaSyA-1234567890abcdefghijklmnopqrstu', '1234567890abcdefghijklmnopqrstu')
gone('xoxb-123456789012-abcdefghijkl', '123456789012-abcdefghijkl')
gone('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'dozjgNryP4J3jVmNHl0w5N')
gone('postgres://app:S3cr3t!pass@db.internal:5432/shop', 'S3cr3t!pass')
gone('DB_PASSWORD=hunter2xyz', 'hunter2xyz')
gone('{"client_secret": "abc123def456"}', 'abc123def456')
gone("password: 'p@ssw0rd'", 'p@ssw0rd')
gone('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA')

// ordinary text is left alone
for (const ok of [
  'Read src/components/LoginForm.tsx',
  'SELECT id, name FROM users WHERE token_count > 5',
  'The password field must be at least 8 characters.',
  'git commit -m "fix token refresh"',
  'https://github.com/godilman/agentbits',
  'sk-short',
  '✓ 12 tests passed'
]) {
  assert.equal(redactSecrets(ok), ok, ok)
}

assert.deepEqual(redactDeep({ prompt: 'use DB_PASSWORD=hunter2xyz', n: 3, list: ['ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'] }), {
  prompt: 'use DB_PASSWORD=••••',
  n: 3,
  list: ['ghp_••••']
})
console.log('redact: transcript secrets masked')
