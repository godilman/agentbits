import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Coins } from 'lucide-react'
import type { UsageSummary, UsageTotals } from '@shared/types'
import { USAGE_REPORTING_LABEL } from '@shared/steering'
import { locale } from '@/i18n'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { UsageCells, usageTitle } from '@/components/common/TokenUsage'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, compact } from '@/lib/format'
import { agentById, useAppStore } from '@/store/useAppStore'

type Scope = 'project' | 'all'
type Day = { day: string; input: number; output: number; cache: number }

/** Reports → Token kullanımı: totals, per-agent breakdown and the last 14 days. */
export function UsagePanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation(['common', 'reports'])
  const agents = useAppStore((s) => s.agents)
  const live = useAppStore((s) => s.usage) // changes on every usage:changed → refetch below
  const [scope, setScope] = useState<Scope>('project')
  const [data, setData] = useState<UsageSummary | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const pid = scope === 'project' ? projectId : null
    Promise.all([call('usage:summary', pid), call('usage:daily', 14, pid)])
      .then(([s, d]) => {
        if (!alive) return
        setData(s)
        setDays(d)
        setError(null)
      })
      .catch((e) => alive && setError(apiError(e)))
    return () => {
      alive = false
    }
  }, [scope, projectId, live])

  const rows = useMemo(
    () => (data?.agents ?? []).filter((a) => a.allTime.calls > 0 || a.session.calls > 0).sort((a, b) => b.allTime.total - a.allTime.total),
    [data]
  )
  const maxDay = Math.max(1, ...days.map((d) => d.input + d.output + d.cache))

  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Coins size={16} className="text-indigo-300" />
        <h2 className="text-[16px] font-semibold text-zinc-100">{t('reports:usage.title')}</h2>
        <div className="ml-auto">
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'project', label: t('reports:usage.scope.project') },
              { value: 'all', label: t('reports:usage.scope.all') }
            ]}
          />
        </div>
      </div>
      {error && <div className="mb-3 rounded border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">{error}</div>}

      <div className="mb-5 grid grid-cols-3 gap-3 lg:grid-cols-6">
        <Card
          label={t('reports:usage.session')}
          t={data?.session}
          value={data?.session.total}
          sub={data ? t('reports:usage.sessionSince', { time: new Date(data.sessionStartedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : ''}
        />
        <Card label={t('reports:usage.allTime')} t={data?.allTime} value={data?.allTime.total} sub={t('reports:usage.records', { count: data?.allTime.calls ?? 0 })} />
        <Card label={t('reports:usage.input')} value={data?.allTime.input} sub={t('reports:usage.inputSub')} />
        <Card label={t('reports:usage.output')} value={data?.allTime.output} sub={t('reports:usage.outputSub')} />
        <Card
          label={t('reports:usage.cache')}
          value={(data?.allTime.cacheRead ?? 0) + (data?.allTime.cacheWrite ?? 0)}
          sub={t('reports:usage.cacheSub', { read: compact(data?.allTime.cacheRead ?? 0), write: compact(data?.allTime.cacheWrite ?? 0) })}
        />
        <Card label={t('reports:usage.cost')} text={data?.allTime.costUsd ? `$${data.allTime.costUsd.toFixed(3)}` : '—'} sub={t('reports:usage.costSub')} />
      </div>

      <div className="card mb-5 overflow-hidden">
        <table className="w-full text-[12px] text-zinc-300">
          <thead className="border-b border-line text-[10.5px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('reports:usage.columns.agent')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.columns.currentTask')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.columns.session')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.input')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.output')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.cache')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('reports:usage.columns.total')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('reports:usage.columns.source')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((u) => {
              const a = agentById(agents, u.agentId)
              return (
                <tr key={u.agentId} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <PixelAvatar agent={a} size={18} />
                      <span className="text-zinc-200">{a?.name ?? t('reports:usage.deletedAgent')}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" title={usageTitle(t('reports:usage.columns.currentTask'), u.currentTask)}>
                    {u.currentTask?.calls ? compact(u.currentTask.total) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" title={usageTitle(t('reports:usage.columns.session'), u.session)}>
                    {u.session.calls ? compact(u.session.total) : '—'}
                  </td>
                  <UsageCells t={u.allTime} />
                  <td className={cn('px-3 py-1.5 text-[11px]', u.reporting === 'full' ? 'text-zinc-400' : 'text-amber-300/80')} title={USAGE_REPORTING_LABEL[u.reporting]}>
                    {u.reporting === 'full'
                      ? t('reports:usage.reporting.full')
                      : u.reporting === 'simulated'
                        ? t('reports:usage.reporting.simulated')
                        : u.reporting === 'partial'
                          ? t('reports:usage.reporting.partial')
                          : t('reports:usage.reporting.none')}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  {t('reports:usage.noRecords')}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && data && (
            <tfoot className="border-t border-line text-zinc-200">
              <tr>
                <td className="px-3 py-2 font-medium">{t('reports:usage.columns.total')}</td>
                <td />
                <td className="px-2 py-2 text-right font-mono">{compact(data.session.total)}</td>
                <UsageCells t={data.allTime} />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center gap-3 text-[11px] text-zinc-400">
          <span className="panel-title">{t('reports:usage.last14')}</span>
          <Legend cls="bg-indigo-400" label={t('reports:usage.input')} />
          <Legend cls="bg-emerald-400" label={t('reports:usage.output')} />
          <Legend cls="bg-zinc-500" label={t('reports:usage.cache')} />
        </div>
        {days.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-zinc-500">{t('reports:usage.noRecordsRange')}</div>
        ) : (
          <div className="flex h-36 items-end gap-1.5">
            {days.map((d) => {
              const total = d.input + d.output + d.cache
              return (
                <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={t('reports:usage.dayTitle', { day: d.day, input: d.input.toLocaleString(locale()), output: d.output.toLocaleString(locale()), cache: d.cache.toLocaleString(locale()) })}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(total / maxDay) * 100}%` }}>
                    <div className="bg-indigo-400" style={{ flexGrow: d.input }} />
                    <div className="bg-emerald-400" style={{ flexGrow: d.output }} />
                    <div className="bg-zinc-500" style={{ flexGrow: d.cache }} />
                  </div>
                  <span className="text-[9.5px] text-zinc-500">{d.day.slice(8)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        {t('reports:usage.note')}
      </p>
    </div>
  )
}

function Card({ label, value, text, sub, t }: { label: string; value?: number; text?: string; sub: string; t?: UsageTotals | null }) {
  return (
    <div className="card px-3.5 py-3" title={t ? usageTitle(label, t) : undefined}>
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-[18px] tabular-nums text-zinc-100">{text ?? compact(value ?? 0)}</div>
      <div className="truncate text-[10.5px] text-zinc-500">{sub}</div>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-2 w-2 rounded-sm', cls)} /> {label}
    </span>
  )
}
