// End-to-end tests of the main process (real SQLite, real SSH tunnel, fake database servers), no window.
// Run: npm run test:e2e
// Bundles tests/e2e/*.e2e.ts with esbuild (already installed with electron-vite), `electron` replaced by a stub,
// and runs each under Node. If better-sqlite3 is built for Electron here, it reruns under Electron as Node.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentbits-e2e-'))
const env = { ...process.env, AGENTBITS_ALLOW_PLAIN_SECRETS: '1', NODE_PATH: join(root, 'node_modules') }

// A throwaway certificate authority for the TLS cases (no key is ever committed). Without openssl they are skipped.
const ssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=db.corp',
  '-addext', 'subjectAltName=DNS:db.corp,IP:10.9.9.9', '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'cert.pem')], { stdio: 'ignore' })
if (ssl.status === 0) Object.assign(env, { NODE_EXTRA_CA_CERTS: join(tmp, 'cert.pem'), E2E_TLS_DIR: tmp })
else console.log('e2e: openssl not found, TLS cases skipped')

let failed = false
try {
  for (const f of readdirSync(join(root, 'tests/e2e')).filter((x) => x.endsWith('.e2e.ts'))) {
    const out = join(tmp, f.replace(/\.ts$/, '.cjs'))
    await build({
      entryPoints: [join(root, 'tests/e2e', f)],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: out,
      alias: { electron: join(root, 'tests/e2e/electron-stub.cjs'), '@shared': join(root, 'src/shared') },
      external: ['better-sqlite3', 'cpu-features', '*.node'],
      logLevel: 'error'
    })
    const run = (bin, extra = {}) =>
      spawnSync(bin, [out], { env: { ...env, ...extra, AGENTBITS_DATA_DIR: mkdtempSync(join(tmp, 'data-')) }, encoding: 'utf8', timeout: 180_000 })
    let r = run(process.execPath)
    if (/NODE_MODULE_VERSION/.test(r.stderr ?? '')) r = run(createRequire(import.meta.url)('electron'), { ELECTRON_RUN_AS_NODE: '1' })
    process.stdout.write((r.stdout ?? '').split('\n').filter((l) => !/out of order|i18next/.test(l)).join('\n'))
    if (r.status !== 0) {
      failed = true
      process.stderr.write(r.stderr ?? String(r.error))
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
