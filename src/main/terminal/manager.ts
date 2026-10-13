import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { homedir } from 'os'
import type { TerminalSession } from '@shared/types'
import { emit } from '../events'
import { t } from '../i18n'

/**
 * User shell sessions. A real pseudo-terminal (node-pty, prebuilt N-API binary)
 * gives a fully interactive shell: prompts, colours, arrow keys, vim, password
 * prompts. If the native module cannot be loaded, sessions fall back to plain
 * pipes and say so (`mode: 'pipe'`); nothing pretends to be a TTY.
 */

interface PtyProcess {
  pid: number
  onData(cb: (d: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
interface PtyModule {
  spawn(file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string | undefined>; useConpty?: boolean }): PtyProcess
}

let pty: PtyModule | null = null
let ptyError: string | null = null
try {
  // Loaded lazily so a broken native binary never takes the app down.
  pty = createRequire(__filename)('@lydell/node-pty') as PtyModule
} catch (e) {
  ptyError = (e as Error).message
  console.warn('[agentbits] node-pty unavailable, using pipes:', ptyError)
}

interface Session extends TerminalSession {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  buffer: string
}

const MAX_BUFFER = 200_000
const isWin = process.platform === 'win32'
const sessions = new Map<string, Session>()
let counter = 0

function shellFor(interactive: boolean): { cmd: string; args: string[]; label: string } {
  if (isWin) {
    return interactive
      ? { cmd: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' }
      : { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], label: 'PowerShell' }
  }
  const sh = process.env.SHELL || '/bin/bash'
  return { cmd: sh, args: interactive ? ['-l'] : ['-i'], label: sh.split('/').pop() || 'sh' }
}

function push(s: Session, data: string): void {
  s.buffer += data
  if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-MAX_BUFFER)
  emit({ type: 'terminal:data', id: s.id, data })
}

const toPublic = (s: Session): TerminalSession => ({ id: s.id, title: s.title, shell: s.shell, cwd: s.cwd, alive: s.alive, mode: s.mode })

function killTree(pid: number | undefined, fallback: () => void): void {
  if (isWin && pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  else fallback()
}

function createPty(dir: string): Session | null {
  if (!pty) return null
  const { cmd, args, label } = shellFor(true)
  let proc: PtyProcess
  try {
    proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: dir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
  } catch (e) {
    ptyError = (e as Error).message
    console.warn('[agentbits] pty spawn failed, using pipes:', ptyError)
    return null
  }
  const s: Session = {
    id: randomUUID(),
    title: `${label} ${++counter}`,
    shell: label,
    cwd: dir,
    alive: true,
    mode: 'pty',
    buffer: '',
    write: (d) => proc.write(d),
    resize: (c, r) => {
      try {
        proc.resize(Math.max(10, c), Math.max(4, r))
      } catch {
        /* process already gone */
      }
    },
    kill: () => killTree(proc.pid, () => proc.kill())
  }
  proc.onData((d) => push(s, d))
  proc.onExit(({ exitCode }) => {
    s.alive = false
    push(s, `\r\n\x1b[90m${t('orchestrator:terminal.processExited', { code: String(exitCode) })}\x1b[0m\r\n`)
    emit({ type: 'terminal:exit', id: s.id, code: exitCode })
  })
  return s
}

function createPipe(dir: string): Session {
  const { cmd, args, label } = shellFor(false)
  const proc: ChildProcessWithoutNullStreams = spawn(cmd, args, {
    cwd: dir,
    windowsHide: true,
    env: { ...process.env, TERM: 'dumb', PYTHONIOENCODING: 'utf-8' }
  })
  const s: Session = {
    id: randomUUID(),
    title: `${label} ${++counter}`,
    shell: label,
    cwd: dir,
    alive: true,
    mode: 'pipe',
    buffer: '',
    write: (data) => {
      proc.stdin.write(data)
      // PowerShell in -Command - mode does not print a prompt; emulate one.
      if (isWin && data.endsWith('\n')) proc.stdin.write('Write-Host -NoNewline ("PS " + (Get-Location).Path + "> ")\n')
    },
    resize: () => undefined,
    kill: () => killTree(proc.pid, () => proc.kill())
  }
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', (d: string) => push(s, d))
  proc.stderr.on('data', (d: string) => push(s, d))
  proc.on('error', (e) => push(s, `\r\n${t('orchestrator:terminal.error', { message: e.message })}\r\n`))
  proc.on('exit', (code) => {
    s.alive = false
    push(s, `\r\n${t('orchestrator:terminal.processExited', { code: String(code) })}\r\n`)
    emit({ type: 'terminal:exit', id: s.id, code })
  })
  if (isWin) {
    proc.stdin.write('[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host -NoNewline ("PS " + (Get-Location).Path + "> ")\n')
  }
  push(s, `\x1b[90m${t('orchestrator:terminal.pipeMode', { shell: label, dir, reason: ptyError ? `: ${ptyError}` : '' })}\x1b[0m\r\n`)
  return s
}

export const terminals = {
  /** Whether real interactive terminals are available on this machine. */
  ptyAvailable(): boolean {
    return !!pty
  },

  list(): TerminalSession[] {
    return [...sessions.values()].map(toPublic)
  },

  create(cwd?: string): TerminalSession {
    const dir = cwd || homedir()
    const s = createPty(dir) ?? createPipe(dir)
    sessions.set(s.id, s)
    return toPublic(s)
  },

  write(id: string, data: string): void {
    const s = sessions.get(id)
    if (!s || !s.alive) return
    s.write(data)
  },

  resize(id: string, cols: number, rows: number): void {
    const s = sessions.get(id)
    if (!s || !s.alive || !Number.isFinite(cols) || !Number.isFinite(rows)) return
    s.resize(Math.floor(cols), Math.floor(rows))
  },

  buffer(id: string): string {
    return sessions.get(id)?.buffer ?? ''
  },

  kill(id: string): void {
    const s = sessions.get(id)
    if (!s) return
    if (s.alive) s.kill()
    sessions.delete(id)
  },

  killAll(): void {
    for (const id of [...sessions.keys()]) this.kill(id)
  }
}
