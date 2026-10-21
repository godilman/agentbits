import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Coins, FileText, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { UsagePanel } from './UsagePanel'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Empty } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, compact, timeAgo } from '@/lib/format'
import { Markdown } from '@/lib/markdown'
import { useProjectScope } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'

const USAGE = '__usage'

export function ReportsView() {
  const { t } = useTranslation(['common', 'reports'])
  const allReports = useAppStore((s) => s.reports)
  const reportsWindow = useAppStore((s) => s.reportsWindow)
  const loadMoreReports = useAppStore((s) => s.loadMoreReports)
  const stats = useAppStore((s) => s.stats)
  const agents = useAppStore((s) => s.agents)
  const refresh = useAppStore((s) => s.refresh)
  const toast = useAppStore((s) => s.toast)
  const { pid, project, teamIds } = useProjectScope()
  const [selected, setSelected] = useState<string | null>(null)
  // "Open the report" under a request's result in the chat.
  const focusReport = useAppStore((s) => s.focusReport)
  useEffect(() => {
    if (!focusReport) return
    setSelected(focusReport)
    useAppStore.setState({ focusReport: null })
  }, [focusReport])
  const [generating, setGenerating] = useState(false)
  // Custom report: the lead writes it on request from the project's data.
  const [asking, setAsking] = useState(false)
  const [request, setRequest] = useState('')
  const [writing, setWriting] = useState(false)
  const custom = async (): Promise<void> => {
    if (!pid || !request.trim()) return
    setWriting(true)
    try {
      const r = await call('reports:generateCustom', pid, request.trim())
      setSelected(r.id)
      setRequest('')
      setAsking(false)
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setWriting(false)
    }
  }
  const reports = useMemo(() => allReports.filter((r) => r.projectId === pid), [allReports, pid])
  const showUsage = selected === USAGE
  const report = showUsage ? undefined : reports.find((r) => r.id === selected) ?? reports[0]
  // Per-agent rows: project team, plus anyone who ran work in this project.
  const perAgent = useMemo(() => (stats?.perAgent ?? []).filter((p) => teamIds.has(p.agentId) || p.runs > 0), [stats, teamIds])

  useEffect(() => {
    void refresh('stats')
  }, [refresh, pid])

  const total = stats ? Object.values(stats.tasksByStatus).reduce((a, b) => a + b, 0) : 0
  // Of the runs that ended as success or failure: waiting, running, cancelled or stopped ones are neither.
  const finished = stats ? stats.runsSucceeded + stats.runsFailed : 0
  const successRate = finished ? Math.round((stats!.runsSucceeded / finished) * 100) : 0
  const maxDone = Math.max(1, ...perAgent.map((p) => p.done))

  const generate = async (): Promise<void> => {
    if (!pid) return
    setGenerating(true)
    try {
      const r = await call('reports:generateDaily', pid)
      setSelected(r.id)
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-5 gap-px border-b border-line bg-line">
        <Stat label={t('reports:stats.done')} value={stats?.tasksByStatus.done ?? 0} sub={t('reports:stats.doneSub', { total })} />
        <Stat
          label={t('reports:stats.active')}
          value={(stats?.tasksByStatus.in_progress ?? 0) + (stats?.tasksByStatus.in_review ?? 0)}
          sub={t('reports:stats.activeSub', { count: stats?.tasksByStatus.in_review ?? 0 })}
        />
        <Stat label={t('reports:stats.successRate')} value={`${successRate}%`} sub={t('reports:stats.successSub', { runs: stats?.runsTotal ?? 0, failed: stats?.runsFailed ?? 0 })} />
        <Stat
          label={t('reports:stats.tokens')}
          value={compact((stats?.tokensIn ?? 0) + (stats?.tokensOut ?? 0))}
          sub={stats?.costUsd ? t('reports:stats.tokensCost', { cost: `$${stats.costUsd.toFixed(3)}` }) : t('reports:stats.tokensSub')}
        />
        <Stat label={t('reports:stats.memory')} value={`${stats?.memories ?? 0} / ${stats?.decisions ?? 0}`} sub={t('reports:stats.memorySub')} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-line">
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line p-3">
            <div className="panel-title mb-2.5">{t('reports:list.agentPerformance')}</div>
            <div className="space-y-2">
              {perAgent.length === 0 && <div className="text-[13px] text-zinc-500">{t('reports:list.noRuns')}</div>}
              {perAgent.map((p) => {
                const a = agentById(agents, p.agentId)
                return (
                  <div key={p.agentId} className="flex items-center gap-2">
                    <PixelAvatar agent={a} size={18} />
                    <span className="w-20 shrink-0 truncate text-[13px] text-zinc-400">{a?.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-sm bg-white/[0.04]">
                      <div className="h-full rounded-sm" style={{ width: `${(p.done / maxDone) * 100}%`, background: a?.color ?? '#6366f1' }} />
                    </div>
                    <span className="min-w-6 text-right font-mono text-[11px] text-zinc-400">{p.done}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-y-1 px-3 pb-1.5 pt-3">
            <span className="panel-title" title={project?.name}>{t('reports:list.title')}</span>
            <div className="flex items-center gap-1">
              <button className="btn-outline h-6 text-[12px]" disabled={writing} onClick={() => setAsking((v) => !v)} title={t('reports:custom.hint')}>
                <Sparkles size={12} /> {t('reports:custom.button')}
              </button>
              <button className="btn-outline h-6 text-[12px]" disabled={generating} onClick={() => void generate()}>
                <CalendarDays size={12} /> {t('reports:list.daily')}
              </button>
            </div>
          </div>
          {asking && (
            <div className="mx-3 mb-2 rounded-md border border-line bg-surface-2 p-2">
              <textarea
                data-testid="custom-report-request"
                className="textarea min-h-[56px] w-full text-[13px]"
                rows={3}
                autoFocus
                placeholder={t('reports:custom.placeholder')}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void custom()
                }}
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 gap-y-1">
                <span className="min-w-0 text-[11px] text-zinc-400">{t('reports:custom.note')}</span>
                <button className="btn-primary h-6 text-[12px]" disabled={writing || !request.trim()} onClick={() => void custom()}>
                  {writing && <Loader2 size={12} className="animate-spin" />} {t('reports:custom.write')}
                </button>
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            <button
              onClick={() => setSelected(USAGE)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left', showUsage ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]')}
            >
              <Coins size={16} className="text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-zinc-200">{t('reports:usage.title')}</div>
                <div className="text-[12px] text-zinc-400">{t('reports:list.usageSub')}</div>
              </div>
            </button>
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={cn('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left', report?.id === r.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]')}
              >
                {r.agentId ? <PixelAvatar agent={agentById(agents, r.agentId)} size={20} /> : <CalendarDays size={16} className="mt-0.5 text-indigo-300" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-zinc-200">{r.title}</div>
                  <div className="text-[11px] text-zinc-400">
                    {r.kind === 'daily' ? t('reports:list.kindDaily') : r.kind === 'custom' ? t('reports:list.kindCustom') : t('reports:list.kindTask')} · {timeAgo(r.createdAt)}
                  </div>
                </div>
              </button>
            ))}
            {reports.length >= reportsWindow && (
              <button className="btn-outline mt-1 h-7 w-full justify-center text-[12px]" onClick={() => void loadMoreReports()}>
                {t('reports:list.showOlder')}
              </button>
            )}
          </div>
        </div>
        <div className="selectable min-w-0 flex-1 overflow-y-auto">
          {showUsage && pid ? (
            <UsagePanel projectId={pid} />
          ) : report ? (
            <div className="mx-auto max-w-3xl px-8 py-6">
              <div className="mb-2 flex justify-end">
                <button className="btn-danger h-6 text-[12px]" onClick={() => void call('reports:delete', report.id)}>
                  <Trash2 size={12} /> {t('actions.delete')}
                </button>
              </div>
              <Markdown text={report.bodyMd} />
            </div>
          ) : (
            <Empty icon={<FileText size={18} />} title={t('reports:list.emptyTitle')} hint={t('reports:list.emptyHint')} />
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="bg-canvas px-5 py-4">
      <div className="text-[12px] font-medium uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-medium tabular-nums text-zinc-100">{value}</div>
      <div className="text-[12px] text-zinc-400">{sub}</div>
    </div>
  )
}
