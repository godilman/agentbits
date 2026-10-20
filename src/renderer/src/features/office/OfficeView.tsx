import { useEffect, useMemo, useRef } from 'react'
import { ArrowRight, MessageSquare, Pause, Pencil, Play, Power, Square, Terminal as TermIcon, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { TokenStrip, usageTitle } from '@/components/common/TokenUsage'
import { ProgressBar } from '@/components/common/ui'
import { call } from '@/lib/api'
import { clock, cn, compact, shownStatus, STATUS_META } from '@/lib/format'
import { useProjectScope } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'
import { OfficeEngine, type OfficeAgent } from './engine'

export function OfficeView({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<OfficeEngine | null>(null)
  // Only the active project's team is in the office (members + project lead).
  const { pid, team: agents, lead, members } = useProjectScope()
  const orgAgentCount = useAppStore((s) => s.agents.length)
  const runs = useAppStore((s) => s.activeRuns)
  const tasks = useAppStore((s) => s.tasks)
  const selectedId = useAppStore((s) => s.selectedAgentId)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const setTab = useAppStore((s) => s.setTab)

  const officeAgents: OfficeAgent[] = useMemo(
    () =>
      agents.map((agent) => {
        const run = runs.find((r) => r.agentId === agent.id)
        const away = !!run && !!run.projectId && run.projectId !== pid
        const task = run && !away ? tasks.find((t) => t.id === run.taskId) : null
        return {
          agent,
          lead: agent.id === lead?.id,
          away,
          paused: !away && run?.status === 'paused',
          awaitingApproval: !away && run?.status === 'awaiting_approval',
          taskKey: task?.key ?? (away ? null : agent.statusNote?.match(/TA-\d+/)?.[0] ?? null)
        }
      }),
    [agents, runs, tasks, pid, lead]
  )

  useEffect(() => {
    const engine = new OfficeEngine(canvasRef.current!)
    engineRef.current = engine
    engine.onSelect = (id) => useAppStore.getState().selectAgent(id)
    engine.start()
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) engine.resize(width, height)
    })
    ro.observe(wrapRef.current!)
    return () => {
      ro.disconnect()
      engine.destroy()
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setAgents(officeAgents)
  }, [officeAgents])

  useEffect(() => {
    if (engineRef.current) engineRef.current.selectedId = selectedId
  }, [selectedId])

  const counts = {
    working: agents.filter((a) => a.status === 'working').length,
    break: agents.filter((a) => a.status === 'break').length,
    idle: agents.filter((a) => a.status === 'idle').length,
    error: agents.filter((a) => a.status === 'error').length
  }

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0 p-4">
          <canvas ref={canvasRef} className="pixelated block h-full w-full" />
        </div>
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-1.5">
          {(['working', 'break', 'idle', 'error'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5 rounded-md border border-line bg-black/60 px-2 py-1 text-[12px] text-zinc-400 backdrop-blur">
              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[k].dot)} />
              {STATUS_META[k].label} <span className="font-mono text-zinc-300">{counts[k]}</span>
            </span>
          ))}
        </div>
        {members.length === 0 && (
          <div className="absolute inset-x-0 bottom-8 flex justify-center">
            {orgAgentCount === 0 ? (
              <div className="flex flex-wrap items-center gap-3 gap-y-2 rounded-lg border border-line bg-black/70 px-4 py-2.5 text-[13px] text-zinc-300 backdrop-blur" data-testid="office-empty">
                <Users size={15} className="text-zinc-400" />
                {t('office:emptyOrg')}
                <button className="btn-outline h-7" onClick={() => useAppStore.getState().showOrg('templates', pid)}>
                  {t('office:templates')}
                </button>
                <button className="btn-primary h-7" onClick={() => useAppStore.getState().openGuide()}>
                  {t('office:guide')} <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 gap-y-2 rounded-lg border border-line bg-black/70 px-4 py-2.5 text-[13px] text-zinc-300 backdrop-blur">
                <Users size={15} className="text-zinc-400" />
                {lead ? t('office:noTeamWithLead', { name: lead.name }) : t('office:noTeam')}
                <button className="btn-primary h-7" onClick={() => setTab('team')}>
                  {t('office:team')} <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
        )}
        {!active && <div className="absolute inset-0" />}
      </div>
      <AgentPanel selectedId={selectedId} onClose={() => selectAgent(null)} />
    </div>
  )
}

