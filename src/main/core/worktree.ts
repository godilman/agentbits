import { execFile } from 'child_process'
import { existsSync, mkdirSync, realpathSync } from 'fs'
import { dirname, resolve } from 'path'

/**
 * Git worktree isolation for parallel developers (project setting "Each task in its own git working copy"): every task
 * works on its own branch `agentbits/<key>` in a separate worktree, so two agents never overwrite each other's files;
 * a finished task is merged into the project folder. No Electron imports — `tests/worktree.test.ts` runs real git.
 *
 * Agentbits' own git calls never run the repository's hooks (`core.hooksPath` → an empty folder): a hook written by an
 * agent must not run with Agentbits' rights.
 */

export interface GitResult {
  ok: boolean
  out: string
  err: string
}

export interface GitEnv {
  /** An empty folder used as `core.hooksPath`. */
  noHooksDir: string
}

export function git(cwd: string, args: string[], env: GitEnv, timeoutMs = 120_000): Promise<GitResult> {
  mkdirSync(env.noHooksDir, { recursive: true })
  return new Promise((done) => {
    execFile(
      'git',
      ['-c', `core.hooksPath=${env.noHooksDir}`, '-c', 'core.quotepath=false', ...args],
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (e, stdout, stderr) => done({ ok: !e, out: String(stdout).trim(), err: String(stderr || (e ? e.message : '')).trim() })
    )
  })
}

const same = (a: string, b: string): boolean => {
  const norm = (p: string): string => {
    let r = resolve(p)
    try {
      r = realpathSync.native(r)
    } catch {
      /* not there */
    }
    r = r.replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

/** True when `dir` is the top folder of a git working tree with at least one commit (worktrees need a HEAD). */
export async function isRepoRoot(dir: string, env: GitEnv): Promise<boolean> {
  const top = await git(dir, ['rev-parse', '--show-toplevel'], env)
  if (!top.ok || !same(top.out, dir)) return false
  return (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], env)).ok
}

export const branchFor = (taskKey: string): string => `agentbits/${taskKey.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`

/** Creates (or reuses) the task's worktree at `wtDir` on `branch`, branching off the project folder's current commit. */
export async function ensureWorktree(root: string, wtDir: string, branch: string, env: GitEnv): Promise<'created' | 'reused'> {
  if (existsSync(wtDir)) {
    const cur = await git(wtDir, ['rev-parse', '--abbrev-ref', 'HEAD'], env)
    const top = await git(wtDir, ['rev-parse', '--show-toplevel'], env)
    if (cur.ok && cur.out === branch && top.ok && same(top.out, wtDir)) return 'reused'
    throw new Error(`worktree folder is in use: ${wtDir}`)
  }
  mkdirSync(dirname(wtDir), { recursive: true })
  await git(root, ['worktree', 'prune'], env)
  const exists = (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], env)).ok
  const r = await git(root, exists ? ['worktree', 'add', wtDir, branch] : ['worktree', 'add', '-b', branch, wtDir, 'HEAD'], env)
  if (!r.ok) throw new Error(r.err || 'git worktree add failed')
  return 'created'
}

/** Commits everything in the worktree (also concludes a merge in progress). False when there was nothing to commit. */
export async function commitAll(wtDir: string, message: string, author: { name: string; email: string }, env: GitEnv): Promise<boolean> {
  await git(wtDir, ['add', '-A'], env)
  const merging = (await git(wtDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], env)).ok
  if (!merging && (await git(wtDir, ['diff', '--cached', '--quiet'], env)).ok) return false
  const r = await git(wtDir, ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '--no-verify', '-m', message], env)
  if (!r.ok) throw new Error(r.err || 'git commit failed')
  return true
}

/**
 * Merge commits need a committer: the user's git identity when configured, otherwise "Agentbits" (a machine without
 * user.name / user.email would make every merge fail with "Committer identity unknown").
 */
async function identity(dir: string, env: GitEnv): Promise<string[]> {
  const email = await git(dir, ['config', 'user.email'], env)
  const name = await git(dir, ['config', 'user.name'], env)
  return email.ok && email.out && name.ok && name.out ? [] : ['-c', 'user.name=Agentbits', '-c', 'user.email=agentbits@agents.agentbits.local']
}

/** Files with unresolved conflicts (merge markers) in a working tree. */
export async function conflictedFiles(dir: string, env: GitEnv): Promise<string[]> {
  const r = await git(dir, ['diff', '--name-only', '--diff-filter=U'], env)
  return r.ok && r.out ? r.out.split('\n') : []
}

