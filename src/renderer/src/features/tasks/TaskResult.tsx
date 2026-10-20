import { useEffect, useState } from 'react'
import { Check, CircleHelp, ClipboardCheck, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Task, TaskResult as Result } from '@shared/types'
import { call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/**
 * "Result" — first in a task in review or done: what really ran (tool record, not the report), what changed, who
 * judged it and what is left for the user. Says plainly what isn't known (a provider without a tool record, no test run).
 */
export function TaskResult({ task }: { task: Task }) {
  const { t } = useTranslation(['tasks'])
  const [r, setR] = useState<Result | null>(null)
  const undecided = useAppStore((s) => s.orchestratorWaits.undecided.includes(task.id))
  const mergeWaits = useAppStore((s) => s.orchestratorWaits.unmerged.includes(task.id))
  useEffect(() => {
    let alive = true
    void call('tasks:result', task.id).then((x) => alive && setR(x), () => alive && setR(null))
    return () => {
      alive = false
    }
  }, [task.id, task.status, task.updatedAt])
  if ((task.status !== 'in_review' && task.status !== 'done') || !r?.evidence) return null
  const e = r.evidence
  const row = (label: string, body: React.ReactNode, testId?: string) => (
    <div className="grid grid-cols-[112px_1fr] gap-2" data-testid={testId}>
      <span className="text-[12px] text-zinc-400">{label}</span>
      <div className="min-w-0 text-zinc-200">{body}</div>
    </div>
  )

  if (e.simulated) {
    return (
      <div className="rounded-md border border-line bg-zinc-500/10 px-3 py-2 text-[13px] text-zinc-300" data-testid="task-result">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-100">
          <ClipboardCheck size={13} /> {t('tasks:result.title')}
        </div>
        {t('tasks:result.simulated')}
      </div>
    )
  }

  const judged =
    task.status === 'done'
      ? task.completedBy === 'user'
        ? t('tasks:result.byUser')
        : r.review?.simulated
          ? t(r.review.race ? 'tasks:result.bySimulatedRace' : 'tasks:result.bySimulatedReview')
          : task.completedBy === 'lead'
            ? // What the lead had: a race compares two reports only; without a tool record only the report.
              t(r.review?.race ? 'tasks:result.byLeadRace' : e.toolRecord && !e.recordMissing ? 'tasks:result.byLead' : 'tasks:result.byLeadReportOnly', {
                name: r.review?.by ?? t('tasks:result.theLead')
              })
            : t('tasks:result.doneUnknown')
      : undecided
        ? t('tasks:result.undecided')
        : t('tasks:result.waitingReview')
  const n = e.commandCount
  const failed = n.failedNotFixed > 0
  // Counts are from the whole record; the lists are shortened (`+N` says how much is left out).
  const fc = e.fileCount
  const written = e.fileWrites.filter((w) => w.written)
  const writtenThenNot = written.filter((w) => w.last !== 'ok')
  const notWritten = (last: string): string[] => e.fileWrites.filter((w) => !w.written && w.last === last).map((w) => w.path)
  const list = (paths: string[]): string => paths.slice(0, 6).join(', ') + (paths.length > 6 ? ` +${paths.length - 6}` : '')
  const todo = [
    mergeWaits && t('tasks:result.todoMerge'),
    undecided && t('tasks:result.todoDecide'),
    failed && t('tasks:result.todoFailed'),
    e.denied.length > 0 && t('tasks:result.todoDenied'),
    task.status === 'done' && task.completedBy === 'user' && t('tasks:result.todoOwnLook'),
    r.review?.simulated && t('tasks:result.todoOwnLook')
  ].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)

  return (
    <div className="space-y-1.5 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-[13px]" data-testid="task-result">
      <div className="flex items-center gap-1.5 font-medium text-zinc-100">
        <ClipboardCheck size={13} className="text-sky-300" /> {t('tasks:result.title')}
      </div>
      {row(t('tasks:result.run'), t(`tasks:result.runStatus.${e.status === 'succeeded' ? 'succeeded' : 'other'}`, { status: e.status }))}
      {row(t('tasks:result.judged'), judged, 'result-judged')}
      {row(
        t('tasks:result.changed'),
        r.changes
          ? t(r.changes.merged ? 'tasks:result.changesMerged' : 'tasks:result.changesWaiting', { count: r.changes.files, added: r.changes.added, removed: r.changes.removed })
          : !e.toolRecord
            ? t('tasks:result.filesUnknown')
            : e.recordMissing
              ? t('tasks:result.recordMissing')
              : (
                <div className="space-y-0.5">
                  <div className={fc.written ? 'font-mono text-[12px]' : ''}>
                    {fc.written ? `${list(written.map((w) => w.path))}${fc.writtenNotListed ? ` +${fc.writtenNotListed}` : ''}` : t('tasks:result.noFiles')}
                  </div>
                  {writtenThenNot.length > 0 && <div className="text-[12px] text-amber-200">{t('tasks:result.writtenThenFailed', { files: list(writtenThenNot.map((w) => w.path)) })}</div>}
                  {notWritten('error').length > 0 && <div className="text-[12px] text-rose-200">{t('tasks:result.writesFailed', { files: list(notWritten('error')) })}</div>}
                  {notWritten('refused').length > 0 && <div className="text-[12px] text-amber-200">{t('tasks:result.writesRefused', { files: list(notWritten('refused')) })}</div>}
                  {notWritten('unknown').length > 0 && <div className="text-[12px] text-zinc-400">{t('tasks:result.writesUnknown', { files: list(notWritten('unknown')) })}</div>}
                  {fc.notListed > fc.writtenNotListed && <div className="text-[11px] text-zinc-400">{t('tasks:result.filesNotListed', { count: fc.notListed - fc.writtenNotListed })}</div>}
                  {n.total > 0 && <div className="text-[11px] text-zinc-400">{t('tasks:result.shellMayWrite')}</div>}
                </div>
              ),
        'result-changed'
      )}
      {row(
        t('tasks:result.read'),
        <div className="space-y-0.5">
          {e.reads.filesTotal > 0 ? (
            <div className="font-mono text-[12px]">
              {e.reads.files.slice(0, 6).join(', ')}
              {e.reads.filesTotal > 6 ? ` +${e.reads.filesTotal - 6}` : ''}
            </div>
          ) : (
            // Searches alone are reads too: then no "nothing recorded" line.
            !e.reads.searches && <div>{t(!e.toolRecord ? 'tasks:result.readUnknown' : e.recordMissing ? 'tasks:result.recordMissing' : 'tasks:result.readNone')}</div>
          )}
          {e.reads.unconfirmed > 0 && <div className="text-[12px] text-amber-200">{t('tasks:result.readUnconfirmed', { count: e.reads.unconfirmed })}</div>}
          {e.reads.searches > 0 && <div className="text-[12px] text-zinc-400">{t('tasks:result.readSearches', { count: e.reads.searches })}</div>}
          {e.reads.given.length > 0 && <div className="text-[12px] text-zinc-400">{t('tasks:result.readGiven', { files: list(e.reads.given) })}</div>}
          {e.reads.memory > 0 && <div className="text-[12px] text-zinc-400">{t('tasks:result.readMemory', { count: e.reads.memory })}</div>}
          {e.reads.filesTotal > 0 && !e.toolRecord && <div className="text-[11px] text-zinc-400">{t('tasks:result.readOwnUnknown')}</div>}
          {e.toolRecord && n.total > 0 && <div className="text-[11px] text-zinc-400">{t('tasks:result.shellMayRead')}</div>}
        </div>,
        'result-read'
      )}
      {row(
        t('tasks:result.commands'),
        !e.toolRecord ? (
          <span className="text-amber-200/90">{t('tasks:result.commandsUnknown')}</span>
        ) : e.recordMissing ? (
          <span className="text-amber-200/90">{t('tasks:result.recordMissing')}</span>
        ) : n.total === 0 ? (
          <span className="text-amber-200/90">{t('tasks:result.noCommands')}</span>
        ) : (
          <ul className="space-y-0.5">
            <li className="text-[12px] text-zinc-300">{t('tasks:result.commandSummary', { count: n.total, failed: n.failed, fixed: n.failed - n.failedNotFixed, unknown: n.unknown })}</li>
            {/* Every failure stays visible; then the latest others. */}
            {[...e.commands.filter((c) => c.result === 'error'), ...e.commands.filter((c) => c.result !== 'error').slice(-8)].map((c, i) => (
              <li key={i} className="flex items-center gap-1.5 font-mono text-[12px]">
                {c.result === 'ok' ? <Check size={11} className="shrink-0 text-emerald-400" /> : c.result === 'error' ? <X size={11} className="shrink-0 text-rose-400" /> : <CircleHelp size={11} className="shrink-0 text-zinc-400" />}
                <span className={cn('truncate', c.result === 'error' && !c.fixedLater && 'text-rose-200')} title={c.command}>
                  {c.command}
                </span>
                {c.fixedLater && <span className="shrink-0 text-[12px] text-emerald-300">{t('tasks:result.fixedLater')}</span>}
              </li>
            ))}
            {n.failedNotListed > 0 ? (
              <li className="text-[12px] text-rose-200">{t('tasks:result.failedNotListed', { count: n.failedNotListed })}</li>
            ) : e.commands.length - e.commands.filter((c) => c.result === 'error').length > 8 || n.notListed > 0 ? (
              <li className="text-[11px] text-zinc-400">{t('tasks:result.notListed')}</li>
            ) : null}
            <li className="text-[11px] text-zinc-400">{t('tasks:result.commandsNote')}</li>
          </ul>
        ),
        'result-commands'
      )}
      {e.denied.length > 0 &&
        row(
          t('tasks:result.denied'),
          <ul className="space-y-0.5 text-amber-200">
            {e.denied.slice(0, 5).map((d, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px]">
                <ShieldAlert size={11} className="mt-[2px] shrink-0" /> <span className="break-all">{d}</span>
              </li>
            ))}
          </ul>,
          'result-denied'
        )}
      {e.reportCut && row(t('tasks:result.limits'), t('tasks:result.reportCut'))}
      {todo.length > 0 && row(t('tasks:result.forYou'), <ul className="list-disc pl-4">{todo.map((x) => <li key={x}>{x}</li>)}</ul>, 'result-todo')}
    </div>
  )
}
