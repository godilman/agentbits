// Database connections end to end: transport rule, SSH tunnel, TLS name checks, friendly errors, audit.
// Real SQLite, a real SSH server (ssh2), fake MySQL / PostgreSQL servers. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { Duplex } from 'node:stream'
import tls from 'node:tls'
import mysql from 'mysql2'
import { Server as SshServer, utils } from 'ssh2'
import { getDb, openDb } from '../../src/main/db'
import { openTunnel } from '../../src/main/connections/drivers'
import { connectionsRepo } from '../../src/main/connections/repo'
import { testConnection } from '../../src/main/connections/service'
import { handlers } from '../../src/main/ipc'

const TLS_DIR = process.env.E2E_TLS_DIR
const key = TLS_DIR ? readFileSync(`${TLS_DIR}/key.pem`) : null
const cert = TLS_DIR ? readFileSync(`${TLS_DIR}/cert.pem`) : null // CN db.corp, SAN DNS:db.corp + IP:10.9.9.9
const listen = (s: net.Server): Promise<number> => new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)))
let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}

// MySQL 5.6-like server without TLS (no CLIENT_SSL), answering SELECT VERSION().
let myConnects = 0
const myPlain = mysql.createServer((conn: any) => {
  myConnects++
  conn.serverHandshake({ protocolVersion: 10, serverVersion: '5.6.33-fake', connectionId: 1, statusFlags: 2, characterSet: 8, capabilityFlags: 0xffffff & ~0x800 & ~0x8000000 })
  conn.on('query', () => {
    conn.writeColumns([{ catalog: 'def', schema: '', table: '', orgTable: '', name: 'v', orgName: 'v', characterSet: 33, columnLength: 64, columnType: 253, flags: 0, decimals: 0 }])
    conn.writeTextRow(['5.6.33-fake'])
    conn.writeEof()
  })
  conn.on('error', () => undefined)
}) as any

// MySQL server WITH TLS: hello → SSLRequest → TLS → the client's login answered with an error "tls-ok".
// Reaching that error means the TLS handshake (and the certificate name check) passed.
const u16 = (n: number): Buffer => Buffer.from([n & 255, (n >> 8) & 255])
const myPkt = (seq: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([body.length & 255, (body.length >> 8) & 255, body.length >> 16, seq]), body])
const myTls = net.createServer((raw) => {
  raw.on('error', () => undefined)
  const caps = 0x1 | 0x200 | 0x800 | 0x2000 | 0x8000 | 0x80000
  raw.write(myPkt(0, Buffer.concat([Buffer.from([10]), Buffer.from('8.0.0-fake\0'), Buffer.from([1, 0, 0, 0]), Buffer.from('abcdefgh'), Buffer.from([0]),
    u16(caps & 0xffff), Buffer.from([33]), u16(2), u16(caps >>> 16), Buffer.from([21]), Buffer.alloc(10), Buffer.from('ijklmnopqrst\0'), Buffer.from('mysql_native_password\0')])))
  // mysql2 starts TLS right after the 36-byte SSLRequest, so they can share a chunk (or the request can be split):
  // collect 36 bytes, then hand the rest to TLS through a plain stream (a TLS socket over the TCP socket itself
  // would read the connection natively and miss bytes already read here).
  let buf = Buffer.alloc(0)
  let tlsSide: Duplex | null = null
  raw.on('data', (d) => {
    if (tlsSide) return void tlsSide.push(d)
    buf = Buffer.concat([buf, d])
    if (buf.length < 36) return
    tlsSide = new Duplex({ read() {}, write: (c, _e, cb) => void raw.write(c, cb), final: (cb) => (raw.end(), cb()) })
    if (buf.length > 36) tlsSide.push(buf.subarray(36))
    const s = new tls.TLSSocket(tlsSide, { isServer: true, key: key!, cert: cert! })
    s.on('error', () => undefined)
    s.once('data', () => s.end(myPkt(3, Buffer.concat([Buffer.from([0xff]), u16(1045), Buffer.from('#28000tls-ok')]))))
  })
  raw.on('end', () => tlsSide?.push(null))
})