export type MergeOutcome =
  | { status: 'merged' | 'nothing' }
  | { status: 'dirty' }
  | { status: 'conflict'; files: string[] }
  | { status: 'failed'; error: string }

/**
 * Merges the task branch into the project folder's current branch (`--no-ff`, so the task stays visible in history).
 * Refuses when the folder has uncommitted changes to tracked files; aborts and reports conflicts.
 */
export async function mergeIntoRoot(root: string, branch: string, message: string, env: GitEnv): Promise<MergeOutcome> {
  const ahead = await git(root, ['rev-list', '--count', `HEAD..${branch}`], env)
  if (!ahead.ok) return { status: 'failed', error: ahead.err }
  if (Number(ahead.out) === 0) return { status: 'nothing' }
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=no'], env)
  if (!dirty.ok) return { status: 'failed', error: dirty.err }
  if (dirty.out) return { status: 'dirty' }
  const r = await git(root, [...(await identity(root, env)), 'merge', '--no-ff', '--no-verify', '--no-edit', '-m', message, branch], env)
  if (r.ok) return { status: 'merged' }
  const files = await conflictedFiles(root, env)
  await git(root, ['merge', '--abort'], env)
  return files.length ? { status: 'conflict', files } : { status: 'failed', error: r.err }
}

/**
 * Brings the project folder's current commit into the task branch, so the agent can resolve conflicts in its own
 * worktree: conflict markers are left in the files and the merge stays in progress (`commitAll` concludes it).
 */
export async function bringRootIn(root: string, wtDir: string, env: GitEnv): Promise<string[]> {
  const head = await git(root, ['rev-parse', 'HEAD'], env)
  if (!head.ok) throw new Error(head.err)
  const r = await git(wtDir, [...(await identity(wtDir, env)), 'merge', '--no-ff', '--no-verify', '--no-edit', head.out], env)
  if (r.ok) return []
  const files = await conflictedFiles(wtDir, env)
  if (!files.length) throw new Error(r.err || 'git merge failed')
  return files
}

export interface TaskChanges {
  files: { path: string; added: number; removed: number }[]
  /** Unified diff, cut at 200 000 characters. */
  diff: string
  truncated: boolean
}

/**
 * What a task changed, from git: while its working copy exists, the copy against where it branched off (uncommitted
 * edits included); once merged, the merge commit "Merge <key>: …" in the project folder. Null when git has nothing.
 */
export async function taskChanges(root: string, wtDir: string | null, key: string, env: GitEnv): Promise<TaskChanges | null> {
  let cwd = root
  let range: string[]
  if (wtDir && existsSync(wtDir)) {
    const head = await git(root, ['rev-parse', 'HEAD'], env)
    const base = head.ok ? await git(wtDir, ['merge-base', 'HEAD', head.out], env) : head
    if (!base.ok) return null
    cwd = wtDir
    range = [base.out]
  } else {
    const c = await git(root, ['log', '--merges', '-n', '1', '--format=%H', `--grep=^Merge ${key}:`], env)
    if (!c.ok || !c.out) return null
    range = [`${c.out}^1`, c.out]
  }
  const stat = await git(cwd, ['diff', '--numstat', ...range], env)
  if (!stat.ok) return null
  const files = stat.out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, r, ...p] = l.split('\t')
      return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 }
    })
  const patch = await git(cwd, ['diff', '--no-color', ...range], env)
  const full = patch.ok ? patch.out : ''
  return { files, diff: full.slice(0, 200_000), truncated: full.length > 200_000 }
}

/** No uncommitted or untracked changes in a working copy (a failed check counts as not clean). */
export async function isClean(dir: string, env: GitEnv): Promise<boolean> {
  const r = await git(dir, ['status', '--porcelain'], env)
  return r.ok && !r.out.trim()
}

/** Removes the task's worktree and (when merged) its branch. */
export async function removeWorktree(root: string, wtDir: string, branch: string | null, env: GitEnv): Promise<void> {
  if (existsSync(wtDir)) await git(root, ['worktree', 'remove', '--force', wtDir], env)
  await git(root, ['worktree', 'prune'], env)
  if (branch) await git(root, ['branch', '-D', branch], env)
}

const queues = new Map<string, Promise<unknown>>()

/** Runs git work on one repository one at a time (concurrent `worktree add` / merges fight over .git lock files). */
export function serialized<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(repo)
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  queues.set(key, next.catch(() => undefined))
  return next
}
