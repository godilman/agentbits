import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Crown,
  Expand,
  ListPlus,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pause,
  Play,
  Send,
  Square,
  User
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { Agent, AgentInstruction, AgentLog, InstructionMode, Run } from '@shared/types'
import { steeringFor } from '@shared/steering'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { TokenStrip } from '@/components/common/TokenUsage'
import { locale, t as tr } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { subscribeTranscript } from '@/lib/transcripts'
import { useAppStore } from '@/store/useAppStore'
import { useAttachments, useFileDrop } from '@/features/files/hooks'
import { AttachButton, AttachmentTray, DropOverlay, FileChip } from '@/features/files/parts'

/**
 * One agent's live terminal: its transcript (what it was asked, by whom, what it
 * does, tool calls, results, errors) plus a natural-language instruction box.
 * Agent sessions are not TTYs — this is not a shell; the Shells tab is.
 */

const PAGE = 300
const MAX_IN_MEMORY = 4000

const STATUS_META: Record<Agent['status'], { label: string; cls: string }> = {
  working: { get label() { return tr('terminal:pane.status.working') }, cls: 'bg-emerald-500/15 text-emerald-300' },
  idle: { get label() { return tr('terminal:pane.status.idle') }, cls: 'bg-white/5 text-zinc-400' },
  break: { get label() { return tr('terminal:pane.status.break') }, cls: 'bg-amber-500/10 text-amber-300' },
  error: { get label() { return tr('terminal:pane.status.error') }, cls: 'bg-rose-500/15 text-rose-300' },
  offline: { get label() { return tr('terminal:pane.status.offline') }, cls: 'bg-white/5 text-zinc-500' }
}

