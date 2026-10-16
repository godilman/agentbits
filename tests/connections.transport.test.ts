// How a database connection may cross the network (src/shared/connectionRules.ts, src/main/connections/transport.ts).
// Run: npm run test:unit   (Node 22+, no test framework needed)
import assert from 'node:assert/strict'
import { isPrivateIp, plaintextTarget, transportCheck } from '../src/shared/connectionRules.ts'
import { isNoTlsError, isPrivateHost } from '../src/main/connections/transport.ts'

const base = { kind: 'mysql' as const, env: 'production' as const, host: '192.1.15.142', ssl: false, allowPlaintext: false }

// Production over the network without TLS, a tunnel or the user's yes: refused (save and every connect).
assert.equal(transportCheck(base), 'needsTls')
assert.equal(transportCheck({ ...base, host: '10.0.0.5' }), 'needsTls', 'a private address alone is not a yes')
assert.equal(transportCheck({ ...base, kind: 'postgres' }), 'needsTls')
assert.equal(transportCheck({ ...base, ssl: true }), 'ok')
assert.equal(transportCheck({ ...base, allowPlaintext: true }), 'ok')
assert.equal(transportCheck({ ...base, host: 'localhost' }), 'ok')
assert.equal(transportCheck({ ...base, host: ' 127.0.0.1 ' }), 'ok')
assert.equal(transportCheck({ ...base, host: '[::1]' }), 'ok')
assert.equal(transportCheck({ ...base, env: 'staging' }), 'ok')
assert.equal(transportCheck({ ...base, kind: 'ssh' }), 'ok')

// Through SSH, host is as seen from the SSH server: the SSH server itself is fully encrypted, another machine is not
// (the last hop would be in clear), so the rule is the same as for this computer.
assert.equal(transportCheck({ ...base, host: '127.0.0.1' }), 'ok')
assert.equal(transportCheck({ ...base, host: 'db.corp' }), 'needsTls')

// The yes belongs to its target: route, host (case/space-insensitive) and port.
const tgt = { viaSshId: null, host: '192.1.15.142', port: 3306 }
assert.equal(plaintextTarget(tgt), plaintextTarget({ ...tgt, host: ' 192.1.15.142 ' }))
assert.equal(plaintextTarget({ ...tgt, host: 'DB.corp' }), plaintextTarget({ ...tgt, host: 'db.corp' }))
assert.notEqual(plaintextTarget(tgt), plaintextTarget({ ...tgt, host: '192.1.15.143' }))
assert.notEqual(plaintextTarget(tgt), plaintextTarget({ ...tgt, port: 3307 }))
assert.notEqual(plaintextTarget(tgt), plaintextTarget({ ...tgt, viaSshId: 'ssh-1' }))

// The editor's warning tier: company networks use public blocks internally (192.1.x.x), so it is only a wording.
for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '127.0.0.1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '[fd12::3]']) {
  assert.equal(isPrivateIp(ip), true, ip)
}
for (const ip of ['192.1.15.142', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.128.0.1', '10.0.0.256', '2a00:1450::1', '::ffff:8.8.8.8', 'maindb', 'fd.example.com', '']) {
  assert.equal(isPrivateIp(ip), false, ip)
}

// Audit line: a name counts as private only if every address it resolves to is.
const dns = (map: Record<string, string[]>) => async (h: string): Promise<string[]> => {
  if (!map[h]) throw new Error('ENOTFOUND')
  return map[h]
}
assert.equal(await isPrivateHost('maindb.corp', dns({ 'maindb.corp': ['192.168.1.20'] })), true)
assert.equal(await isPrivateHost('mixed.corp', dns({ 'mixed.corp': ['10.1.1.1', '93.184.216.34'] })), false)
assert.equal(await isPrivateHost('unknown.corp', dns({})), false)
assert.equal(await isPrivateHost('192.1.15.142', dns({})), false)
assert.equal(await isPrivateHost('10.0.0.1', dns({})), true)

// Driver errors of a server without TLS (mysql2, pg) are recognised; others are not.
const mysqlErr = Object.assign(new Error('Server does not support secure connection'), { code: 'HANDSHAKE_NO_SSL_SUPPORT' })
assert.equal(isNoTlsError(mysqlErr), true)
assert.equal(isNoTlsError(new Error('The server does not support SSL connections')), true)
// mssql wraps tedious: ConnectionError with the tedious error as originalError.
const tedious = Object.assign(new Error('x'), { code: 'EENCRYPT', originalError: new Error("Server did not negotiate encryption, but the 'encrypt' config option is set to `true`.") })
assert.equal(isNoTlsError(tedious), true)
assert.equal(isNoTlsError(new Error("Access denied for user 'x'@'10.0.0.1'")), false)
assert.equal(isNoTlsError(null), false)

console.log('connections.transport: ok')
