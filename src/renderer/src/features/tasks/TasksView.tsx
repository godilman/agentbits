import { useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { GitMerge, Hourglass, Loader2, MessageSquareWarning, PauseCircle, Plus, Search, SquareKanban, UserCheck } from 'lucide-react'
import type { Task, TaskStatus } from '@shared/types'
import { locale } from '@/i18n'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Empty, ProgressBar } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, PRIORITY_META, TASK_COLUMNS, timeAgo } from '@/lib/format'
import { useProjectScope } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'
import { TaskDrawer } from './TaskDrawer'
import { useStartGuard } from './StartGuard'
import { useDoneGuard } from './DoneGuard'

export function TasksView() {
  const { t } = useTranslation(['common', 'tasks'])
  const allTasks = useAppStore((s) => s.tasks)
  const { pid, project, team } = useProjectScope()
  const [guardStart, startModal] = useStartGuard()
  const [guardDone, doneModal] = useDoneGuard()
  const tasks = useMemo(() => allTasks.filter((x) => x.projectId === pid), [allTasks, pid])
  // Only the newest done tasks are loaded (store DONE_WINDOW); the rest load on request.
  const doneTotal = useAppStore((s) => (pid ? s.doneTotals[pid] ?? 0 : 0))
  const loadAllDone = useAppStore((s) => s.loadAllDone)
  const [loadingDone, setLoadingDone] = useState(false)
  const hiddenDone = Math.max(0, doneTotal - tasks.filter((x) => x.status === 'done').length)
  /** Filter chips: project team plus anyone already assigned to a task here. */
  const allAgents = useAppStore((s) => s.agents)
  const agents = useMemo(() => {
    const ids = new Set(team.map((a) => a.id))
    for (const x of tasks) if (x.assigneeId) ids.add(x.assigneeId)
    return allAgents.filter((a) => ids.has(a.id))
  }, [allAgents, team, tasks])
  const setNewTaskOpen = useAppStore((s) => s.setNewTaskOpen)
  const selectedTaskId = useAppStore((s) => s.selectedTaskId)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<TaskStatus | null>(null)

  const filtered = useMemo(() => {
    const lc = locale()
    const q = query.trim().toLocaleLowerCase(lc)
    return tasks.filter(
      (x) =>
        (!assignee || x.assigneeId === assignee) &&
        (!q || x.title.toLocaleLowerCase(lc).includes(q) || x.key.toLowerCase().includes(q))
    )
  }, [tasks, query, assignee])

  const byColumn = (status: TaskStatus): Task[] =>
    filtered
      .filter((x) => x.status === status)
      .sort((a, b) => (status === 'done' ? (b.completedAt ?? '').localeCompare(a.completedAt ?? '') : a.sortOrder - b.sortOrder))

  const onDrop = (e: DragEvent, status: TaskStatus): void => {
    e.preventDefault()
    setOverCol(null)
    const id = e.dataTransfer.getData('text/task') || dragId
    setDragId(null)
    if (!id) return
    const col = byColumn(status).filter((x) => x.id !== id)
    const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card]')].filter((el) => el.dataset.card !== id)
    let idx = cards.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    if (idx < 0) idx = col.length
    const before = col[idx - 1]?.sortOrder
    const after = col[idx]?.sortOrder
    const sortOrder = before === undefined && after === undefined ? 1 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2
    const task = tasks.find((x) => x.id === id)
    if (!task) return
    const move = (force?: boolean): void => {
      // optimistic
      useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { ...x, status, sortOrder } : x)) }))
      // Refused (e.g. the run could not be confirmed stopped): the board reloads; say why.
      void call('tasks:move', id, status, sortOrder, force).catch((e) => useAppStore.getState().toast('error', apiError(e)))
    }
    if (status === 'in_progress' && task.status !== 'in_progress') guardStart(task.id, task.key, move)
    else if (status === 'done' && task.status !== 'done') guardDone(task, () => move())
    else move()
  }

  return (
    <div className="flex h-full flex-col">
      {startModal}
      {doneModal}
      {/* Narrow space: the tools wrap below the title instead of squeezing it word by word. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3">
        <div className="min-w-[200px] flex-1">
          <h1 className="truncate text-[15px] font-semibold text-zinc-100" title={project?.name}>
            {project ? t('tasks:board.titleWithProject', { project: project.name }) : t('tasks:board.title')}
          </h1>
          <div className="truncate text-[11px] text-zinc-400">
            {t('tasks:board.subtitle', { count: tasks.length + hiddenDone })}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input className="input h-7 w-52 pl-7 text-[13px]" placeholder={t('tasks:board.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
            <button className={cn('h-6 rounded px-2 text-[12px]', !assignee ? 'bg-white/10 text-zinc-100' : 'text-zinc-400')} onClick={() => setAssignee(null)}>
              {t('tasks:board.all')}
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setAssignee(assignee === a.id ? null : a.id)}
                className={cn('rounded p-0.5 transition-opacity', assignee && assignee !== a.id ? 'opacity-35 hover:opacity-70' : 'opacity-100', assignee === a.id && 'bg-white/10')}
                title={a.name}
              >
                <PixelAvatar agent={a} size={20} />
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setNewTaskOpen(true)}>
            <Plus size={14} /> {t('tasks:board.newTask')}
          </button>
        </div>
      </div>

      {/* Columns never go below 230 px (no overlap): a narrow space scrolls sideways. */}
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(230px,1fr))] gap-3 overflow-x-auto p-4">
        {TASK_COLUMNS.map((col) => {
          const items = byColumn(col.id)
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                setOverCol(col.id)
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(null)
              }}
              onDrop={(e) => onDrop(e, col.id)}
              className={cn(
                'flex min-h-0 min-w-[230px] flex-col rounded-lg border bg-surface/60 transition-colors',
                overCol === col.id ? 'border-indigo-500/40 bg-indigo-500/[0.04]' : 'border-line-soft'
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className={cn('h-2 w-2 rounded-sm', col.accent)} />
                <span className="text-[13px] font-medium text-zinc-200">{col.label}</span>
                <span className="font-mono text-[11px] text-zinc-400">{col.id === 'done' && !query && !assignee ? items.length + hiddenDone : items.length}</span>
                {col.id === 'todo' && (
                  <button className="icon-btn ml-auto" onClick={() => setNewTaskOpen(true)} title={t('tasks:board.addTask')}>
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {items.map((x) => (
                  <TaskCard key={x.id} task={x} dragging={dragId === x.id} onDragStart={(e) => {
                    e.dataTransfer.setData('text/task', x.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragId(x.id)
                  }} onDragEnd={() => setDragId(null)} />
                ))}
                {items.length === 0 && hiddenDone === 0 && (
                  <div className="rounded-md border border-dashed border-line-soft py-6 text-center text-[12px] text-zinc-400">{t('tasks:board.emptyColumn')}</div>
                )}
                {col.id === 'done' && hiddenDone > 0 && pid && (
                  <button
                    className="btn-outline h-7 w-full justify-center text-[12px]"
                    disabled={loadingDone}
                    onClick={() => {
                      setLoadingDone(true)
                      void loadAllDone(pid).finally(() => setLoadingDone(false))
                    }}
                  >
                    {loadingDone ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t('tasks:board.loadOlder', { count: hiddenDone })}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {tasks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 top-32">
          <Empty icon={<SquareKanban size={18} />} title={t('tasks:board.emptyTitle')} hint={t('tasks:board.emptyHint')} />
        </div>
      )}
      {/* A new task (a notification click, another card) starts with fresh details: no merge review left for the last one. */}
      <TaskDrawer key={selectedTaskId ?? ''} />
    </div>
  )
}

function TaskCard({ task, dragging, onDragStart, onDragEnd }: { task: Task; dragging: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  const { t } = useTranslation(['common', 'tasks'])
  const agents = useAppStore((s) => s.agents)
  const selectTask = useAppStore((s) => s.selectTask)
  const selected = useAppStore((s) => s.selectedTaskId === task.id)
  const run = useAppStore((s) => s.activeRuns.find((r) => r.taskId === task.id))
  const agent = agentById(agents, task.assigneeId)
  const pr = PRIORITY_META[task.priority]
  // Unfinished dependencies (a string, so the selector returns a primitive); an unloaded dependency is an old done task.
  // The original of a race has no raceOf; it is raced when a challenger points at it.
  const isRaced = useAppStore((s) => s.tasks.some((x) => x.raceOf === task.id))
  const waitsFor = useAppStore((s) =>
    task.status === 'todo'
      ? task.dependsOn
          .map((id) => s.tasks.find((x) => x.id === id))
          .filter((d) => d && d.status !== 'done')
          .map((d) => d!.key)
          .join(', ')
      : ''
  )
  // Concrete reasons a task doesn't move (strings, so the selectors return primitives).
  const waitsMerge = useAppStore((s) =>
    task.status === 'todo'
      ? task.dependsOn
          .map((id) => {
            // A race's losing attempt stands for its winner: the dependent waits for the winner's merge.
            const d = s.tasks.find((x) => x.id === id)
            if (d?.raceResult !== 'lost') return id
            const p = d.raceOf ? s.tasks.find((x) => x.id === d.raceOf) : s.tasks.find((x) => x.raceOf === d.id)
            return p?.raceResult === 'won' ? p.id : id
          })
          .filter((id) => s.orchestratorWaits.unmerged.includes(id))
          .map((id) => s.tasks.find((x) => x.id === id)?.key ?? '')
          .filter(Boolean)
          .join(', ')
      : ''
  )
  const heldWhy = useAppStore((s) => (task.status === 'todo' ? (s.orchestratorWaits.held[task.id] ?? null) : null))
  const undecided = useAppStore((s) => task.status === 'in_review' && s.orchestratorWaits.undecided.includes(task.id))
  const undecidedWhy = useAppStore((s) => (task.status === 'in_review' ? (s.orchestratorWaits.undecidedWhy[task.id] ?? '') : ''))
  const mergeWaits = useAppStore((s) => task.status === 'done' && s.orchestratorWaits.unmerged.includes(task.id))
  const ownUnmerged = useAppStore((s) => task.status === 'done' && s.orchestratorWaits.unmerged.includes(task.id))
  // The Demo provider did its latest run (nothing real was done) and / or its review (nothing was really checked).
  const shown = task.status === 'in_review' || task.status === 'done'
  const simWork = useAppStore((s) => shown && s.orchestratorWaits.simulatedWork.includes(task.id))
  const simReview = useAppStore((s) => shown && s.orchestratorWaits.simulatedReview.includes(task.id))
  const racePartner = useAppStore((s) => {
    if (task.status !== 'in_review' || task.raceResult) return ''
    const p = task.raceOf ? s.tasks.find((x) => x.id === task.raceOf) : s.tasks.find((x) => x.raceOf === task.id)
    return p && (p.status === 'todo' || p.status === 'in_progress') ? p.key : ''
  })

  return (
    <div
      data-card={task.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => selectTask(task.id)}
      className={cn(
        'group cursor-pointer rounded-md border bg-surface-2 p-2.5 shadow-sm transition-all hover:border-zinc-600',
        selected ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : 'border-line',
        dragging && 'opacity-40'
      )}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-[11px] text-zinc-400">{task.key}</span>
        <span className={cn('h-1.5 w-1.5 rounded-full', pr.dot)} title={t('tasks:card.priority', { label: pr.label })} />
        {(task.raceOf || task.raceResult || isRaced) && (
          <span
            className={cn(
              'rounded px-1 text-[12px]',
              task.raceResult === 'won' ? 'bg-emerald-500/15 text-emerald-300' : task.raceResult === 'lost' ? 'bg-zinc-500/15 text-zinc-400' : 'bg-orange-500/15 text-orange-300'
            )}
            title={t('tasks:card.raceHint')}
          >
            🏁 {task.raceResult === 'won' ? t('tasks:card.raceWon') : task.raceResult === 'lost' ? t('tasks:card.raceLost') : t('tasks:card.race')}
          </span>
        )}
        {task.reviewNote && task.status === 'todo' && (
          <MessageSquareWarning size={12} className="text-amber-400/80" aria-label={t('tasks:card.revisionNote')} />
        )}
        {run && (
          <span className={cn('ml-auto flex items-center gap-1 text-[12px]', run.status === 'awaiting_approval' ? 'text-amber-300' : 'text-emerald-400')}>
            {run.status === 'awaiting_approval' ? t('tasks:card.awaitingApproval') : run.status === 'paused' ? t('tasks:card.paused') : <Loader2 size={11} className="animate-spin" />}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-zinc-200">{task.title}</div>
      {waitsFor && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[12px] text-sky-300" title={t('tasks:card.waitsForHint')}>
          <Hourglass size={10} /> {t('tasks:card.waitsFor', { keys: waitsFor })}
        </div>
      )}
      {waitsMerge && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[12px] text-sky-300" title={t('tasks:card.waitsMergeHint')}>
          <GitMerge size={10} /> {t('tasks:card.waitsMerge', { keys: waitsMerge })}
        </div>
      )}
      {heldWhy !== null && (
        <div className="mt-1.5 flex items-start gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[12px] leading-snug text-amber-300" title={t('tasks:card.heldHint')}>
          <PauseCircle size={10} className="mt-[2px] shrink-0" /> <span className="line-clamp-2">{heldWhy ? t('tasks:card.held', { reason: heldWhy }) : t('tasks:card.heldNoReason')}</span>
        </div>
      )}
      {undecided && (
        <div className="mt-1.5 flex items-start gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 text-[12px] leading-snug text-violet-300">
          <UserCheck size={10} className="mt-[2px] shrink-0" />{' '}
          <span className="line-clamp-2">{undecidedWhy ? t('tasks:card.undecidedWhy', { reason: undecidedWhy }) : t('tasks:card.undecided')}</span>
        </div>
      )}
      {task.status === 'done' && ((task.completedBy && !(task.completedBy === 'lead' && simReview)) || mergeWaits) && (
        <div
          className={cn(
            'mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px]',
            mergeWaits ? 'bg-amber-500/10 text-amber-300' : task.completedBy === 'user' ? 'bg-sky-500/10 text-sky-300' : 'bg-emerald-500/10 text-emerald-300'
          )}
        >
          {/* A lead approval from a simulated review is not shown as one: the review chip below says what it was. */}
          {[task.completedBy && !(task.completedBy === 'lead' && simReview) ? t(`tasks:card.completedBy.${task.completedBy}`) : '', mergeWaits ? t('tasks:card.mergeWaits') : ''].filter(Boolean).join(' · ')}
        </div>
      )}
      {simWork && (
        <div className="mt-1.5 flex items-center gap-1 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[12px] text-zinc-300" data-testid="card-simulated">
          {t('tasks:card.simulated')}
        </div>
      )}
      {simReview && (
        <div className="mt-1.5 flex items-center gap-1 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[12px] text-zinc-300" data-testid="card-review-simulated">
          {t('tasks:card.reviewSimulated')}
        </div>
      )}
      {racePartner && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-orange-500/10 px-1.5 py-0.5 text-[12px] text-orange-300">
          <Hourglass size={10} /> {t('tasks:card.racePartner', { key: racePartner })}
        </div>
      )}
      {ownUnmerged && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[12px] text-sky-300" title={t('tasks:card.waitsMergeHint')}>
          <GitMerge size={10} /> {t('tasks:card.notMerged')}
        </div>
      )}
      {/* Waiting for approval is not work: no progress bar until the run really starts. */}
      {(task.status === 'in_progress' || (task.progress > 0 && task.status !== 'done')) && run?.status !== 'awaiting_approval' && (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} tone={task.status === 'in_review' ? 'violet' : 'emerald'} />
          <span className="font-mono text-[11px] text-zinc-400">{task.progress}%</span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <PixelAvatar agent={agent} size={18} />
        <span className="truncate text-[12px] text-zinc-400">{agent?.name ?? t('tasks:card.unassigned')}</span>
        <span className="ml-auto text-[11px] text-zinc-400">{timeAgo(task.updatedAt)}</span>
      </div>
    </div>
  )
}