const time = (iso: string): string => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const AgentPane = memo(function AgentPane({
  agent,
  projectId,
  isLead,
  maximized,
  onToggleMaximize
}: {
  agent: Agent
  projectId: string
  isLead: boolean
  maximized: boolean
  onToggleMaximize: () => void
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [stick, setStick] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [visible, setVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const pending = useRef<AgentLog[]>([])
  const frame = useRef<number | null>(null)
  const visibleRef = useRef(true)
  const stickRef = useRef(true)
  const loadingRef = useRef(true)
  const [reloadKey, setReloadKey] = useState(0)

  const activeRuns = useAppStore((s) => s.activeRuns)
  const run: Run | undefined = useMemo(() => activeRuns.find((r) => r.agentId === agent.id), [activeRuns, agent.id])
  const task = useAppStore((s) => (run ? s.tasks.find((t) => t.id === run.taskId) : undefined))
  const providers = useAppStore((s) => s.providers)
  const provider = useMemo(
    () => (agent.providerId && providers.find((p) => p.id === agent.providerId)) || providers.find((p) => p.isDefault) || providers[0],
    [providers, agent.providerId]
  )
  const usage = useAppStore((s) => s.usage?.agents.find((u) => u.agentId === agent.id))

  /* ── history + live stream ── */

  useEffect(() => {
    let alive = true
    loadingRef.current = true
    setLoading(true)
    setLoadError(null)
    call('logs:list', { agentId: agent.id, projectId, limit: PAGE })
      .then((list) => {
        if (!alive) return
        // Entries that streamed in while loading are merged by id.
        const seen = new Set(list.map((l) => l.id))
        const extra = pending.current.filter((l) => !seen.has(l.id))
        pending.current = []
        setEntries([...list, ...extra])
        setHasOlder(list.length >= PAGE)
      })
      .catch((e) => alive && setLoadError(apiError(e)))
      .finally(() => {
        if (!alive) return
        loadingRef.current = false
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [agent.id, projectId, reloadKey])

  const flush = useCallback(() => {
    frame.current = null
    // While the history loads, live entries wait and are merged by the loader.
    if (loadingRef.current || !visibleRef.current || !pending.current.length) return
    const batch = pending.current
    pending.current = []
    setEntries((cur) => {
      const last = cur.length ? cur[cur.length - 1].id : 0
      const add = batch.filter((l) => l.id > last)
      if (!add.length) return cur
      const next = cur.concat(add)
      if (next.length > MAX_IN_MEMORY) {
        setHasOlder(true)
        return next.slice(next.length - MAX_IN_MEMORY)
      }
      return next
    })
    if (!stickRef.current) setUnseen((n) => n + batch.length)
  }, [])

  useEffect(
    () =>
      subscribeTranscript(
        agent.id,
        (log) => {
          if (log.projectId && log.projectId !== projectId) return
          pending.current.push(log)
          // Batch bursts into one render per frame; panes off screen catch up when visible.
          if (frame.current === null && visibleRef.current) frame.current = requestAnimationFrame(flush)
        },
        () => setReloadKey((k) => k + 1)
      ),
    [agent.id, projectId, flush]
  )

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting
      setVisible(e.isIntersecting)
      if (e.isIntersecting && pending.current.length && frame.current === null) frame.current = requestAnimationFrame(flush)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [flush])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  // Follow the output while the user is at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [entries, visible])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    stickRef.current = atBottom
    setStick(atBottom)
    if (atBottom) setUnseen(0)
  }

  const loadOlder = async (): Promise<void> => {
    const first = entries[0]
    if (!first) return
    const el = scrollRef.current
    const before = el?.scrollHeight ?? 0
    try {
      const older = await call('logs:list', { agentId: agent.id, projectId, beforeId: first.id, limit: PAGE })
      setHasOlder(older.length >= PAGE)
      setEntries((cur) => [...older, ...cur])
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - before
      })
    } catch (e) {
      setLoadError(apiError(e))
    }
  }

  /* ── fullscreen ── */

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen().catch(() => undefined)
  }

  // Files dropped anywhere on the pane go with the next instruction.
  const att = useAttachments(agent.enabled ? projectId : null)
  const drop = useFileDrop((files) => void att.addFiles(files), agent.enabled)

  const status = STATUS_META[agent.status]
  const runLabel = run?.status === 'paused' ? t('terminal:pane.paused') : run?.status === 'awaiting_approval' ? t('terminal:pane.awaitingApproval') : null

  return (
    <div
      ref={rootRef}
      data-agent-pane={agent.name}
      className={cn('relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-[#0a0a0c]', run ? 'border-emerald-500/25' : 'border-line', fullscreen && 'rounded-none')}
      {...drop.props}
    >
      <DropOverlay show={drop.over} label={t('terminal:pane.dropFiles', { name: agent.name })} />
      {/* header */}
      <div className="flex shrink-0 items-start gap-2.5 border-b border-line bg-[#0e0e11] px-3 py-2">
        <PixelAvatar agent={agent} size={28} showStatus />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-zinc-100">{agent.name}</span>
            {isLead && <Crown size={12} className="shrink-0 text-amber-300" aria-label={t('terminal:pane.projectLead')} />}
            <span className="truncate text-[11.5px] text-zinc-500">{agent.role}</span>
            <span className={cn('shrink-0 rounded px-1.5 text-[10px] font-medium', status.cls)}>{runLabel ?? status.label}</span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
            {task ? (
              <span className="min-w-0 truncate" title={task.title}>
                <span className="font-mono text-zinc-300">{task.key}</span> {task.title}
              </span>
            ) : (
              <span className="truncate text-zinc-500">{agent.statusNote || t('terminal:pane.noTask')}</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-[10.5px] text-zinc-500" title={t('terminal:pane.provider')}>
              {provider ? `${provider.label}${(agent.model || provider.model) ? ' · ' + (agent.model || provider.model) : ''}` : 'Demo'}
            </span>
            <TokenStrip task={run ? usage?.currentTask ?? null : undefined} session={usage?.session} allTime={usage?.allTime} reporting={usage?.reporting} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {run && run.status !== 'awaiting_approval' && (
            <button
              className="icon-btn h-6 w-6"
              title={run.status === 'paused' ? t('terminal:pane.resume') : t('terminal:pane.pause')}
              onClick={() => void call(run.status === 'paused' ? 'runs:resume' : 'runs:pause', run.id)}
            >
              {run.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
          {run && <StopButton runId={run.id} />}
          <button className="icon-btn h-6 w-6" title={maximized ? t('terminal:pane.backToGrid') : t('terminal:pane.maximize')} onClick={onToggleMaximize}>
            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button className="icon-btn h-6 w-6" title={fullscreen ? t('terminal:pane.exitFullscreen') : t('terminal:pane.fullscreen')} onClick={toggleFullscreen}>
            <Expand size={12} />
          </button>
        </div>
      </div>

      {/* transcript */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="selectable absolute inset-0 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-[1.45]">
          {hasOlder && (
            <button className="mb-2 w-full rounded border border-dashed border-line py-1 text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => void loadOlder()}>
              {t('terminal:pane.older')}
            </button>
          )}
          {loading && <div className="text-zinc-500">{t('status.loading')}</div>}
          {loadError && <div className="text-rose-300">{t('terminal:pane.loadFailed', { error: loadError })}</div>}
          {!loading && !entries.length && !loadError && (
            <div className="py-6 text-center font-sans text-[12px] text-zinc-500">
              {t('terminal:pane.empty')}
            </div>
          )}
          {entries.map((l) => (
            <Line key={l.id} log={l} />
          ))}
        </div>
        {!stick && unseen > 0 && (
          <button
            className="absolute bottom-2 right-3 flex items-center gap-1 rounded-full bg-indigo-500 px-2.5 py-1 text-[11px] text-white shadow-pop"
            onClick={() => {
              const el = scrollRef.current
              if (el) el.scrollTop = el.scrollHeight
            }}
          >
            <ArrowDown size={11} /> {t('terminal:pane.newEntries', { count: unseen })}
          </button>
        )}
      </div>

      <Composer agent={agent} projectId={projectId} run={run} providerKind={provider?.kind ?? 'mock'} att={att} onPaste={drop.onPaste} />
    </div>
  )
})

function StopButton({ runId }: { runId: string }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const timer = setTimeout(() => setConfirm(false), 3500)
    return () => clearTimeout(timer)
  }, [confirm])
  return confirm ? (
    <button className="h-6 rounded bg-rose-600 px-2 text-[11px] text-white hover:bg-rose-500" onClick={() => void call('runs:stop', runId)}>
      {t('terminal:pane.stopConfirm')}
    </button>
  ) : (
    <button className="icon-btn h-6 w-6 hover:text-rose-400" title={t('terminal:pane.stopTitle')} onClick={() => setConfirm(true)}>
      <Square size={11} />
    </button>
  )
}

/* ───────────────────────────── transcript line ───────────────────────────── */

const Line = memo(function Line({ log }: { log: AgentLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const stamp = <span className="mr-2 select-none text-zinc-600">{time(log.createdAt)}</span>
  switch (log.level) {
    case 'status':
      return (
        <div className="my-1.5 flex items-center gap-2 text-[10.5px] text-zinc-500">
          <span className="h-px flex-1 bg-line" />
          <span className="whitespace-pre-wrap">{log.message}</span>
          <span className="select-none text-zinc-600">{time(log.createdAt)}</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      )
    case 'prompt': {
      const full = typeof log.meta?.prompt === 'string' ? (log.meta.prompt as string) : null
      const sys = typeof log.meta?.system === 'string' ? (log.meta.system as string) : null
      return (
        <div className="my-1.5 rounded border border-indigo-500/25 bg-indigo-500/[0.06] px-2 py-1.5 font-sans">
          <div className="whitespace-pre-wrap text-[12px] text-indigo-100">
            {stamp}
            {log.message}
          </div>
          {(full || sys) && (
            <button className="mt-1 flex items-center gap-1 text-[10.5px] text-indigo-300/80 hover:text-indigo-200" onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {t('terminal:pane.fullPrompt')}
            </button>
          )}
          {open && (
            <div className="mt-1 space-y-1.5">
              {sys && (
                <details className="rounded bg-black/30 px-2 py-1">
                  <summary className="cursor-pointer text-[10.5px] text-zinc-400">{t('terminal:pane.systemPrompt')}</summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-zinc-400">{sys}</pre>
                </details>
              )}
              {full && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/30 px-2 py-1 font-mono text-[10.5px] text-zinc-300">{full}</pre>}
            </div>
          )}
        </div>
      )
    }
    case 'instruction':
      return (
        <div className="my-1.5 flex gap-1.5 rounded border border-amber-500/30 bg-amber-500/[0.07] px-2 py-1.5 font-sans text-[12px] text-amber-100">
          <User size={12} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="min-w-0 whitespace-pre-wrap">
            {stamp}
            {log.message}
            {typeof log.meta?.note === 'string' && <span className="ml-1.5 text-[10.5px] text-amber-300/70">({log.meta.note as string})</span>}
            {Array.isArray(log.meta?.files) && (log.meta.files as { id: string; name: string }[]).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(log.meta.files as { id: string; name: string }[]).map((f) => (
                  <FileChip key={f.id} fallback={f} />
                ))}
              </div>
            )}
          </div>
        </div>
      )
    default: {
      const cls =
        log.level === 'error'
          ? 'text-rose-300'
          : log.level === 'warn'
            ? 'text-amber-300'
            : log.level === 'tool'
              ? 'text-sky-300'
              : log.level === 'debug'
                ? 'text-zinc-500'
                : log.level === 'info'
                  ? 'text-cyan-300/90'
                  : 'text-zinc-200'
      return (
        <div className={cn('whitespace-pre-wrap break-words', cls)}>
          {stamp}
          {log.level === 'tool' ? '▸ ' : log.level === 'error' ? '✖ ' : ''}
          {log.message}
        </div>
      )
    }
  }
})

/* ───────────────────────────── instruction composer ───────────────────────────── */

function Composer({
  agent,
  projectId,
  run,
  providerKind,
  att,
  onPaste
}: {
  agent: Agent
  projectId: string
  run: Run | undefined
  providerKind: Parameters<typeof steeringFor>[0]
  att: ReturnType<typeof useAttachments>
  onPaste: (e: React.ClipboardEvent) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [queued, setQueued] = useState<AgentInstruction[]>([])
  const version = useAppStore((s) => s.instructionsVersion)
  const running = !!run && run.status !== 'awaiting_approval'
  const waiting = run?.status === 'awaiting_approval'
  const steering = steeringFor(providerKind)

  useEffect(() => {
    if (!run) return setQueued([])
    let alive = true
    call('instructions:list', { agentId: agent.id, limit: 20 })
      .then((l) => alive && setQueued(l.filter((i) => i.status === 'queued' && i.runId === run.id)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [agent.id, run, version])

  useEffect(() => {
    if (!info) return
    const timer = setTimeout(() => setInfo(null), 4000)
    return () => clearTimeout(timer)
  }, [info])

  const send = async (mode: InstructionMode): Promise<void> => {
    const body = text.trim()
    const fileIds = att.readyIds
    if ((!body && !fileIds.length) || busy) return
    if (att.uploading) return setError(t('terminal:composer.uploading'))
    setBusy(true)
    setError(null)
    try {
      const r = await call('agents:instruct', { agentId: agent.id, projectId, text: body, mode, expectedRunId: run?.id ?? null, fileIds })
      setText('')
      att.clear()
      setInfo(r.message)
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const primary: InstructionMode = running ? 'redirect' : waiting ? 'queue' : 'task'

  if (!agent.enabled) {
    return <div className="shrink-0 border-t border-line px-3 py-2 text-[11.5px] text-zinc-500">{t('terminal:composer.disabled')}</div>
  }

  return (
    <div className="shrink-0 border-t border-line bg-[#0e0e11] px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-zinc-500">
        <MessageSquareText size={11} className="text-indigo-300" />
        <span>
          <Trans i18nKey="terminal:composer.heading" components={{ b: <b className="font-medium text-zinc-400" /> }} />
        </span>
        {queued.length > 0 && (
          <span className="ml-auto rounded bg-amber-500/10 px-1.5 text-amber-300" title={queued.map((q) => `• ${q.source === 'lead' ? `${t('terminal:composer.fromLead')}: ` : ''}${q.text}`).join('\n')}>
            {t('terminal:composer.queued', { count: queued.length })}
          </span>
        )}
      </div>
      <AttachmentTray items={att.items} records={att.records} onRemove={att.remove} />
      <div className="flex items-end gap-1.5">
        <AttachButton onClick={() => void att.pick()} className="h-[34px] w-8" />
        <textarea
          className="textarea min-h-[34px] flex-1 resize-none py-1.5 text-[12px]"
          rows={1}
          value={text}
          placeholder={
            running
              ? t('terminal:composer.placeholderRunning', { name: agent.name })
              : waiting
                ? t('terminal:composer.placeholderWaiting')
                : t('terminal:composer.placeholderTask', { name: agent.name })
          }
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send(primary)
            }
          }}
        />
        {running ? (
          <>
            <button className="btn-primary h-[34px] px-2.5" disabled={(!text.trim() && !att.readyIds.length) || busy || att.uploading} onClick={() => void send('redirect')} title={`${steering.label} (Ctrl+Enter)`}>
              <Send size={13} /> {t('terminal:composer.redirect')}
            </button>
            <button className="btn-outline h-[34px] px-2.5" disabled={(!text.trim() && !att.readyIds.length) || busy || att.uploading} onClick={() => void send('queue')} title={t('terminal:composer.queueTitle')}>
              <ListPlus size={13} /> {t('terminal:composer.queue')}
            </button>
          </>
        ) : (
          <button className="btn-primary h-[34px] px-2.5" disabled={(!text.trim() && !att.readyIds.length) || busy || att.uploading} onClick={() => void send(primary)} title="Ctrl+Enter">
            <Send size={13} /> {waiting ? t('terminal:composer.queue') : t('terminal:composer.giveTask')}
          </button>
        )}
      </div>
      {(error || info || running) && (
        <div className={cn('mt-1 text-[10.5px]', error ? 'text-rose-300' : info ? 'text-emerald-300' : 'text-zinc-500')}>
          {error ?? info ?? steering.label}
        </div>
      )}
    </div>
  )
}
