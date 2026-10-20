import { useMemo, useState } from 'react'
import { Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

/**
 * Opening a project starts nothing: while work hasn't been started for this project in this session and tasks (with
 * autopilot on) or reviews left from the last session wait, say so and offer to start (held tasks aren't counted).
 */
export function StartWorkBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const tasks = useAppStore((s) => s.tasks)
  const waits = useAppStore((s) => s.orchestratorWaits)
  const autopilot = useAppStore((s) => s.settings.autopilot)
  const paused = useAppStore((s) => s.orchestratorPaused)
  const toast = useAppStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const waiting = useMemo(
    () => tasks.filter((x) => x.projectId === projectId && x.status === 'todo' && waits.held[x.id] === undefined).length,
    [tasks, waits, projectId]
  )
  const reviews = useMemo(() => tasks.filter((x) => x.projectId === projectId && waits.deferredReviews.includes(x.id)).length, [tasks, waits, projectId])
  const todo = autopilot ? waiting : 0
  if (paused || (!todo && !reviews) || waits.startedProjects.includes(projectId)) return null
  return (
    <div data-testid="start-work" className="flex items-center gap-3 border-b border-line bg-indigo-500/[0.07] px-4 py-2 text-[13px] text-zinc-200">
      <div className="min-w-0 flex-1">
        <span className="font-medium">
          {[todo ? t('project:startWork.waiting', { count: todo }) : '', reviews ? t('project:startWork.reviews', { count: reviews }) : ''].filter(Boolean).join(' ')}
        </span>{' '}
        <span className="text-zinc-400">{t('project:startWork.hint')}</span>
      </div>
      <button
        className="btn-primary h-7 shrink-0 text-[12px]"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void call('projects:startWork', projectId)
            .catch((e) => toast('error', apiError(e)))
            .finally(() => setBusy(false))
        }}
      >
        <Play size={12} /> {t('project:startWork.start')}
      </button>
    </div>
  )
}
