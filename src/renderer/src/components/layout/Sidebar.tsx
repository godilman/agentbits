import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Coffee, Eye, Loader2, Pause, Play, Send, ShieldAlert, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent, Message, Project, Run, Task } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { ProgressBar } from '@/components/common/ui'
import { useResize } from '@/components/common/Resize'
import { call } from '@/lib/api'
import { clock, cn, duration, STATUS_META } from '@/lib/format'
import { isReviewNote, isTypingNote, useProjectScope } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'

export function Sidebar() {
  const view = useAppStore((s) => s.view)
  const runningRef = useRef<HTMLElement>(null)
  const teamRef = useRef<HTMLElement>(null)
  const [width, widthHandle] = useResize('sidebar', 300, { min: 220, max: 560 })
  const [runningMax, runningHandle] = useResize('sidebarRunning', Math.round(window.innerHeight * 0.4), { min: 80, max: 2000, axis: 'y', measure: runningRef })
  const [teamMax, teamHandle] = useResize('sidebarTeam', 400, { min: 48, max: 2000, axis: 'y', measure: teamRef })
  // The org page has no project context: only the cross-project running work is shown there.
  return (
    <>
      <aside className="flex shrink-0 flex-col border-r border-line bg-[#0c0c0e]" style={{ width }}>
        <RunningWork fill={view === 'org'} sectionRef={runningRef} maxHeight={runningMax} />
        {view === 'project' && (
          <>
            {runningHandle}
            <TeamStrip sectionRef={teamRef} maxHeight={teamMax} />
            {teamHandle}
            <LiveFeed />
          </>
        )}
      </aside>
      {widthHandle}
    </>
  )
}

/* ───────────────────────────── running work ───────────────────────────── */

function RunningWork({ fill = false, sectionRef, maxHeight }: { fill?: boolean; sectionRef: React.RefObject<HTMLElement | null>; maxHeight: number }) {
  const { t } = useTranslation()
  const allRuns = useAppStore((s) => s.activeRuns)
  const agents = useAppStore((s) => s.agents)
  const tasks = useAppStore((s) => s.tasks)
  const projects = useAppStore((s) => s.projects)
  const view = useAppStore((s) => s.view)
  const activePid = useAppStore((s) => s.activeProjectId)
  // On the org page every run gets its project chip.
  const pid = view === 'org' ? null : activePid
  const [, force] = useState(0)
  // Every project's runs; the active project's come first.
  const runs = useMemo(
    () => [...allRuns].sort((a, b) => Number(a.projectId !== pid) - Number(b.projectId !== pid)),
    [allRuns, pid]
  )
  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // non-run activity (lead reviewing, someone typing a reply)
  const side = agents.filter(
    (a) => a.status === 'working' && !runs.some((r) => r.agentId === a.id) && a.statusNote
  )
  const total = runs.length + side.length

  return (
    <section ref={sectionRef} className={cn('flex flex-col', fill ? 'min-h-0 flex-1' : 'min-h-[80px] border-b border-line')} style={fill ? undefined : { maxHeight }}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="panel-title">{t('layout:sidebar.runningWork')}</span>
          <span className="rounded bg-white/5 px-1.5 font-mono text-[10px] text-zinc-400">{total}</span>
        </div>
        {total > 0 && (
          <span className="flex items-center gap-1 text-[10.5px] text-emerald-400/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> {t('layout:sidebar.live')}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {total === 0 && (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-zinc-400">
            <Coffee size={14} /> {t('layout:sidebar.noRunningWork')}
          </div>
        )}
        {runs.map((r) => (
          <RunCard
            key={r.id}
            run={r}
            agent={agentById(agents, r.agentId)}
            task={tasks.find((x) => x.id === r.taskId)}
            otherProject={r.projectId && r.projectId !== pid ? projects.find((p) => p.id === r.projectId) : undefined}
            openOther={view === 'org'}
          />
        ))}
        {side.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-md bg-white/[0.02] px-2 py-1.5">
            <PixelAvatar agent={a} size={22} />
            <div className="min-w-0 flex-1 text-[12px]">
              <span className="font-medium text-zinc-200">{a.name}</span>
              <span className="text-zinc-400"> — {a.statusNote}</span>
            </div>
            {isReviewNote(a.statusNote) ? <Eye size={13} className="text-violet-400" /> : <Loader2 size={13} className="animate-spin text-zinc-400" />}
          </div>
        ))}
      </div>
    </section>
  )
}

