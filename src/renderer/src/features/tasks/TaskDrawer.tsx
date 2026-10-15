import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitMerge, Play, Send, Square, Trash2, X } from 'lucide-react'
import type { ApiArgs } from '@shared/ipc'
import type { AgentLog, Run, TaskStatus } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { ProgressBar, Segmented } from '@/components/common/ui'
import { call } from '@/lib/api'
import { ago, clock, cn, duration, PRIORITY_META, TASK_COLUMNS } from '@/lib/format'
import { Markdown } from '@/lib/markdown'
import { useProjectScope } from '@/lib/org'
import { agentById, channelKey, useAppStore } from '@/store/useAppStore'
import { useFileDrop } from '@/features/files/hooks'
import { DropOverlay } from '@/features/files/parts'
import { TaskChanges } from './TaskChanges'
import { TaskFiles } from '@/features/files/TaskFiles'

type Pane = 'thread' | 'logs' | 'runs'

export function TaskDrawer() {
  const { t } = useTranslation(['common', 'tasks'])
  const id = useAppStore((s) => s.selectedTaskId)
  // Only tasks of the active project open here (the selection is cleared on project switch anyway).
  const task = useAppStore((s) => s.tasks.find((x) => x.id === s.selectedTaskId && x.projectId === s.activeProjectId))
  const agents = useAppStore((s) => s.agents)
  const { members, lead, project } = useProjectScope()
  const selectTask = useAppStore((s) => s.selectTask)
  const channels = useAppStore((s) => s.channels)
  const loadChannel = useAppStore((s) => s.loadChannel)
  const liveLogs = useAppStore((s) => s.logs)
  const activeRun = useAppStore((s) => s.activeRuns.find((r) => r.taskId === s.selectedTaskId))
  const [pane, setPane] = useState<Pane>('thread')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [acc, setAcc] = useState('')
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<AgentLog[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  // Worktree mode: a done task whose branch still waits to be merged (e.g. uncommitted changes in the folder).
  const [mergePending, setMergePending] = useState(false)
  const [merging, setMerging] = useState(false)
  const worktree = project?.isolation === 'worktree'
  useEffect(() => {
    if (!id || !worktree || task?.status !== 'done') return setMergePending(false)
    let alive = true
    void call('tasks:mergePending', id).then((v) => alive && setMergePending(v), () => undefined)
    return () => {
      alive = false
    }
  }, [id, worktree, task?.status, task?.updatedAt])
  const [dropped, setDropped] = useState<File[] | null>(null)
  const drop = useFileDrop((files) => setDropped(files), !!task)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDesc(task.description)
    setAcc(task.acceptance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  useEffect(() => {
    if (!id) return
    void loadChannel(`task:${id}`)
    void call('logs:list', { taskId: id, limit: 400 }).then(setHistory)
    void call('runs:list', { taskId: id, limit: 20 }).then(setRuns)
  }, [id, loadChannel, activeRun?.status])

  const thread = id ? channels[channelKey(task?.projectId, `task:${id}`)] ?? [] : []
  const logIds = new Set(history.map((l) => l.id))
  const logs = [...history, ...liveLogs.filter((l) => l.taskId === id && !logIds.has(l.id))]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [thread.length, logs.length, pane])

  if (!task) return null
  const agent = agentById(agents, task.assigneeId)
  const save = (patch: ApiArgs<'tasks:update'>[1]): void => void call('tasks:update', task.id, patch)
  const send = async (): Promise<void> => {
    if (!draft.trim()) return
    await call('messages:send', `task:${task.id}`, draft.trim(), task.projectId)
    setDraft('')
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[460px] flex-col border-l border-line bg-[#0e0e11] shadow-pop animate-slide-in" {...drop.props}>
      <DropOverlay show={drop.over} label={t('tasks:drawer.dropLabel', { key: task.key })} />
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[12px] text-zinc-400">{task.key}</span>
        <span className="text-[11px] text-zinc-400">{t('tasks:drawer.createdAgo', { ago: ago(task.createdAt), by: task.createdBy })}</span>
        <div className="ml-auto flex items-center gap-1">
          {mergePending && (
            <button
              className="btn-outline h-6 text-[11.5px]"
              disabled={merging}
              title={t('tasks:drawer.mergeHint')}
              onClick={() => {
                setMerging(true)
                void call('tasks:merge', task.id)
                  .then(setMergePending, () => undefined)
                  .finally(() => setMerging(false))
              }}
            >
              <GitMerge size={11} /> {t('tasks:drawer.mergeNow')}
            </button>
          )}
          {task.status === 'in_progress' || activeRun ? (
            <button className="btn-danger h-6 text-[11.5px]" onClick={() => activeRun && void call('runs:stop', activeRun.id)}>
              <Square size={11} /> {t('actions.stop')}
            </button>
          ) : (
            task.status !== 'done' && (
              <button className="btn-outline h-6 text-[11.5px]" onClick={() => void call('tasks:start', task.id)}>
                <Play size={11} /> {t('tasks:drawer.startNow')}
              </button>
            )
          )}
          <button
            className="icon-btn hover:text-rose-400"
            title={t('actions.delete')}
            onClick={() => {
              void call('tasks:delete', task.id)
              selectTask(null)
            }}
          >
            <Trash2 size={13} />
          </button>
          <button className="icon-btn" onClick={() => selectTask(null)}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="space-y-3 border-b border-line p-4">
        <input
          className="w-full bg-transparent text-[16px] font-semibold text-zinc-100 outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
        />
        <div className="grid grid-cols-[84px_1fr] items-center gap-y-2 text-[12px]">
          <span className="text-zinc-400">{t('tasks:fields.status')}</span>
          <select
            className="input h-7 w-44 text-[12px]"
            value={task.status}
            onChange={(e) => void call('tasks:move', task.id, e.target.value as TaskStatus)}
          >
            {TASK_COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-400">{t('tasks:fields.priority')}</span>
          <select className="input h-7 w-44 text-[12px]" value={task.priority} onChange={(e) => save({ priority: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
            {PRIORITY_META.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-400">{t('tasks:fields.assignee')}</span>
          <div className="flex items-center gap-2">
            <PixelAvatar agent={agent} size={22} />
            <select className="input h-7 w-44 text-[12px]" value={task.assigneeId ?? ''} onChange={(e) => save({ assigneeId: e.target.value || null })}>
              <option value="">{t('tasks:fields.auto')}</option>
              {agents
                .filter((a) => (members.some((m) => m.id === a.id) && a.id !== lead?.id) || a.id === task.assigneeId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
            </select>
          </div>
          <span className="text-zinc-400">{t('tasks:fields.progress')}</span>
          <div className="flex items-center gap-2">
            <ProgressBar value={task.progress} className="w-44" tone={task.status === 'done' ? 'indigo' : 'emerald'} />
            <span className="font-mono text-[11px] text-zinc-400">{task.progress}%</span>
          </div>
        </div>
        <textarea
          className="textarea text-[12.5px]"
          rows={3}
          placeholder={t('tasks:drawer.descriptionPlaceholder')}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== task.description && save({ description: desc })}
        />
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('tasks:fields.acceptance')}</div>
          <textarea
            className="textarea text-[12.5px]"
            rows={Math.min(8, Math.max(2, acc.split('\n').length))}
            placeholder={t('tasks:new.acceptancePlaceholder')}
            value={acc}
            onChange={(e) => setAcc(e.target.value)}
            onBlur={() => acc !== task.acceptance && save({ acceptance: acc })}
          />
          {task.acceptanceCheck && task.acceptanceCheck.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[12px]">
              {task.acceptanceCheck.map((c, i) => (
                <li key={i} className={cn('flex gap-1.5', c.met ? 'text-emerald-300' : 'text-rose-300')}>
                  <span className="shrink-0">{c.met ? '✓' : '✗'}</span>
                  <span>
                    {c.text}
                    {c.note && <span className="text-zinc-400"> — {c.note}</span>}
                  </span>
                </li>
              ))}
              <li className="text-[11px] text-zinc-500">{t('tasks:drawer.acceptanceChecked')}</li>
            </ul>
          )}
        </div>
        {task.reviewNote && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
            <span className="font-medium text-amber-300">{t('tasks:drawer.reviewNote')}</span>
            {task.reviewNote}
          </div>
        )}
        <TaskFiles task={task} droppedFiles={dropped} />
        <TaskChanges task={task} />
      </div>

      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <Segmented<Pane>
          value={pane}
          onChange={setPane}
          options={[
            { value: 'thread', label: `${t('tasks:drawer.tabs.thread')} ${thread.length || ''}` },
            { value: 'logs', label: t('tasks:drawer.tabs.logs') },
            { value: 'runs', label: `${t('tasks:drawer.tabs.runs')} ${runs.length || ''}` }
          ]}
        />
      </div>

      <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {pane === 'thread' &&
          (thread.length === 0 ? (
            <div className="text-[12px] text-zinc-400">{t('tasks:drawer.noMessages')}</div>
          ) : (
            <div className="space-y-3">
              {thread.map((m) => {
                const a = agentById(agents, m.senderId)
                if (m.senderType === 'system')
                  return (
                    <div key={m.id} className="text-center text-[11px] text-zinc-400">
                      {m.content} · {clock(m.createdAt)}
                    </div>
                  )
                return (
                  <div key={m.id} className="flex gap-2.5">
                    {m.senderType === 'user' ? (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-700 text-[9px] font-bold">{t('tasks:drawer.youBadge')}</div>
                    ) : (
                      <PixelAvatar agent={a} size={24} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span className="text-[12.5px] font-medium text-zinc-200">{m.senderType === 'user' ? t('tasks:drawer.you') : a?.name}</span>
                        <span className="text-[10.5px] text-zinc-400">{clock(m.createdAt)}</span>
                      </div>
                      <Markdown text={m.content} />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        {pane === 'logs' && (
          <div className="font-mono text-[11px] leading-[1.65]">
            {logs.length === 0 && <div className="text-zinc-400">{t('tasks:drawer.noLogs')}</div>}
            {logs.map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="shrink-0 text-zinc-700">{clock(l.createdAt)}</span>
                <span
                  className={cn(
                    'min-w-0 whitespace-pre-wrap break-words',
                    l.level === 'error' ? 'text-rose-400' : l.level === 'tool' ? 'text-sky-300' : l.level === 'warn' ? 'text-amber-300' : l.level === 'debug' ? 'text-zinc-500' : 'text-zinc-400'
                  )}
                >
                  {l.level === 'tool' ? '▸ ' : ''}
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        )}
        {pane === 'runs' && (
          <div className="space-y-2">
            {runs.length === 0 && <div className="text-[12px] text-zinc-400">{t('tasks:drawer.noRuns')}</div>}
            {runs.map((r) => (
              <div key={r.id} className="rounded-md border border-line bg-surface p-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <PixelAvatar agent={agentById(agents, r.agentId)} size={18} />
                  <span className="text-zinc-300">{agentById(agents, r.agentId)?.name}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 text-[10.5px]',
                      r.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : r.status === 'failed' ? 'bg-rose-500/10 text-rose-300' : 'bg-white/5 text-zinc-400'
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-zinc-400">
                    {duration(r.startedAt, r.endedAt)} · {t('tasks:drawer.runTokens', { n: r.tokensIn + r.tokensOut })}
                  </span>
                </div>
                {r.error && <div className="mt-1.5 text-[11.5px] text-rose-300/80">{r.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {pane === 'thread' && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 pl-2.5 pr-1 focus-within:border-accent/50">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder={t('tasks:drawer.notePlaceholder')}
              className="h-8 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-zinc-400"
            />
            <button className="icon-btn text-indigo-300" onClick={() => void send()}>
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
