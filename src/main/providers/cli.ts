import { spawn, execFile } from 'child_process'
import { createInterface } from 'readline'
import { AbortedError } from './types'

const isWin = process.platform === 'win32'

/** Locate an executable on PATH (`where` on Windows, `which` elsewhere). */
export function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(isWin ? 'where' : 'which', [bin], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      // On Windows prefer a real .exe, then .cmd shims.
      const pick = isWin
        ? lines.find((l) => l.toLowerCase().endsWith('.exe')) ?? lines.find((l) => /\.(cmd|bat)$/i.test(l)) ?? lines[0]
        : lines[0]
      resolve(pick ?? null)
    })
  })
}

/** Quote an argument for cmd.exe when a .cmd shim forces shell execution. */
function quoteCmd(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"&|<>^%]/.test(arg)) return arg
  return '"' + arg.replace(/"/g, '""') + '"'
}

export interface SpawnLinesOptions {
  bin: string
  args: string[]
  cwd: string
  stdin?: string
  /** What the CLI inherits from Agentbits' environment — filtered (`agentEnv`), never `process.env` as is. */
  inherit: Record<string, string>
  env?: Record<string, string | undefined>
  signal: AbortSignal
  onLine: (line: string) => Promise<void> | void
  onStderr?: (line: string) => void
}

/**
 * Spawns a CLI, feeds `stdin`, and delivers stdout line by line. Awaiting inside
 * `onLine` applies back-pressure, which is how pause works for CLI runs.
 */
export function spawnLines(o: SpawnLinesOptions): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (o.signal.aborted) return reject(new AbortedError())
    const needsShell = isWin && /\.(cmd|bat)$/i.test(o.bin)
    const child = needsShell
      ? spawn([quoteCmd(o.bin), ...o.args.map(quoteCmd)].join(' '), {
          cwd: o.cwd,
          shell: true,
          windowsHide: true,
          env: { ...o.inherit, ...o.env }
        })
      : // Own process group on Unix, so stopping kills the CLI's children too (not only the direct child).
        spawn(o.bin, o.args, { cwd: o.cwd, windowsHide: true, env: { ...o.inherit, ...o.env }, detached: !isWin })

    let stderr = ''
    const onAbort = (): void => {
      if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
        // Anything that ignores SIGTERM goes after a grace period.
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL')
          } catch {
            /* already gone */
          }
        }, 3000).unref()
      }
    }
    o.signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      o.signal.removeEventListener('abort', onAbort)
      reject(e)
    })
    createInterface({ input: child.stderr }).on('line', (l) => {
      stderr += l + '\n'
      if (stderr.length > 20000) stderr = stderr.slice(-20000)
      o.onStderr?.(l)
    })

    const rl = createInterface({ input: child.stdout })
    const pump = (async () => {
      for await (const line of rl) await o.onLine(line)
    })()

    if (o.stdin !== undefined) {
      child.stdin.write(o.stdin)
    }
    child.stdin.end()

    child.on('close', async (code) => {
      o.signal.removeEventListener('abort', onAbort)
      let pumpError: unknown = null
      try {
        await pump
      } catch (e) {
        pumpError = e
      }
      if (o.signal.aborted) return reject(new AbortedError())
      // A failure while handling output (e.g. writing the transcript) fails the run instead of looking like success.
      if (pumpError) return reject(pumpError)
      resolve({ code, stderr })
    })
  })
}
