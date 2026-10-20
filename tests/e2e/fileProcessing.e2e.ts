// A file is read in again while an earlier read-in of it is still running: only the newest attempt may write the
// file's text and status. An older one finishing later — with a result or an error — writes nothing, and a read
// skipped for size makes the running ones stale too. The extraction worker is replaced so attempts end in any order.
// Real SQLite. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/db'
import { handlers } from '../../src/main/ipc'
import { filesRepo } from '../../src/main/files/repo'
import { processFile, recordWorkspaceChanges, type WorkerResult } from '../../src/main/files/service'
import { applyLanguageSetting } from '../../src/main/i18n'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, what: string, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(10)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))

const result = (text: string): WorkerResult => ({
  kind: 'text',
  mime: 'text/plain',
  status: 'ready',
  message: null,
  chunks: [{ label: 'Text (1/1)', text }],
  chars: text.length,
  pages: null,
  sheets: null,
  width: null,
  height: null,
  encoding: 'utf-8',
  warnings: [],
  suspicious: []
})
/** An attempt whose end the test decides: `ok(text)` or `fail(message)`. */
function attempt(fileId: string): { done: Promise<void>; ok: (text: string) => void; fail: (message: string) => void } {
  let ok!: (r: WorkerResult) => void
  let fail!: (e: Error) => void
  const pending = new Promise<WorkerResult>((res, rej) => {
    ok = res
    fail = rej
  })
  const done = processFile(fileId, '/unused', 'notes.txt', () => pending)
  return { done, ok: (text) => ok(result(text)), fail: (message) => fail(new Error(message)) }
}
const text = (id: string): string => filesRepo.chunks(id, 0, 10).map((c) => c.text).join('')

async function main(): Promise<void> {
  openDb()
  applyLanguageSetting('en')
  const p = await call('projects:save', { name: 'P', rootPath: mkdtempSync(join(tmpdir(), 'ab-fp-')) })
  const fresh = async (): Promise<string> => {
    const f = await call('files:addData', p.id, 'notes.txt', new TextEncoder().encode('v0'))
    // Its own first read-in (the real worker isn't part of this test, so it fails): let it end first.
    await until(() => filesRepo.get(f.id)?.status !== 'processing', 'the first read-in to end')
    return f.id
  }

  await step('an old success arriving after the new result does not overwrite it', async () => {
    const id = await fresh()
    const old = attempt(id)
    const now = attempt(id)
    now.ok('NEW')
    await now.done
    old.ok('OLD')
    await old.done
    assert.equal(text(id), 'NEW')
    assert.equal(filesRepo.get(id)!.status, 'ready')
  })

  await step('an old failure arriving after the new result does not mark the file failed', async () => {
    const id = await fresh()
    const old = attempt(id)
    const now = attempt(id)
    now.ok('NEW')
    await now.done
    old.fail('old read-in failed')
    await old.done
    assert.equal(filesRepo.get(id)!.status, 'ready')
    assert.equal(filesRepo.get(id)!.statusMessage, null)
    assert.equal(text(id), 'NEW')
  })

  await step('an old success arriving after the new attempt failed does not bring its text back', async () => {
    const id = await fresh()
    const old = attempt(id)
    const now = attempt(id)
    now.fail('the new version could not be read')
    await now.done
    old.ok('OLD')
    await old.done
    assert.equal(filesRepo.get(id)!.status, 'failed')
    assert.match(filesRepo.get(id)!.statusMessage ?? '', /new version could not be read/)
    assert.doesNotMatch(text(id), /OLD/)
  })

  await step('an old attempt ending first (stale, dropped) does not stop the new one from writing afterwards', async () => {
    const id = await fresh()
    const old = attempt(id)
    const now = attempt(id)
    old.ok('OLD')
    await old.done
    assert.doesNotMatch(text(id), /OLD/)
    now.ok('NEW')
    await now.done
    assert.equal(text(id), 'NEW')
    assert.equal(filesRepo.get(id)!.status, 'ready')
  })

  await step('a read skipped for size makes a running attempt stale: its later result writes nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ab-fp-ws-'))
    const abs = join(root, 'big.txt')
    writeFileSync(abs, 'small')
    const ctx = { projectId: p.id, agentId: null, runId: null, taskId: null } as any
    const [f] = recordWorkspaceChanges(ctx, root, 0)
    await until(() => filesRepo.get(f.id)?.status !== 'processing', 'the first read-in to end')
    const old = attempt(f.id) // still running when the file changes again
    writeFileSync(abs, Buffer.alloc(15 * 1048576 + 1, 'x'))
    recordWorkspaceChanges(ctx, root, 0) // too large: not read
    old.ok('SMALL VERSION')
    await old.done
    const after = filesRepo.get(f.id)!
    assert.equal(after.status, 'ready')
    assert.match(after.statusMessage ?? '', /too large|not extracted|large/i)
    assert.equal(text(f.id), '', 'the earlier version is not written back')
    assert.equal(after.chunkCount, 0)
  })

  await step('a single attempt still writes its result (and its failure)', async () => {
    const id = await fresh()
    const a = attempt(id)
    a.ok('ONLY')
    await a.done
    assert.equal(text(id), 'ONLY')
    const b = attempt(id)
    b.fail('broken')
    await b.done
    assert.equal(filesRepo.get(id)!.status, 'failed')
  })

  console.log(`fileProcessing e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
