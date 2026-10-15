/** Git worktree isolation for parallel tasks, with real git in a temporary folder. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { branchFor, bringRootIn, commitAll, ensureWorktree, git, isRepoRoot, mergeIntoRoot, removeWorktree } from '../src/main/core/worktree.ts'

const base = mkdtempSync(join(tmpdir(), 'agentbits-wt-'))
const env = { noHooksDir: join(base, 'nohooks') }
const root = join(base, 'repo')
const wt = (key: string): string => join(base, 'worktrees', key)
const author = { name: 'Kaan', email: 'kaan@agents.agentbits.local' }
const sh = async (cwd: string, ...args: string[]): Promise<string> => {
  const r = await git(cwd, ['-c', 'user.name=Test', '-c', 'user.email=t@t', ...args], env)
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.err}`)
  return r.out
}

try {
  // not a repo yet
  writeFileSync(join(base, 'plain.txt'), 'x')
  assert.equal(await isRepoRoot(base, env), false)
  await import('node:fs').then((fs) => fs.mkdirSync(root))
  await sh(root, 'init', '-q', '-b', 'main')
  assert.equal(await isRepoRoot(root, env), false) // no commit yet: no HEAD to branch from
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(root, 'b.txt'), 'bee\n')
  await sh(root, 'add', '-A')
  await sh(root, 'commit', '-q', '-m', 'init')
  assert.equal(await isRepoRoot(root, env), true)
  assert.equal(branchFor('TA-12'), 'agentbits/ta-12')

  // a hook planted in the repo never runs for Agentbits' own commits / merges
  const marker = join(base, 'hook-ran')
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${marker}"\n`)
  writeFileSync(join(root, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch "${marker}"\n`)
  try {
    chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755)
    chmodSync(join(root, '.git', 'hooks', 'post-merge'), 0o755)
  } catch {
    /* Windows */
  }

  // two tasks in parallel, each in its own worktree on its own branch
  assert.equal(await ensureWorktree(root, wt('ta-1'), branchFor('TA-1'), env), 'created')
  assert.equal(await ensureWorktree(root, wt('ta-2'), branchFor('TA-2'), env), 'created')
  assert.equal(await ensureWorktree(root, wt('ta-1'), branchFor('TA-1'), env), 'reused')
  writeFileSync(join(wt('ta-1'), 'a.txt'), 'one\nTWO by TA-1\nthree\n')
  writeFileSync(join(wt('ta-2'), 'b.txt'), 'bee by TA-2\n')
  writeFileSync(join(wt('ta-2'), 'new.txt'), 'added\n')
  // the project folder is untouched while they work
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n')
  assert.equal(await commitAll(wt('ta-1'), 'TA-1: edit a', author, env), true)
  assert.equal(await commitAll(wt('ta-1'), 'TA-1: nothing', author, env), false)
  assert.equal(await commitAll(wt('ta-2'), 'TA-2: edit b', author, env), true)
  assert.equal(existsSync(marker), false, 'pre-commit hook must not run')

  // a dirty project folder is never merged into
  writeFileSync(join(root, 'b.txt'), 'local edit\n')
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-1'), 'Merge TA-1', env), { status: 'dirty' })
  await sh(root, 'checkout', '--', 'b.txt')

  // both merge cleanly (different files)
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-1'), 'Merge TA-1', env), { status: 'merged' })
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-2'), 'Merge TA-2', env), { status: 'merged' })
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-2'), 'Merge TA-2', env), { status: 'nothing' })
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'one\nTWO by TA-1\nthree\n')
  assert.equal(readFileSync(join(root, 'new.txt'), 'utf8'), 'added\n')
  assert.equal(existsSync(marker), false, 'post-merge hook must not run')
  await removeWorktree(root, wt('ta-1'), branchFor('TA-1'), env)
  await removeWorktree(root, wt('ta-2'), branchFor('TA-2'), env)
  assert.equal(existsSync(wt('ta-1')), false)

  // a conflict: two tasks change the same line
  await ensureWorktree(root, wt('ta-3'), branchFor('TA-3'), env)
  await ensureWorktree(root, wt('ta-4'), branchFor('TA-4'), env)
  writeFileSync(join(wt('ta-3'), 'a.txt'), 'one\nTWO by TA-3\nthree\n')
  writeFileSync(join(wt('ta-4'), 'a.txt'), 'one\nTWO by TA-4\nthree\n')
  await commitAll(wt('ta-3'), 'TA-3', author, env)
  await commitAll(wt('ta-4'), 'TA-4', author, env)
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-3'), 'Merge TA-3', env), { status: 'merged' })
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-4'), 'Merge TA-4', env), { status: 'conflict', files: ['a.txt'] })
  // the project folder is left clean (merge aborted)
  assert.equal(await sh(root, 'status', '--porcelain'), '')
  // the conflict is brought into the task's worktree, the agent resolves it there, then it merges
  assert.deepEqual(await bringRootIn(root, wt('ta-4'), env), ['a.txt'])
  assert.match(readFileSync(join(wt('ta-4'), 'a.txt'), 'utf8'), /<<<<<<< /)
  writeFileSync(join(wt('ta-4'), 'a.txt'), 'one\nTWO by TA-3 and TA-4\nthree\n')
  assert.equal(await commitAll(wt('ta-4'), 'TA-4: resolve conflict', author, env), true)
  assert.deepEqual(await mergeIntoRoot(root, branchFor('TA-4'), 'Merge TA-4', env), { status: 'merged' })
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'one\nTWO by TA-3 and TA-4\nthree\n')
  // the agent's commits carry its name
  assert.match(await sh(root, 'log', '--format=%an', '-n', '20'), /Kaan/)
  console.log('worktree: parallel tasks isolated, merged, conflicts resolved in the task worktree, hooks never run')
} finally {
  rmSync(base, { recursive: true, force: true })
}
