import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Bot, Plus, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TerminalSession } from '@shared/types'
import { Empty } from '@/components/common/ui'
import { apiError, bridge, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { AgentGrid } from './AgentGrid'

/**
 * Terminal section, two clearly separate things:
 * - "Agent terminals": live transcripts of the agents + natural-language instructions
 * - "Shells": operating-system shells where the user types commands (real PTY when available)
 */
type Mode = 'agents' | 'shells'

export function TerminalView({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('agents')
  const working = useAppStore((s) => s.activeRuns.filter((r) => r.projectId === s.activeProjectId).length)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-[#0c0c0e] px-3">
        <ModeTab active={mode === 'agents'} onClick={() => setMode('agents')} icon={<Bot size={13} />} label={t('terminal:tabs.agents')} hint={t('terminal:tabs.agentsHint')}>
          {working > 0 && <span className="rounded bg-emerald-500/15 px-1 font-mono text-[10px] text-emerald-300">{working}</span>}
        </ModeTab>
        <ModeTab active={mode === 'shells'} onClick={() => setMode('shells')} icon={<SquareTerminal size={13} />} label={t('terminal:tabs.shells')} hint={t('terminal:tabs.shellsHint')} />
        <span className="ml-auto text-[11px] text-zinc-500">
          {mode === 'agents' ? t('terminal:tabs.agentsNote') : t('terminal:tabs.shellsNote')}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={mode === 'agents' ? 'h-full' : 'hidden'}>
          <AgentGrid />
        </div>
        <div className={mode === 'shells' ? 'h-full' : 'hidden'}>
          <ShellPanel active={active && mode === 'shells'} />
        </div>
      </div>
    </div>
  )
}

function ModeTab({ active, onClick, icon, label, hint, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string; children?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium',
        active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      )}
    >
      {icon}
      {label}
      {children}
    </button>
  )
}

/* ───────────────────────────── user shells ───────────────────────────── */