function RunCard({
  run,
  agent,
  task,
  otherProject,
  openOther = false
}: {
  run: Run
  agent?: Agent
  task?: Task
  otherProject?: Project
  /** Org page: the chip "opens" the project instead of "switching" to it. */
  openOther?: boolean
}) {
  const { t } = useTranslation()
  const selectTask = useAppStore((s) => s.selectTask)
  const setTab = useAppStore((s) => s.setTab)
  const openProject = useAppStore((s) => s.openProject)
  const perms = useAppStore((s) => s.permissions.find((p) => p.agentId === run.agentId))
  const awaiting = run.status === 'awaiting_approval'
  const paused = run.status === 'paused'
  const open = (): void => {
    if (run.projectId) openProject(run.projectId) // switches project when the run belongs to another one
    if (task) selectTask(task.id)
    setTab('tasks')
  }

  return (
    <div
      className={cn(
        'group rounded-md border px-2.5 py-2 transition-colors animate-fade-in',
        awaiting ? 'border-amber-500/25 bg-amber-500/[0.06]' : 'border-line bg-surface hover:border-zinc-700'
      )}
    >
      <div className="flex items-center gap-2">
        <PixelAvatar agent={agent} size={22} />
        <button onClick={open} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[12.5px]">
            <span className="font-medium text-zinc-100">{agent?.name ?? '?'}</span>
            <span className="text-zinc-500"> — </span>
            <span className="font-mono text-[11.5px] text-zinc-400">{task?.key}</span>
            <span className={cn('ml-1', awaiting ? 'text-amber-300' : paused ? 'text-zinc-400' : 'text-emerald-400')}>
              {awaiting ? t('layout:sidebar.awaitingApproval') : paused ? t('layout:sidebar.paused') : t('layout:sidebar.working')}
            </span>
          </div>
        </button>
        {!awaiting && (
          <div className="flex items-center opacity-70 transition-opacity group-hover:opacity-100">
            <button
              className="icon-btn"
              title={paused ? t('layout:sidebar.resume') : t('layout:sidebar.pause')}
              onClick={() => void call(paused ? 'runs:resume' : 'runs:pause', run.id)}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
            <button className="icon-btn hover:text-rose-400" title={t('actions.stop')} onClick={() => void call('runs:stop', run.id)}>
              <Square size={11} />
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 pl-[30px]">
        {otherProject && (
          <button
            onClick={open}
            title={t(openOther ? 'layout:sidebar.openProjectOf' : 'layout:sidebar.switchToProject', { name: otherProject.name })}
            className="flex max-w-[110px] shrink-0 items-center gap-1 rounded bg-white/[0.05] px-1.5 py-px text-[10.5px] text-zinc-300 hover:bg-white/10"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: otherProject.color }} />
            <span className="truncate">{otherProject.name}</span>
          </button>
        )}
        <span className="truncate text-[11.5px] text-zinc-400">{task?.title}</span>
      </div>
      {awaiting ? (
        <div className="mt-2 pl-[30px]">
          <div className="mb-2 flex flex-wrap gap-1">
            <ShieldAlert size={12} className="mt-px text-amber-400" />
            {perms?.fsWrite && <Cap>{t('layout:sidebar.caps.fsWrite')}</Cap>}
            {perms?.terminal && <Cap>{t('layout:sidebar.caps.terminal')}</Cap>}
            {perms?.network && <Cap>{t('layout:sidebar.caps.network')}</Cap>}
            {perms && !perms.fsWrite && !perms.terminal && !perms.network && <Cap>{t('layout:sidebar.caps.readOnly')}</Cap>}
          </div>
          <div className="flex gap-1.5">
            <button className="btn h-6 bg-amber-500/90 px-2 text-[11.5px] text-black hover:bg-amber-400" onClick={() => void call('runs:approve', run.id, true)}>
              <Check size={12} /> {t('actions.approve')}
            </button>
            <button className="btn-ghost h-6 px-2 text-[11.5px]" onClick={() => void call('runs:approve', run.id, false)}>
              <X size={12} /> {t('actions.reject')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 pl-[30px]">
          <ProgressBar value={task?.progress ?? 0} tone={paused ? 'amber' : 'emerald'} />
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-zinc-400">
            {task?.progress ?? 0}% · {duration(run.startedAt)}
          </span>
        </div>
      )}
    </div>
  )
}

function Cap({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-amber-500/10 px-1.5 text-[10.5px] text-amber-200/90">{children}</span>
}

/* ───────────────────────────── team strip ───────────────────────────── */

function TeamStrip({ sectionRef, maxHeight }: { sectionRef: React.RefObject<HTMLElement | null>; maxHeight: number }) {
  const { t } = useTranslation()
  const { team: agents } = useProjectScope()
  const selectAgent = useAppStore((s) => s.selectAgent)
  const setTab = useAppStore((s) => s.setTab)
  return (
    <section ref={sectionRef} className="min-h-[48px] overflow-y-auto border-b border-line px-3 py-2.5" style={{ maxHeight }}>
      <div className="mb-2 flex items-center justify-between">
        <button className="panel-title hover:text-zinc-200" onClick={() => setTab('team')} title={t('layout:sidebar.teamTitle')}>
          {t('layout:sidebar.team')}
        </button>
        <span className="text-[10.5px] text-zinc-400">
          {t('layout:sidebar.activeCount', {
            working: agents.filter((a) => a.status === 'working').length,
            enabled: agents.filter((a) => a.enabled).length
          })}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.length === 0 && (
          <button className="text-[11.5px] text-zinc-400 hover:text-zinc-200" onClick={() => setTab('team')}>
            {t('layout:sidebar.noTeam')}
          </button>
        )}
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              selectAgent(a.id)
              setTab('office')
            }}
            className="rounded-md transition-transform hover:-translate-y-px"
            title={`${a.name} · ${a.role} · ${STATUS_META[a.status].label}${a.statusNote ? ` (${a.statusNote})` : ''}`}
          >
            <PixelAvatar agent={a} size={28} showStatus className={a.status === 'offline' ? 'opacity-40 grayscale' : ''} />
          </button>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────────── live feed ───────────────────────────── */

function LiveFeed() {
  const { t } = useTranslation()
  const feed = useAppStore((s) => s.feed)
  const agents = useAppStore((s) => s.agents)
  const tasks = useAppStore((s) => s.tasks)
  const setChatChannel = useAppStore((s) => s.setChatChannel)
  const setTab = useAppStore((s) => s.setTab)
  const { pid, lead, team } = useProjectScope()
  const typing = useMemo(() => team.filter((a) => isTypingNote(a.statusNote)), [team])
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')

  const items = useMemo(() => feed.filter((m) => m.projectId === pid).slice(-80), [feed, pid])
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [items.length, typing.length])

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) return
    if (!pid) return
    setDraft('')
    await call('messages:send', 'general', text, pid)
  }

  const channelLabel = (m: Message): string | null => {
    if (m.channel === 'general') return null
    if (m.channel.startsWith('task:')) return tasks.find((x) => x.id === m.channel.slice(5))?.key ?? t('layout:sidebar.taskChannel')
    if (m.channel.startsWith('agent:')) return 'DM'
    return m.channel
  }

  return (
    <section className="flex min-h-[160px] flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <span className="panel-title">{t('layout:sidebar.liveChat')}</span>
        <button
          className="text-[10.5px] text-zinc-400 hover:text-zinc-200"
          onClick={() => {
            setChatChannel('general')
            setTab('chat')
          }}
        >
          {t('layout:sidebar.openAll')}
        </button>
      </div>
      <div ref={ref} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-1">
        {items.length === 0 && typing.length === 0 && (
          <div className="py-4 text-center text-[11.5px] text-zinc-500">{t('layout:sidebar.noMessages')}</div>
        )}
        {items.map((m) => {
          const a = m.senderType === 'agent' ? agentById(agents, m.senderId) : undefined
          const ch = channelLabel(m)
          if (m.senderType === 'system') {
            return (
              <div key={m.id} className="rounded bg-white/[0.025] px-2 py-1 text-[11.5px] leading-snug text-zinc-400 animate-fade-in">
                {m.content}
              </div>
            )
          }
          return (
            <div key={m.id} className="flex gap-2 animate-fade-in">
              {m.senderType === 'user' ? (
                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-zinc-700 text-[9px] font-bold text-zinc-200">
                  {t('layout:sidebar.youBadge')}
                </div>
              ) : (
                <PixelAvatar agent={a} size={18} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: a ? a.color : '#e4e4e7' }}>
                    {m.senderType === 'user' ? t('layout:sidebar.you') : a?.name ?? t('layout:sidebar.agent')}
                  </span>
                  {ch && <span className="rounded bg-white/5 px-1 font-mono text-[9.5px] text-zinc-400">{ch}</span>}
                  <span className="ml-auto text-[10px] text-zinc-400">{clock(m.createdAt)}</span>
                </div>
                <div className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-snug text-zinc-400">
                  {preview(m.content)}
                </div>
              </div>
            </div>
          )
        })}
        {typing.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-[11.5px] text-zinc-400">
            <PixelAvatar agent={a} size={18} />
            <span>{t('layout:sidebar.typing', { name: a.name })}</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 pl-2.5 pr-1 focus-within:border-accent/50">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
            placeholder={lead ? t('layout:sidebar.placeholderLead', { name: lead.name }) : t('layout:sidebar.placeholder')}
            className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-zinc-200 outline-none placeholder:text-zinc-400"
          />
          <button className="icon-btn h-6 w-6 text-indigo-300 disabled:opacity-30" disabled={!draft.trim()} onClick={() => void send()}>
            <Send size={13} />
          </button>
        </div>
      </div>
    </section>
  )
}

/** One-line-ish preview of markdown: drop headings/fences, flatten bullets. */
function preview(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((l) => l.trim() && !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '• ').replace(/[*`]/g, ''))
    .join('\n')
}
