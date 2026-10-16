// Database connections end to end: transport rule, SSH tunnel, TLS name checks, friendly errors, audit.
// Real SQLite, a real SSH server (ssh2), fake MySQL / PostgreSQL servers. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { Duplex } from 'node:stream'
import tls from 'node:tls'
import mysql from 'mysql2'
import { Server as SshServer, utils } from 'ssh2'
import { getDb, openDb } from '../../src/main/db'
import { openTunnel } from '../../src/main/connections/drivers'
import { connectionsRepo } from '../../src/main/connections/repo'
import { connectionsPrompt, testConnection, toolQuery } from '../../src/main/connections/service'
import { extractFile } from '../../src/main/files/extract'
import { ensureOrgDefaults } from '../../src/main/core/org'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentTools, runAgentTool } from '../../src/main/agentTools'
import { agentsRepo, projectsRepo } from '../../src/main/db/repos'
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

// MySQL 5.6-like server without TLS (no CLIENT_SSL), answering SELECT VERSION() (and `big_table`: many rows).
const BIG_ROWS = 1500
// ASCII: the fake server writes text cells without a character set (a real server handles Turkish; the unit test covers it).
const LONG_CELL = 'x'.repeat(5000)
let myConnects = 0
const myPlain = mysql.createServer((conn: any) => {
  myConnects++
  conn.serverHandshake({ protocolVersion: 10, serverVersion: '5.6.33-fake', connectionId: 1, statusFlags: 2, characterSet: 8, capabilityFlags: 0xffffff & ~0x800 & ~0x8000000 })
  conn.on('query', (sql: string) => {
    const col = (name: string, columnType = 253) => ({ catalog: 'def', schema: '', table: '', orgTable: '', name, orgName: name, characterSet: 33, columnLength: 65535, columnType, flags: 0, decimals: 0 })
    if (/big_table/.test(sql)) {
      // 1500 rows, one cell of 5000 characters: more than db_query returns, whole in an export.
      conn.writeColumns([col('id', 3), col('ad_soyad'), col('genel_yorum')])
      for (let i = 1; i <= BIG_ROWS; i++) conn.writeTextRow([String(i), `Kisi ${i}`, i === 7 ? LONG_CELL : `yorum ${i}, cok guzeldi`])
      return conn.writeEof()
    }
    conn.writeColumns([col('v')])
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
  await step('chat: an agent with access reads (SELECT) but can’t change data or run SSH', async () => {
    await save({ readOnlyUsername: 'ro', readOnlySecret: 'y', description: 'ERP veritabanı (gizli açıklama)' }, tunneled.id)
    const atlas = agentsRepo.save({ name: 'Atlas', role: 'Lead' } as never)
    ;(handlers['connections:setPermission'] as any)(tunneled.id, atlas.id, 'write')
    const chat = { agentId: atlas.id, mode: 'chat' as const }
    const names = agentTools(chat).map((x) => x.name)
    assert.ok(names.includes('db_query') && names.includes('db_schema') && !names.includes('ssh_exec'), names.join(','))
    const read = await toolQuery(chat, 'maindb-tunnel', 'SELECT * FROM user ORDER BY id DESC LIMIT 2')
    assert.equal(read.isError, false, read.text)
    const write = await toolQuery(chat, 'maindb-tunnel', 'DELETE FROM user')
    assert.match(write.text, /^DENIED: In chat, agents can only read/)
    assert.match((await runAgentTool(chat, 'ssh_exec', { connection: 'maindb-ssh', command: 'uptime' })).text, /only available while working on a task/)
    assert.match(connectionsPrompt(atlas.id, true, true), /SELECT only/)
    // in a task the same agent may write (Production → it would wait for approval; not exercised here)
    assert.ok(agentTools({ agentId: atlas.id, mode: 'task' }).some((x) => x.name === 'ssh_exec'))
  })
  await step('an agent without access knows only the names: no host, description or notes', async () => {
    const vega = agentsRepo.save({ name: 'Vega', role: 'Dev' } as never)
    const p = connectionsPrompt(vega.id, true, true)
    assert.match(p, /\*\*maindb-tunnel\*\* \(MySQL \/ MariaDB\)/)
    assert.match(p, /Agent access/)
    assert.ok(!p.includes('127.0.0.1') && !p.includes('gizli açıklama') && !p.includes(String(myPort)), p)
    assert.equal(agentTools({ agentId: vega.id, mode: 'chat' }).some((x) => x.name === 'db_query'), false)
    assert.match((await toolQuery({ agentId: vega.id, mode: 'chat' }, 'maindb-tunnel', 'SELECT 1')).text, /^DENIED/)
  })
  await step('db_query returns up to 1000 rows; db_export writes every row (whole cells) to Excel, in Files and the CLI working folder', async () => {
    ensureOrgDefaults()
    const projectId = projectsRepo.list()[0].id
    const atlas = agentsRepo.list().find((a) => a.name === 'Atlas')!
    const exportDir = join(mkdtempSync(join(tmpdir(), 'ab-export-')), '.agentbits-exports')
    const task = { agentId: atlas.id, mode: 'task' as const, projectId, exportDir }
    const q = await toolQuery(task, 'maindb-tunnel', 'SELECT * FROM big_table')
    assert.match(q.text, /1500 row\(s\), first 1000 shown \(db_export/)
    assert.equal(q.text.split('\n').filter((l) => /^\d+\t/.test(l)).length, 1000)
    assert.ok(q.text.includes(`${'x'.repeat(4000)}… [5000 chars]`), 'db_query still cuts long cells')
    const e = await runAgentTool(task, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT * FROM big_table', name: 'yorumlar' })
    assert.equal(e.isError, false, e.text)
    assert.match(e.text, /Exported 1500 row\(s\) × 3 column\(s\) to yorumlar\.xlsx/)
    assert.match(e.text, /\.agentbits-exports\/yorumlar\.xlsx/)
    assert.ok(e.text.length < 2000, 'the rows do not come back to the model')
    assert.equal(readFileSync(join(exportDir, '.gitignore'), 'utf8'), '*\n')
    const read = await extractFile(new Uint8Array(readFileSync(join(exportDir, 'yorumlar.xlsx'))), 'yorumlar.xlsx')
    const text = read.chunks.map((c) => c.text).join('\n')
    assert.ok(text.includes('Kisi 1500') && text.includes('yorum 1500, cok guzeldi') && text.includes(LONG_CELL), 'every row, whole cells')
    const row = getDb().prepare("SELECT * FROM files WHERE name = 'yorumlar.xlsx'").get() as { project_id: string; origin: string } | undefined
    assert.equal(row?.project_id, projectId)
    assert.equal(row?.origin, 'agent')
    assert.ok(audit(tunneled.id).includes('1500'), 'audited')
    // Only reads, only in a task, only with access.
    assert.match((await runAgentTool(task, 'db_export', { connection: 'maindb-tunnel', sql: 'DELETE FROM big_table' })).text, /^DENIED: db_export only runs reads/)
    const chat = { agentId: atlas.id, mode: 'chat' as const, projectId }
    assert.equal(agentTools(chat).some((x) => x.name === 'db_export'), false)
    assert.match((await runAgentTool(chat, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT 1' })).text, /only available while working on a task/)
    const vega = agentsRepo.list().find((a) => a.name === 'Vega')!
    assert.match((await runAgentTool({ ...task, agentId: vega.id }, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT * FROM big_table' })).text, /^DENIED/)
    // TXT (the format that was retyped by hand before): every row, one line each; an unknown format is refused, not swapped.
    const txt = await runAgentTool(task, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT * FROM big_table', format: 'txt', name: 'yorumlar.txt' })
    assert.match(txt.text, /Exported 1500 row\(s\) × 3 column\(s\) to yorumlar\.txt/)
    const lines = readFileSync(join(exportDir, 'yorumlar.txt'), 'utf8').trimEnd().split('\r\n')
    assert.equal(lines.length, 1501)
    assert.equal(lines[0], 'id\tad_soyad\tgenel_yorum')
    assert.equal(lines[1500], '1500\tKisi 1500\tyorum 1500, cok guzeldi')
    assert.ok(lines[7].endsWith(LONG_CELL))
    const pdf = await runAgentTool(task, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT * FROM big_table', format: 'pdf' })
    assert.equal(pdf.isError, true)
    assert.match(pdf.text, /Unsupported format "pdf"\. db_export writes: xlsx, csv, json, txt, tsv, md, html\. .*Never retype the rows/)
    // API agents (no working folder): the file is only in Files.
    const api = await runAgentTool({ agentId: atlas.id, mode: 'task', projectId }, 'db_export', { connection: 'maindb-tunnel', sql: 'SELECT * FROM big_table', format: 'csv', name: 'yorumlar' })
    assert.match(api.text, /to yorumlar\.csv/)
    assert.ok(!api.text.includes('.agentbits-exports') && !existsSync(join(exportDir, 'yorumlar.csv')))
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