// Minimal PostgreSQL: SSLRequest → 'N' (no TLS) or 'S' + TLS; trust auth; one row.
const fakePg = (withTls: boolean): net.Server =>
  net.createServer((raw) => {
    raw.on('error', () => undefined)
    const serve = (sock: net.Socket, first: Buffer | null): void => {
      let buf = first ?? Buffer.alloc(0)
      let started = false
      const msg = (type: string, body: Buffer): void => {
        const h = Buffer.alloc(5)
        h.write(type, 0)
        h.writeInt32BE(body.length + 4, 1)
        sock.write(Buffer.concat([h, body]))
      }
      const onData = (d: Buffer): void => {
        buf = Buffer.concat([buf, d])
        for (;;) {
          if (!started) {
            if (buf.length < 8 || buf.length < buf.readInt32BE(0)) return
            buf = buf.subarray(buf.readInt32BE(0))
            started = true
            msg('R', Buffer.from([0, 0, 0, 0]))
            msg('Z', Buffer.from('I'))
            continue
          }
          if (buf.length < 5 || buf.length < buf.readInt32BE(1) + 1) return
          const type = String.fromCharCode(buf[0])
          buf = buf.subarray(buf.readInt32BE(1) + 1)
          if (type === 'X') return void sock.end()
          if (type === 'Q') {
            const field = Buffer.alloc(18)
            field.writeInt32BE(25, 6)
            field.writeInt16BE(-1, 10)
            field.writeInt32BE(-1, 12)
            msg('T', Buffer.concat([Buffer.from([0, 1]), Buffer.from('v\0'), field]))
            const val = Buffer.from('PostgreSQL 16-fake')
            const n = Buffer.alloc(6)
            n.writeInt16BE(1, 0)
            n.writeInt32BE(val.length, 2)
            msg('D', Buffer.concat([n, val]))
            msg('C', Buffer.from('SELECT 1\0'))
            msg('Z', Buffer.from('I'))
          }
        }
      }
      sock.on('data', onData)
      if (first?.length) onData(Buffer.alloc(0))
    }
    raw.once('data', (d) => {
      if (d.length >= 8 && d.readInt32BE(4) === 80877103) {
        if (!withTls) {
          raw.write('N')
          return serve(raw, d.subarray(8))
        }
        raw.write('S')
        const s = new tls.TLSSocket(raw, { isServer: true, key: key!, cert: cert! })
        s.on('error', () => undefined)
        return serve(s as unknown as net.Socket, null)
      }
      serve(raw, d)
    })
  })

// SSH server (password "pw"); db.corp, evil.corp, 10.9.9.9 and 10.9.9.8 are names / addresses only it can reach (→ 127.0.0.1).
let allowForward = true
const ssh = new SshServer({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (client) => {
  client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.password === 'pw' ? ctx.accept() : ctx.reject(['password'])))
  client.on('ready', () =>
    client.on('tcpip', (accept, reject, info) => {
      if (!allowForward) return reject()
      const up = net.connect(info.destPort, ['db.corp', 'evil.corp', '10.9.9.9', '10.9.9.8'].includes(info.destIP) ? '127.0.0.1' : info.destIP)
      up.on('error', () => undefined)
      const ch = accept()
      ch.pipe(up).pipe(ch)
    })
  )
  client.on('error', () => undefined)
})

