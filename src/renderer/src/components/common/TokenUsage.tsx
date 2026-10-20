import type { UsageReporting, UsageTotals } from '@shared/types'
import { USAGE_REPORTING_LABEL } from '@shared/steering'
import { useTranslation } from 'react-i18next'
import { locale, t as tr } from '@/i18n'
import { cn, compact } from '@/lib/format'

const n = (v: number): string => v.toLocaleString(locale())

/** Multi-line breakdown used as a tooltip. */
export function usageTitle(label: string, t: UsageTotals | null | undefined, reporting?: UsageReporting): string {
  if (!t || !t.calls) return `${tr('layout:usage.noRecords', { label })}${reporting ? `\n${USAGE_REPORTING_LABEL[reporting]}` : ''}`
  return [
    t.estimated ? tr('layout:usage.estimatedLabel', { label }) : label,
    tr('layout:usage.input', { value: n(t.input) }),
    tr('layout:usage.output', { value: n(t.output) }),
    tr('layout:usage.cacheRead', { value: n(t.cacheRead) }),
    tr('layout:usage.cacheWrite', { value: n(t.cacheWrite) }),
    tr('layout:usage.total', { value: n(t.total) }),
    t.costUsd ? tr('layout:usage.cost', { value: t.costUsd.toFixed(4) }) : '',
    tr('layout:usage.records', { count: t.calls }),
    reporting ? USAGE_REPORTING_LABEL[reporting] : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** "Task 1.2k · Session 8k · Total 120k" chips with full breakdown on hover. */
export function TokenStrip({
  task,
  session,
  allTime,
  reporting,
  className
}: {
  task?: UsageTotals | null
  session?: UsageTotals | null
  allTime?: UsageTotals | null
  reporting?: UsageReporting
  className?: string
}) {
  const { t: tt } = useTranslation()
  const est = reporting === 'simulated'
  const none = reporting === 'none'
  const chip = (label: string, t: UsageTotals | null | undefined): React.ReactNode =>
    t !== undefined && (
      <span className="whitespace-nowrap" title={usageTitle(label, t, reporting)}>
        <span className="text-zinc-500">{label}</span> <span className="font-mono text-zinc-300">{t && t.calls ? compact(t.total) : '—'}</span>
      </span>
    )
  return (
    <span className={cn('flex items-center gap-2.5 text-[11px]', className)}>
      {chip(tt('layout:usage.task'), task)}
      {chip(tt('layout:usage.session'), session)}
      {chip(tt('layout:usage.allTime'), allTime)}
      {est && <span className="rounded bg-white/5 px-1 text-[12px] text-zinc-500" title={USAGE_REPORTING_LABEL.simulated}>{tt('layout:usage.estimated')}</span>}
      {none && <span className="rounded bg-white/5 px-1 text-[12px] text-zinc-500" title={USAGE_REPORTING_LABEL.none}>{tt('layout:usage.notReported')}</span>}
    </span>
  )
}

/** Input / output / cache / total cells for tables. */
export function UsageCells({ t }: { t: UsageTotals | null | undefined }) {
  const v = (x: number): string => (t && t.calls ? compact(x) : '—')
  return (
    <>
      <td className="px-2 py-1.5 text-right font-mono">{v(t?.input ?? 0)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{v(t?.output ?? 0)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{v((t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0))}</td>
      <td className="px-2 py-1.5 text-right font-mono text-zinc-100">{v(t?.total ?? 0)}</td>
    </>
  )
}
