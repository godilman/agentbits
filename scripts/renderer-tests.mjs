// Renderer logic tests: the real renderer modules (e.g. lib/drafts.ts) with their IPC, store and i18n replaced by the
// stand-ins in tests/renderer/stubs. No browser, no React rendering. Run: npm run test:renderer
// Each tests/renderer/*.test.ts is bundled with esbuild (already installed) and run under Node on its own (fresh state).
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'tests/renderer')
const tmp = mkdtempSync(join(tmpdir(), 'agentbits-renderer-'))
const STUBS = { '@/lib/api': 'stubs/api.ts', '@/store/useAppStore': 'stubs/store.ts', '@/i18n': 'stubs/i18n.ts' }
const paths = {
  name: 'renderer-paths',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => ({ path: STUBS[a.path] ? join(dir, STUBS[a.path]) : join(root, 'src/renderer/src', a.path.slice(2)) + '.ts' }))
    b.onResolve({ filter: /^@shared\// }, (a) => ({ path: join(root, 'src/shared', a.path.slice(8)) + '.ts' }))
  }
}
let failed = false
try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.ts'))) {
    const out = join(tmp, f.replace(/\.ts$/, '.cjs'))
    await build({ entryPoints: [join(dir, f)], bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [paths], logLevel: 'error' })
    const r = spawnSync(process.execPath, [out], { encoding: 'utf8', timeout: 60_000 })
    process.stdout.write(r.stdout ?? '')
    if (r.status !== 0) {
      failed = true
      process.stderr.write(r.stderr ?? String(r.error))
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
