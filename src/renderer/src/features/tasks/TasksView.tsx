import { useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MessageSquareWarning, Plus, Search, SquareKanban } from 'lucide-react'
import type { Task, TaskStatus } from '@shared/types'
import { locale } from '@/i18n'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Empty, ProgressBar } from '@/components/common/ui'
import { call } from '@/lib/api'
import { cn, PRIORITY_META, TASK_COLUMNS, timeAgo } from '@/lib/format'
import { useProjectScope } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'
import { TaskDrawer } from './TaskDrawer'

export function TasksView() {
  const { t } = useTranslation(['common', 'tasks'])
  const allTasks = useAppStore((s) => s.tasks)
  const { pid, project, team } = useProjectScope()
  const tasks = useMemo(() => allTasks.filter((x) => x.projectId === pid), [allTasks, pid])
  /** Filter chips: project team plus anyone already assigned to a task here. */
  const allAgents = useAppStore((s) => s.agents)
  const agents = useMemo(() => {
    const ids = new Set(team.map((a) => a.id))
    for (const x of tasks) if (x.assigneeId) ids.add(x.assigneeId)
    return allAgents.filter((a) => ids.has(a.id))
  }, [allAgents, team, tasks])
  const setNewTaskOpen = useAppStore((s) => s.setNewTaskOpen)
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
    // optimistic
    useAppStore.setState((st) => ({ tasks: st.tasks.map((x) => (x.id === id ? { ...x, status, sortOrder } : x)) }))
    void call('tasks:move', id, status, sortOrder)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div>
          <h1 className="text-[15px] font-semibold text-zinc-100">{project ? t('tasks:board.titleWithProject', { project: project.name }) : t('tasks:board.title')}</h1>
          <div className="text-[11.5px] text-zinc-400">
            {t('tasks:board.subtitle', { count: tasks.length })}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input className="input h-7 w-52 pl-7 text-[12px]" placeholder={t('tasks:board.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
            <button className={cn('h-6 rounded px-2 text-[11px]', !assignee ? 'bg-white/10 text-zinc-100' : 'text-zinc-400')} onClick={() => setAssignee(null)}>
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

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-x-auto p-4">
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
                <span className="text-[12.5px] font-medium text-zinc-200">{col.label}</span>
                <span className="font-mono text-[11px] text-zinc-400">{items.length}</span>
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
                {items.length === 0 && (
                  <div className="rounded-md border border-dashed border-line-soft py-6 text-center text-[11.5px] text-zinc-400">{t('tasks:board.emptyColumn')}</div>
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
      <TaskDrawer />
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
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10.5px] text-zinc-400">{task.key}</span>
        <span className={cn('h-1.5 w-1.5 rounded-full', pr.dot)} title={t('tasks:card.priority', { label: pr.label })} />
        {task.reviewNote && task.status === 'todo' && (
          <MessageSquareWarning size={12} className="text-amber-400/80" aria-label={t('tasks:card.revisionNote')} />
        )}
        {run && (
          <span className={cn('ml-auto flex items-center gap-1 text-[10.5px]', run.status === 'awaiting_approval' ? 'text-amber-300' : 'text-emerald-400')}>
            {run.status === 'awaiting_approval' ? t('tasks:card.awaitingApproval') : run.status === 'paused' ? t('tasks:card.paused') : <Loader2 size={11} className="animate-spin" />}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-zinc-200">{task.title}</div>
      {(task.status === 'in_progress' || (task.progress > 0 && task.status !== 'done')) && (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} tone={task.status === 'in_review' ? 'violet' : 'emerald'} />
          <span className="font-mono text-[10px] text-zinc-400">{task.progress}%</span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <PixelAvatar agent={agent} size={18} />
        <span className="truncate text-[11px] text-zinc-400">{agent?.name ?? t('tasks:card.unassigned')}</span>
        <span className="ml-auto text-[10.5px] text-zinc-400">{timeAgo(task.updatedAt)}</span>
      </div>
    </div>
  )
}
