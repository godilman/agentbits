import { useEffect, useState } from 'react'
import { FileDiff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Task } from '@shared/types'
import { call } from '@/lib/api'
import { cn } from '@/lib/format'

export type Changes = Awaited<ReturnType<typeof window.agentbits.invoke<'tasks:changes'>>>

/** "What changed?" — files the task changed with +/- lines and the diff (worktree projects, from git). `onLoad` gets
 *  each reading (null: none / unreadable). */
export function TaskChanges({ task, onLoad }: { task: Task; onLoad?: (d: Changes) => void }) {
  const { t } = useTranslation(['tasks'])
  const [data, setData] = useState<Changes>(null)
  const [showDiff, setShowDiff] = useState(false)
  useEffect(() => {
    let alive = true
    void call('tasks:changes', task.id).then(
      (d) => {
        if (!alive) return
        setData(d)
        onLoad?.(d)
      },
      () => alive && onLoad?.(null)
    )
    return () => {
      alive = false
    }
  }, [task.id, task.status, task.updatedAt])
  if (!data || !data.files.length) return null
  const added = data.files.reduce((n, f) => n + f.added, 0)
  const removed = data.files.reduce((n, f) => n + f.removed, 0)
  const lines = showDiff ? data.diff.split('\n').slice(0, 4000) : []
  return (
    <div className="rounded-md border border-line bg-surface-2/50 px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <FileDiff size={13} className="text-sky-300" />
        <span className="font-medium text-zinc-200">{t('tasks:changes.title')}</span>
        <span className="text-zinc-400">{t('tasks:changes.summary', { count: data.files.length })}</span>
        <span className="font-mono text-[11px] text-emerald-400">+{added}</span>
        <span className="font-mono text-[11px] text-rose-400">−{removed}</span>
        <button className="btn-ghost ml-auto h-6 text-[12px]" onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? t('tasks:changes.hideDiff') : t('tasks:changes.showDiff')}
        </button>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {data.files.map((f) => (
          <li key={f.path} className="flex gap-2 font-mono text-[12px]">
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={f.path}>
              {f.path}
            </span>
            <span className="text-emerald-400">+{f.added}</span>
            <span className="text-rose-400">−{f.removed}</span>
          </li>
        ))}
      </ul>
      {showDiff && (
        <pre className="selectable mt-2 max-h-96 overflow-auto rounded border border-line-soft bg-black/30 p-2 text-[12px] leading-snug">
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-300' : l.startsWith('-') && !l.startsWith('---') ? 'text-rose-300' : l.startsWith('@@') ? 'text-sky-300' : 'text-zinc-400'
              )}
            >
              {l || ' '}
            </div>
          ))}
          {(data.truncated || data.diff.split('\n').length > 4000) && <div className="text-amber-300">{t('tasks:changes.truncated')}</div>}
        </pre>
      )}
    </div>
  )
}