function ShellPanel({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selRef = useRef<TerminalSession | null>(null)
  const lineRef = useRef('')
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootPath = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.rootPath ?? '')
  const sel = sessions.find((s) => s.id === selId) ?? null

  const sendSize = (): void => {
    const s = selRef.current
    const term = termRef.current
    if (s?.mode === 'pty' && s.alive && term) void call('terminal:resize', s.id, term.cols, term.rows).catch(() => undefined)
  }

  // create xterm once
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 5000,
      theme: {
        background: '#00000000',
        foreground: '#d4d4d8',
        cursor: '#818cf8',
        selectionBackground: '#3730a380',
        black: '#18181b',
        brightBlack: '#52525b',
        blue: '#818cf8',
        brightBlue: '#a5b4fc',
        cyan: '#67e8f9',
        green: '#34d399',
        yellow: '#fbbf24',
        red: '#fb7185',
        magenta: '#e879f9',
        white: '#e4e4e7'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    termRef.current = term
    fitRef.current = fit
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        sendSize()
      } catch {
        /* hidden */
      }
    })
    ro.observe(hostRef.current!)

    term.onData((data) => {
      const s = selRef.current
      if (!s || !s.alive) return
      // A real PTY gets every keystroke (arrows, Ctrl+C, tab completion, full-screen apps).
      if (s.mode === 'pty') {
        void call('terminal:write', s.id, data)
        return
      }
      // Pipe fallback: minimal local line editing, the line is sent on Enter.
      for (const ch of data) {
        if (ch === '\r') {
          term.write('\r\n')
          void call('terminal:write', s.id, lineRef.current + '\n')
          lineRef.current = ''
        } else if (ch === '\x7f' || ch === '\b') {
          if (lineRef.current.length) {
            lineRef.current = lineRef.current.slice(0, -1)
            term.write('\b \b')
          }
        } else if (ch === '\x03') {
          term.write('^C\r\n')
          lineRef.current = ''
        } else if (ch >= ' ' || ch === '\t') {
          lineRef.current += ch
          term.write(ch)
        }
      }
    })

    const off = bridge().on((e) => {
      const s = selRef.current
      if (e.type === 'terminal:data' && s?.id === e.id) term.write(e.data)
      if (e.type === 'terminal:exit') void call('terminal:list').then(setSessions)
    })
    void call('terminal:list').then(setSessions)
    return () => {
      off()
      ro.disconnect()
      term.dispose()
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit()
        sendSize()
        termRef.current?.focus()
      } catch {
        /* hidden */
      }
    }, 30)
    return () => clearTimeout(t)
  }, [active, selId])

  // switch selection → replay its buffer
  useEffect(() => {
    selRef.current = sel
    lineRef.current = ''
    const term = termRef.current
    if (!term) return
    term.reset()
    if (!sel) return
    // pipe mode needs \n → \r\n; a PTY already emits terminal sequences
    term.options.convertEol = sel.mode === 'pipe'
    void call('terminal:buffer', sel.id).then((b) => {
      if (selRef.current?.id === sel.id) term.write(b)
    })
    sendSize()
    term.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, sel?.mode])

  const newShell = async (): Promise<void> => {
    setError(null)
    try {
      const s = await call('terminal:create', rootPath || undefined)
      setSessions(await call('terminal:list'))
      setSelId(s.id)
    } catch (e) {
      setError(apiError(e))
    }
  }

  const kill = async (id: string): Promise<void> => {
    await call('terminal:kill', id)
    setSessions(await call('terminal:list'))
    if (selId === id) setSelId(null)
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-[220px] shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
          <span className="panel-title">{t('terminal:tabs.shells')}</span>
          <button className="icon-btn" title={t('terminal:shell.new')} onClick={() => void newShell()}>
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-0.5 px-2">
          {sessions.length === 0 && (
            <button onClick={() => void newShell()} className="w-full rounded-md border border-dashed border-line px-3 py-2 text-left text-[12px] text-zinc-400 hover:text-zinc-200">
              {t('terminal:shell.open')}
            </button>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelId(s.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                selId === s.id ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03]'
              )}
            >
              <SquareTerminal size={14} className={s.alive ? 'text-emerald-400' : 'text-zinc-500'} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
              {s.mode === 'pipe' && <span className="text-[12px] text-amber-300/80">pipe</span>}
              <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title={t('actions.close')} onClick={(e) => (e.stopPropagation(), void kill(s.id))}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        {error && <div className="mx-2 mt-2 rounded border border-rose-500/30 bg-rose-500/[0.06] px-2 py-1.5 text-[12px] text-rose-200">{error}</div>}
      </nav>

      <div className="relative min-w-0 flex-1 bg-[#0a0a0c]">
        {sel && (
          <div className="flex h-9 items-center gap-2 border-b border-line px-4 text-[12px] text-zinc-400">
            <SquareTerminal size={13} />
            <span className="truncate font-mono">{sel.cwd}</span>
            {sel.mode === 'pty' ? (
              <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 text-[12px] text-emerald-300">{t('terminal:shell.pty')}</span>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 text-[12px] text-amber-300" title={t('terminal:shell.pipeTitle')}>
                <TriangleAlert size={11} /> {t('terminal:shell.pipe')}
              </span>
            )}
          </div>
        )}
        <div ref={hostRef} className={cn('absolute inset-x-0 bottom-0 px-1', sel ? 'top-9' : 'top-0 invisible')} />
        {!sel && (
          <Empty
            icon={<SquareTerminal size={18} />}
            title={t('terminal:shell.emptyTitle')}
            hint={
              rootPath
                ? t('terminal:shell.emptyHintFolder', { path: rootPath })
                : t('terminal:shell.emptyHintNoFolder')
            }
            action={
              <button className="btn-primary" onClick={() => void newShell()}>
                <Plus size={14} /> {t('terminal:shell.new')}
              </button>
            }
          />
        )}
      </div>
    </div>
  )
}