async function main(): Promise<void> {
  openDb()
  const myPort = await new Promise<number>((r) => myPlain.listen(0, '127.0.0.1', () => r(myPlain._server.address().port)))
  const sshPort = await listen(ssh as unknown as net.Server)
  const pgPlainPort = await listen(fakePg(false))
  const save = handlers['connections:save'] as (input: Record<string, unknown>, id?: string) => Promise<any>
  const audit = (id: string): string => JSON.stringify((handlers['audit:list'] as any)({ connectionId: id }))
  const base = { env: 'production', username: 'u', secret: 'x' }
  let r: Awaited<ReturnType<typeof testConnection>>

  const direct = await save({ ...base, name: 'maindb', kind: 'mysql', host: '127.0.0.1', port: myPort, ssl: true })
  await step('MySQL without TLS, SSL on → friendly message with the hint', async () => {
    r = await testConnection(direct.id)
    assert.equal(r.hint, 'serverNoTls', r.message)
    assert.match(r.message, /şifreli bağlantıyı desteklemiyor/)
  })
  await step('remote Production without TLS is refused on save (private or public address)', async () => {
    for (const host of ['10.0.0.5', '192.1.15.142']) await assert.rejects(save({ host, ssl: false }, direct.id), /şifresiz bağlanılmaz/, host)
  })
  await step('the user’s yes saves it; the audit says the address looked public', async () => {
    const yes = await save({ host: '192.1.15.142', ssl: false, allowPlaintext: true }, direct.id)
    assert.equal(yes.allowPlaintext, true)
    assert.ok(audit(direct.id).includes('genel internet adresi'))
  })
  await step('the yes belongs to its target: another host without a new yes is refused', async () => {
    await assert.rejects(save({ host: '192.1.15.143' }, direct.id), /şifresiz bağlanılmaz/)
    // a stored row whose target changed behind the editor's back: not unencrypted any more, refused on connect
    getDb().prepare("UPDATE connections SET host = '127.0.0.1' WHERE id = ?").run(direct.id)
    assert.equal(connectionsRepo.get(direct.id)!.allowPlaintext, false)
    getDb().prepare('UPDATE connections SET ssl = 0 WHERE id = ?').run(direct.id)
    getDb().prepare("UPDATE connections SET host = '10.1.1.1' WHERE id = ?").run(direct.id)
    r = await testConnection(direct.id)
    assert.equal(r.ok, false)
    assert.match(r.message, /şifresiz bağlanılmaz/)
  })
  await step('a yes for the new target is a new, audited yes', async () => {
    const lines = (audit(direct.id).match(/şifresiz bağlantı onaylandı/g) ?? []).length
    await save({ host: '10.1.1.2', allowPlaintext: true }, direct.id)
    assert.equal((audit(direct.id).match(/şifresiz bağlantı onaylandı/g) ?? []).length, lines + 1)
  })

  const bastion = await save({ ...base, name: 'maindb-ssh', kind: 'ssh', host: '127.0.0.1', port: sshPort, username: 'g', sshAuth: 'password', secret: 'pw' })
  const tunneled = await save({ ...base, name: 'maindb-tunnel', kind: 'mysql', host: '127.0.0.1', port: myPort, ssl: false, viaSshId: bastion.id })
  await step('through SSH to a database on the SSH server: no TLS needed; the DB Test pins the SSH key', async () => {
    const before = myConnects
    r = await testConnection(tunneled.id)
    assert.equal(r.ok, true, r.message)
    assert.equal(r.serverVersion, '5.6.33-fake')
    assert.ok(connectionsRepo.get(bastion.id)!.hostKey?.startsWith('SHA256:'))
    assert.equal(myConnects, before + 1)
  })
  await step('through SSH to ANOTHER machine without TLS: refused (that hop is unencrypted) until the yes', async () => {
    await assert.rejects(save({ ...base, name: 'other-db', kind: 'mysql', host: 'db.corp', port: myPort, ssl: false, viaSshId: bastion.id }), /şifresiz bağlanılmaz/)
    const other = await save({ ...base, name: 'other-db', kind: 'mysql', host: 'db.corp', port: myPort, ssl: false, viaSshId: bastion.id, allowPlaintext: true })
    r = await testConnection(other.id)
    assert.equal(r.ok, true, r.message)
    // changing the route drops the yes too
    await assert.rejects(save({ viaSshId: null }, other.id), /şifresiz bağlanılmaz/)
  })
  await step('a changed SSH key is refused', async () => {
    getDb().prepare("UPDATE connections SET host_key = 'SHA256:other' WHERE id = ?").run(bastion.id)
    r = await testConnection(tunneled.id)
    assert.match(r.message, /anahtarı değişmiş/)
    getDb().prepare('UPDATE connections SET host_key = NULL WHERE id = ?').run(bastion.id)
  })
  await step('SSH server refuses forwarding → that reason', async () => {
    allowForward = false
    r = await testConnection(tunneled.id)
    assert.match(r.message, /AllowTcpForwarding/, r.message)
    allowForward = true
  })
  await step('the tunnel’s local port is closed after the call', async () => {
    const tun = await openTunnel(connectionsRepo.get(bastion.id)!, 'pw', '127.0.0.1', myPort)
    tun.close()
    await new Promise((res) => setTimeout(res, 100))
    await assert.rejects(new Promise((res, rej) => net.connect(tun.port, '127.0.0.1').on('connect', res).on('error', rej)))
  })
  await step('an SSH connection used as a tunnel can’t be deleted; a tunnel must be an SSH connection', async () => {
    assert.throws(() => (handlers['connections:delete'] as any)(bastion.id), /SSH tüneli olarak kullanıyor/)
    await assert.rejects(save({ viaSshId: direct.id }, tunneled.id), /artık yok/)
  })
  await step('PostgreSQL without TLS, SSL on → the same hint; through SSH without TLS works', async () => {
    const pg1 = await save({ ...base, name: 'pg-direct', kind: 'postgres', host: '127.0.0.1', port: pgPlainPort, ssl: true })
    r = await testConnection(pg1.id)
    assert.equal(r.hint, 'serverNoTls', r.message)
    const pg2 = await save({ ...base, name: 'pg-tunnel', kind: 'postgres', host: '127.0.0.1', port: pgPlainPort, ssl: false, viaSshId: bastion.id })
    r = await testConnection(pg2.id)
    assert.equal(r.serverVersion, 'PostgreSQL 16-fake', r.message)
  })

  if (!cert) {
    console.log(`connections e2e: ${count} ok (TLS cases skipped: no openssl)`)
    process.exit(0)
  }
  const pgTlsPort = await listen(fakePg(true))
  const myTlsPort = await listen(myTls)
  const tlsCase = async (name: string, kind: 'mysql' | 'postgres', host: string, opts: Record<string, unknown>, ok: boolean): Promise<void> =>
    step(name, async () => {
      const c = await save({ ...base, name, kind, host, port: kind === 'mysql' ? myTlsPort : pgTlsPort, ssl: true, ...opts })
      r = await testConnection(c.id)
      const passed = kind === 'mysql' ? /tls-ok/.test(r.message) : r.ok
      assert.equal(passed, ok, r.message)
      if (!ok) assert.match(r.message, /altnames|does not match|Hostname\/IP/, r.message)
    })
  await tlsCase('PostgreSQL via SSH + TLS: certificate checked against the real name', 'postgres', 'db.corp', { viaSshId: bastion.id }, true)
  await tlsCase('PostgreSQL via SSH + TLS: a wrong name is refused', 'postgres', 'evil.corp', { viaSshId: bastion.id }, false)
  await tlsCase('PostgreSQL direct + TLS + trust certificate', 'postgres', 'localhost', { trustServerCertificate: true }, true)
  await tlsCase('MySQL direct + TLS: a certificate for another name is refused', 'mysql', '127.0.0.1', {}, false)
  await tlsCase('MySQL direct + TLS + trust certificate', 'mysql', '127.0.0.1', { trustServerCertificate: true }, true)
  await tlsCase('MySQL via SSH + TLS: certificate checked against the real name', 'mysql', 'db.corp', { viaSshId: bastion.id }, true)
  await tlsCase('MySQL via SSH + TLS: a wrong name is refused', 'mysql', 'evil.corp', { viaSshId: bastion.id }, false)
  await tlsCase('MySQL via SSH + TLS to an IP address: checked against that IP', 'mysql', '10.9.9.9', { viaSshId: bastion.id }, true)
  await tlsCase('MySQL via SSH + TLS to an IP the certificate doesn’t name: refused', 'mysql', '10.9.9.8', { viaSshId: bastion.id }, false)

  console.log(`connections e2e: ${count} ok`)
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