function AgentPanel({ selectedId, onClose }: { selectedId: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const { pid, team: agents, lead } = useProjectScope()
  const runs = useAppStore((s) => s.activeRuns)
  const allTasks = useAppStore((s) => s.tasks)
  const projects = useAppStore((s) => s.projects)
  const openProject = useAppStore((s) => s.openProject)
  const tasks = useMemo(() => allTasks.filter((t) => t.projectId === pid), [allTasks, pid])
  const logs = useAppStore((s) => s.logs)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const setChatChannel = useAppStore((s) => s.setChatChannel)
  const setTab = useAppStore((s) => s.setTab)
  const openAgentProfile = useAppStore((s) => s.openAgentProfile)
  const agent = agents.find((a) => a.id === selectedId)

  if (!agent) {
    return (
      <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-[#0c0c0e]">
        <div className="px-4 pb-2 pt-4">
          <div className="panel-title">{t('office:panel.title')}</div>
          <div className="mt-1 text-[12px] text-zinc-400">{t('office:panel.hint')}</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {agents.map((a) => {
            const run = runs.find((r) => r.agentId === a.id)
            const task = run && tasks.find((t) => t.id === run.taskId)
            const awayIn = run && run.projectId && run.projectId !== pid ? projects.find((p) => p.id === run.projectId) : undefined
            return (
              <button key={a.id} onClick={() => selectAgent(a.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-white/[0.04]">
                <PixelAvatar agent={a} size={30} showStatus className={awayIn ? 'opacity-50' : ''} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-200">{a.name}</span>
                    {a.id === lead?.id && <span className="shrink-0 rounded bg-indigo-500/15 px-1 text-[12px] font-semibold uppercase tracking-wide text-indigo-300">{t('project:lead')}</span>}
                  </div>
                  <div className="truncate text-[12px] text-zinc-400">
                    {awayIn ? t('office:panel.awayIn', { name: awayIn.name }) : task ? `${task.key} · ${task.title}` : a.statusNote || a.role}
                  </div>
                </div>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={cn('text-[12px]', shownStatus(a, runs).text)}>{shownStatus(a, runs).label}</span>
                  <AgentTokenTotal agentId={a.id} />
                </span>
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  const anyRun = runs.find((r) => r.agentId === agent.id)
  const awayIn = anyRun && anyRun.projectId && anyRun.projectId !== pid ? projects.find((p) => p.id === anyRun.projectId) : undefined
  const run = awayIn ? undefined : anyRun
  const task = run ? tasks.find((t) => t.id === run.taskId) : undefined
  const awayTask = awayIn && anyRun ? allTasks.find((t) => t.id === anyRun.taskId) : undefined
  const agentLogs = logs.filter((l) => l.agentId === agent.id).slice(-40)
  const done = tasks.filter((t) => t.assigneeId === agent.id && t.status === 'done').length
  const queue = tasks.filter((t) => t.assigneeId === agent.id && t.status === 'todo').length

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-[#0c0c0e] animate-fade-in">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <PixelAvatar agent={agent} size={48} showStatus />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-zinc-100">{agent.name}</div>
          <div className="text-[12px] text-zinc-400">{agent.role}</div>
          <div className={cn('mt-1 flex items-center gap-1.5 text-[12px]', shownStatus(agent, runs).text)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', shownStatus(agent, runs).dot)} />
            {shownStatus(agent, runs).label}
            {agent.statusNote && <span className="truncate text-zinc-400">· {agent.statusNote}</span>}
          </div>
          <button
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-indigo-300/90 hover:text-indigo-200"
            onClick={() => openAgentProfile(agent.id)}
          >
            <Pencil size={11} /> {t('office:panel.editProfile')}
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} title={t('actions.close')} aria-label={t('actions.close')}>
          <X size={14} />
        </button>
      </div>

      <AgentTokens agentId={agent.id} />

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
        <div className="bg-[#0c0c0e] px-4 py-2.5">
          <div className="font-mono text-[15px] text-zinc-100">{done}</div>
          <div className="text-[12px] uppercase tracking-wide text-zinc-400">{t('office:panel.done')}</div>
        </div>
        <div className="bg-[#0c0c0e] px-4 py-2.5">
          <div className="font-mono text-[15px] text-zinc-100">{queue}</div>
          <div className="text-[12px] uppercase tracking-wide text-zinc-400">{t('office:panel.queued')}</div>
        </div>
      </div>

      {awayIn && (
        <div className="border-b border-line p-4">
          <div className="panel-title mb-2">{t('office:panel.workingElsewhere')}</div>
          <div className="flex items-center gap-1.5 text-[13px] text-zinc-300">
            <span className="h-2 w-2 rounded-full" style={{ background: awayIn.color }} />
            {awayIn.name}
            {awayTask && <span className="truncate font-mono text-[11px] text-zinc-400">· {awayTask.key}</span>}
          </div>
          {awayTask && <div className="mt-1 line-clamp-2 text-[12px] text-zinc-400">{awayTask.title}</div>}
          <button className="btn-outline mt-2.5 h-6 text-[12px]" onClick={() => openProject(awayIn.id)}>
            {t('office:panel.goToProject')} <ArrowRight size={12} />
          </button>
        </div>
      )}

      {task && run && (
        <div className="border-b border-line p-4">
          <div className="panel-title mb-2">{t('office:panel.currentWork')}</div>
          <div className="text-[13px] text-zinc-200">
            <span className="font-mono text-zinc-400">{task.key}</span> {task.title}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={task.progress} tone={run.status === 'paused' ? 'amber' : 'emerald'} />
            <span className="font-mono text-[11px] text-zinc-400">{task.progress}%</span>
          </div>
          {run.status !== 'awaiting_approval' && (
            <div className="mt-3 flex gap-1.5">
              <button className="btn-outline h-6 text-[12px]" onClick={() => void call(run.status === 'paused' ? 'runs:resume' : 'runs:pause', run.id)}>
                {run.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
                {run.status === 'paused' ? t('office:panel.resume') : t('office:panel.pause')}
              </button>
              <button className="btn-danger h-6 text-[12px]" onClick={() => void call('runs:stop', run.id)}>
                <Square size={11} /> {t('office:panel.stop')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-3">
          <TermIcon size={12} className="text-zinc-400" />
          <span className="panel-title">{t('office:panel.activity')}</span>
        </div>
        <div className="selectable min-h-0 flex-1 overflow-y-auto px-4 pb-3 font-mono text-[12px] leading-[1.6]">
          {agentLogs.length === 0 && <div className="text-zinc-400">{t('office:panel.noLogs')}</div>}
          {agentLogs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="shrink-0 text-zinc-500">{clock(l.createdAt)}</span>
              <span
                className={cn(
                  'min-w-0 break-words',
                  l.level === 'error' ? 'text-rose-400' : l.level === 'tool' ? 'text-sky-300' : l.level === 'warn' ? 'text-amber-300' : l.level === 'output' ? 'text-zinc-400' : 'text-zinc-400'
                )}
              >
                {l.level === 'tool' ? '▸ ' : ''}
                {l.message}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 border-t border-line p-3">
        <button
          className="btn-outline flex-1"
          onClick={() => {
            setChatChannel(agent.id === lead?.id ? 'general' : `agent:${agent.id}`)
            setTab('chat')
          }}
        >
          <MessageSquare size={13} /> {t('office:panel.message')}
        </button>
        <button
          className={cn('btn-outline', !agent.enabled && 'text-emerald-300')}
          title={agent.enabled ? t('office:panel.goOffline') : t('office:panel.goOnline')}
          onClick={() => void call('agents:save', { enabled: !agent.enabled }, agent.id)}
        >
          <Power size={13} />
        </button>
      </div>
    </aside>
  )
}

/** Token usage of one agent: current task / this session / all time, with the breakdown on hover. */
function AgentTokens({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const u = useAppStore((s) => s.usage?.agents.find((x) => x.agentId === agentId))
  if (!u) return null
  return (
    <div className="border-b border-line px-4 py-2.5">
      <div className="panel-title mb-1">{t('office:panel.tokens')}</div>
      <TokenStrip task={u.currentTaskId ? u.currentTask : undefined} session={u.session} allTime={u.allTime} reporting={u.reporting} />
    </div>
  )
}

function AgentTokenTotal({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const u = useAppStore((s) => s.usage?.agents.find((x) => x.agentId === agentId))
  if (!u?.allTime.calls) return null
  return (
    <span className="font-mono text-[11px] text-zinc-500" title={usageTitle(t('office:allTime'), u.allTime, u.reporting)}>
      {compact(u.allTime.total)} tk
    </span>
  )
}
