import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, GitMerge, Play, RefreshCw, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import type { ApiArgs } from '@shared/ipc'
import type { AgentLog, NeedsOutcome, Run, TaskStatus } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Modal, ProgressBar, Segmented } from '@/components/common/ui'
import { useResize } from '@/components/common/Resize'
import { apiError, call } from '@/lib/api'
import { ago, clock, cn, duration, PRIORITY_META, TASK_COLUMNS } from '@/lib/format'
import { Markdown } from '@/lib/markdown'
import { useProjectScope } from '@/lib/org'
import { agentById, channelKey, useAppStore } from '@/store/useAppStore'
import { useFileDrop } from '@/features/files/hooks'
import { DropOverlay } from '@/features/files/parts'
import { TaskChanges, type Changes } from './TaskChanges'
import { TaskResult } from './TaskResult'
import { RecalledTrace } from '@/features/memory/parts'
import { TaskFiles } from '@/features/files/TaskFiles'
import { useStartGuard } from './StartGuard'
import { useDoneGuard } from './DoneGuard'
import { useCancelTask } from './CancelGuard'
import { clearSent, draftSnapshot, setDraft as saveDraft, useDraft } from '@/lib/drafts'
import { JumpToNew, useStickToBottom } from '@/components/common/Stick'

type Pane = 'thread' | 'logs' | 'runs'

export function TaskDrawer() {
  const { t } = useTranslation(['common', 'tasks', 'org', 'chat'])
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
  // The team is recovering the review (ADR-036): the stored object, not a new one.
  const recovering = useAppStore((s) => s.orchestratorWaits.recovering[s.selectedTaskId ?? ''] ?? null)
  // Why the task waits for the user: held (in To do) or a review that couldn't decide (in review).
  const heldWhy = useAppStore((s) => (s.selectedTaskId && s.orchestratorWaits.held[s.selectedTaskId]) ?? null)
  const simWork = useAppStore((s) => !!s.selectedTaskId && s.orchestratorWaits.simulatedWork.includes(s.selectedTaskId))
  const simReview = useAppStore((s) => !!s.selectedTaskId && s.orchestratorWaits.simulatedReview.includes(s.selectedTaskId))
  const undecided = useAppStore((s) => !!s.selectedTaskId && s.orchestratorWaits.undecided.includes(s.selectedTaskId))
  const undecidedWhy = useAppStore((s) => (s.selectedTaskId ? (s.orchestratorWaits.undecidedWhy[s.selectedTaskId] ?? '') : ''))
  const toast = useAppStore((s) => s.toast)
  const [retrying, setRetrying] = useState(false)
  const [pane, setPane] = useState<Pane>('thread')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [acc, setAcc] = useState('')
  // The note being written is a draft of this task's thread (kept across restarts; cleared by a successful send).
  const draft = useDraft(task?.projectId ?? null, `task:${task?.id ?? ''}`).text
  const setNote = (text: string): void => {
    if (task) saveDraft(task.projectId, `task:${task.id}`, { text })
  }
  const [history, setHistory] = useState<AgentLog[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const detailsRef = useRef<HTMLDivElement>(null)
  const [guardStart, startModal] = useStartGuard()
  const [guardDone, doneModal] = useDoneGuard()
  const [cancelTask, cancelModal] = useCancelTask()
  const [width, widthHandle] = useResize('taskDrawer', 460, { min: 360, max: 1100, invert: true, className: 'absolute inset-y-0 left-0' })
  const [detailsMax, detailsHandle] = useResize('taskDrawerDetails', Math.round(window.innerHeight * 0.45), { min: 80, max: 2000, axis: 'y', measure: detailsRef })
  // Worktree mode: a done task whose branch still waits to be merged (e.g. uncommitted changes in the folder).
  // null = not known yet (the check is still running).
  const [mergePending, setMergePending] = useState<boolean | null>(null)
  const [merging, setMerging] = useState(false)
  // "Review changes and merge": the changes first; merging is a separate yes, bound to what was shown.
  const [mergeReview, setMergeReview] = useState(false)
  const [shown, setShown] = useState<Changes | undefined>(undefined)
  const worktree = project?.isolation === 'worktree'
  useEffect(() => {
    if (!id || !worktree || task?.status !== 'done') return setMergePending(false)
    let alive = true
    setMergePending(null)
    void call('tasks:mergePending', id).then(
      (v) => alive && setMergePending(v),
      () => alive && setMergePending(false)
    )
    return () => {
      alive = false
    }
  }, [id, worktree, task?.status, task?.updatedAt])
  // A chat card's "Review changes and merge": the same preview as the button above (merging stays a separate yes).
  const mergeReviewFor = useAppStore((s) => s.mergeReviewFor)
  useEffect(() => {
    if (!id || mergeReviewFor !== id || mergePending === null) return
    // Used once, whatever the answer: nothing to merge any more must not open the preview later by itself.
    useAppStore.setState({ mergeReviewFor: null })
    if (!mergePending) return
    setShown(undefined)
    setMergeReview(true)
  }, [id, mergeReviewFor, mergePending])
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

  // Thread / logs follow new lines only while the user is at the bottom; another task or pane starts at the bottom.
  const scroll = useStickToBottom(`${thread.length}:${logs.length}`, `${id}:${pane}`)

  if (!task) return null
  const agent = agentById(agents, task.assigneeId)
  // A refused change says why and the board reloads the real task (no silent optimistic state).
  const save = (patch: ApiArgs<'tasks:update'>[1]): void =>
    void call('tasks:update', task.id, patch).catch((e) => {
      toast('error', apiError(e))
      // The fields show what is really saved again.
      setTitle(task.title)
      setDesc(task.description)
      setAcc(task.acceptance)
      void useAppStore.getState().refresh('tasks')
    })
  const send = async (): Promise<void> => {
    if (!draft.trim()) return
    const from = { pid: task.projectId, channel: `task:${task.id}`, snap: draftSnapshot(task.projectId, `task:${task.id}`) }
    try {
      await call('messages:send', from.channel, draft.trim(), from.pid)
      clearSent(from.pid, from.channel, { textRev: from.snap.textRev, fileIds: [] }) // text typed meanwhile stays
    } catch (e) {
      toast('error', apiError(e)) // the note stays
    }
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex max-w-[85%] flex-col border-l border-line bg-[#0e0e11] shadow-pop animate-slide-in" style={{ width }} {...drop.props}>
      {widthHandle}
      {startModal}
      {doneModal}
      {cancelModal}
      <Modal
        open={mergeReview}
        onClose={() => !merging && setMergeReview(false)}
        title={t('tasks:mergeReview.title', { key: task.key })}
        width={720}
        footer={
          <>
            <button className="btn-ghost h-8" disabled={merging} onClick={() => setMergeReview(false)}>
              {t('actions.cancel')}
            </button>
            <button
              className="btn-primary h-8"
              data-testid="merge-confirm"
              disabled={merging || !shown?.basis}
              onClick={() => {
                setMerging(true)
                void call('tasks:merge', task.id, shown!.basis)
                  .then((pending) => {
                    setMergePending(pending)
                    setMergeReview(false)
                    if (!pending) toast('success', t('tasks:mergeReview.merged', { key: task.key }))
                  })
                  .catch((e) => {
                    toast('error', apiError(e))
                    setShown(undefined)
                    setMergeReview(false)
                  })
                  .finally(() => setMerging(false))
              }}
            >
              <GitMerge size={12} /> {t('tasks:mergeReview.merge')}
            </button>
          </>
        }
      >
        <p className="mb-2 text-[13px] leading-relaxed text-zinc-300">{t('tasks:mergeReview.body')}</p>
        {mergeReview && <TaskChanges task={task} onLoad={setShown} />}
        {shown === undefined ? (
          <p className="text-[13px] text-zinc-400">{t('tasks:mergeReview.loading')}</p>
        ) : !shown?.basis ? (
          <p className="text-[13px] text-amber-300">{t('tasks:mergeReview.unreadable')}</p>
        ) : (
          !shown.files.length && <p className="text-[13px] text-zinc-400">{t('tasks:mergeReview.none')}</p>
        )}
      </Modal>
      <DropOverlay show={drop.over} label={t('tasks:drawer.dropLabel', { key: task.key })} />
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[12px] text-zinc-400">{task.key}</span>
        <span className="text-[11px] text-zinc-400">{t('tasks:drawer.createdAgo', { ago: ago(task.createdAt), by: task.createdBy })}</span>
        <div className="ml-auto flex items-center gap-1">
          {mergePending && (
            <button
              className="btn-outline h-6 text-[12px]"
              title={t('tasks:drawer.mergeHint')}
              onClick={() => {
                setShown(undefined)
                setMergeReview(true)
              }}
            >
              <GitMerge size={11} /> {t('tasks:drawer.reviewAndMerge')}
            </button>
          )}
          {task.status === 'in_progress' || activeRun ? (
            <button className="btn-danger h-6 text-[12px]" onClick={() => activeRun && void call('runs:stop', activeRun.id)}>
              <Square size={11} /> {t('actions.stop')}
            </button>
          ) : task.cancelledAt ? (
            <button className="btn-outline h-6 text-[12px]" onClick={() => void call('tasks:reopen', task.id).catch((e) => toast('error', apiError(e)))}>
              <RotateCcw size={11} /> {t('tasks:cancel.reopen')}
            </button>
          ) : (
            task.status !== 'done' && (
              <button className="btn-outline h-6 text-[12px]" onClick={() => guardStart(task.id, task.key, (force) => void call('tasks:start', task.id, force))}>
                <Play size={11} />{' '}
                {task.status === 'in_review' ? t('tasks:drawer.rerunWorker') : heldWhy !== null && task.status === 'todo' ? t('tasks:drawer.retry') : t('tasks:drawer.startNow')}
              </button>
            )
          )}
          {task.status !== 'done' && !task.cancelledAt && (
            <button className="btn-ghost h-6 text-[12px]" data-testid="cancel-task" onClick={() => cancelTask(task)}>
              <Ban size={11} /> {t('tasks:cancel.button')}
            </button>
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
          <button className="icon-btn" onClick={() => selectTask(null)} title={t('actions.close')} aria-label={t('actions.close')}>
            <X size={14} />
          </button>
        </div>
      </div>

      {task.cancelledAt && (
        <div className="border-b border-line bg-white/[0.03] px-4 py-2.5 text-[13px] leading-relaxed text-zinc-300" role="status">
          <div className="font-medium text-zinc-100">
            {activeRun ? t('tasks:cancel.stopping') : t('tasks:cancel.banner', { ago: ago(task.cancelledAt) })}
          </div>
          <div className="mt-0.5 text-zinc-400">{t('tasks:cancel.bannerHint')}</div>
        </div>
      )}
      {task.status === 'todo' && heldWhy !== null && (
        <div className="border-b border-line bg-amber-500/[0.06] px-4 py-2.5 text-[13px] leading-relaxed text-amber-200">
          <div className="font-medium">{heldWhy ? t('tasks:card.held', { reason: heldWhy }) : t('tasks:card.heldNoReason')}</div>
          <div className="mt-0.5 text-amber-200/80">{t('tasks:drawer.heldHint')}</div>
        </div>
      )}
      {task.status === 'todo' && recovering?.kind === 'work' && (
        <div className="flex items-start gap-3 border-b border-line bg-sky-500/[0.06] px-4 py-2.5 text-[13px] leading-relaxed text-sky-200" role="status" data-testid="work-recovery">
          <RefreshCw size={13} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {recovering.waitsForStart
                ? t('tasks:recovery.workWaitsStart', { attempt: recovering.attempt, max: recovering.max })
                : recovering.at
                  ? t('tasks:recovery.workAt', { time: clock(recovering.at), attempt: recovering.attempt, max: recovering.max })
                  : t('tasks:recovery.workStarting')}
            </div>
            {recovering.reason && <div className="mt-0.5 text-sky-200/80">{t('tasks:recovery.workWhy', { reason: recovering.reason })}</div>}
            <div className="mt-0.5 text-sky-200/80">{t('tasks:recovery.workHint', { until: clock(recovering.until) })}</div>
          </div>
          <button className="btn-outline h-7 shrink-0 text-[12px]" onClick={() => cancelTask(task)}>
            {t('tasks:cancel.button')}
          </button>
        </div>
      )}
      {task.status === 'in_review' && recovering && (
        <div className="flex items-start gap-3 border-b border-line bg-sky-500/[0.06] px-4 py-2.5 text-[13px] leading-relaxed text-sky-200" role="status">
          <RefreshCw size={13} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {recovering.kind === 'files'
                ? t('tasks:recovery.files')
                : recovering.waitsForStart
                  ? t('tasks:recovery.waitsStart', { attempt: recovering.attempt, max: recovering.max })
                  : recovering.at
                  ? t('tasks:recovery.retryAt', { time: clock(recovering.at), attempt: recovering.attempt, max: recovering.max })
                  : t('tasks:recovery.retrying')}
            </div>
            <div className="mt-0.5 text-sky-200/80">{t('tasks:recovery.hint', { until: clock(recovering.until) })}</div>
          </div>
          <button
            className="btn-outline h-7 shrink-0 text-[12px]"
            disabled={retrying}
            onClick={() => {
              setRetrying(true)
              void call('tasks:retryReview', task.id)
                .then((r) => r === 'pending' && toast('info', t('tasks:drawer.reviewPending')))
                .catch((e) => toast('error', apiError(e)))
                .finally(() => setRetrying(false))
            }}
          >
            {t('tasks:recovery.now')}
          </button>
        </div>
      )}
      {task.status === 'in_review' && undecided && (
        <div className="flex items-start gap-3 border-b border-line bg-violet-500/[0.06] px-4 py-2.5 text-[13px] leading-relaxed text-violet-200">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{undecidedWhy ? t('tasks:card.undecidedWhy', { reason: undecidedWhy }) : t('tasks:card.undecided')}</div>
            <div className="mt-0.5 text-violet-200/80">{t('tasks:drawer.reviewIssueHint')}</div>
          </div>
          <button
            className="btn-outline h-7 shrink-0 text-[12px]"
            disabled={retrying}
            onClick={() => {
              setRetrying(true)
              void call('tasks:retryReview', task.id)
                .then((r) => r === 'pending' && toast('info', t('tasks:drawer.reviewPending')))
                .catch((e) => toast('error', apiError(e)))
                .finally(() => setRetrying(false))
            }}
          >
            {t('tasks:drawer.retryReview')}
          </button>
        </div>
      )}

      <div ref={detailsRef} className="min-h-0 space-y-3 overflow-y-auto border-b border-line p-4" style={{ maxHeight: detailsMax }}>
        <input
          className="w-full bg-transparent text-[18px] font-semibold text-zinc-100 outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
        />
        {activeRun?.status === 'awaiting_approval' && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[13px] leading-relaxed text-amber-100" data-testid="drawer-awaiting">
            {t('tasks:drawer.approvalHint')}
          </div>
        )}
        <TaskResult task={task} />
        <div className="grid grid-cols-[84px_1fr] items-center gap-y-2 text-[12px]">
          <span className="text-zinc-400">{t('tasks:fields.status')}</span>
          <select
            className="input h-7 w-44 text-[13px]"
            value={task.status}
            onChange={(e) => {
              const status = e.target.value as TaskStatus
              const fail = (e: unknown): void => toast('error', apiError(e))
              if (status === 'in_progress') guardStart(task.id, task.key, (force) => void call('tasks:move', task.id, status, undefined, force).catch(fail))
              else if (status === 'done') guardDone(task, () => void call('tasks:move', task.id, status).catch(fail))
              else void call('tasks:move', task.id, status).catch(fail)
            }}
          >
            {TASK_COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-400">{t('tasks:fields.priority')}</span>
          <select className="input h-7 w-44 text-[13px]" value={task.priority} onChange={(e) => save({ priority: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
            {PRIORITY_META.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-zinc-400">{t('tasks:fields.assignee')}</span>
          <div className="flex items-center gap-2">
            <PixelAvatar agent={agent} size={22} />
            <select className="input h-7 min-w-0 max-w-[18rem] flex-1 text-[13px]" value={task.assigneeId ?? ''} onChange={(e) => save({ assigneeId: e.target.value || null })}>
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
          {activeRun?.status === 'awaiting_approval' ? (
            <span className="text-[12px] text-amber-300">{t('tasks:drawer.notStarted')}</span>
          ) : (
            <div className="flex items-center gap-2">
              <ProgressBar value={task.progress} className="w-44" tone={task.status === 'done' ? 'indigo' : 'emerald'} />
              <span className="font-mono text-[11px] text-zinc-400">{task.progress}%</span>
            </div>
          )}
        </div>
        <textarea
          className="textarea text-[13px]"
          rows={3}
          placeholder={t('tasks:drawer.descriptionPlaceholder')}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== task.description && save({ description: desc })}
        />
        <div>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-zinc-500">{t('tasks:fields.acceptance')}</div>
          <textarea
            className="textarea text-[13px]"
            rows={Math.min(8, Math.max(2, acc.split('\n').length))}
            placeholder={t('tasks:new.acceptancePlaceholder')}
            value={acc}
            onChange={(e) => setAcc(e.target.value)}
            onBlur={() => acc !== task.acceptance && save({ acceptance: acc })}
          />
          {task.acceptanceCheck && task.acceptanceCheck.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[13px]">
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
        {(simWork || simReview) && (
          <div className="rounded-md border border-line bg-zinc-500/10 px-3 py-2 text-[13px] leading-relaxed text-zinc-300" data-testid="drawer-simulated">
            {t(simWork && simReview ? 'tasks:drawer.simulated' : simWork ? 'tasks:drawer.simulatedWork' : 'tasks:drawer.simulatedReview')}
          </div>
        )}
        {task.reviewNote && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[13px] text-amber-100/90">
            <span className="font-medium text-amber-300">{t('tasks:drawer.reviewNote')}</span>
            {task.reviewNote}
          </div>
        )}
        <TaskFiles task={task} droppedFiles={dropped} />
        <TaskChanges task={task} />
        <RecalledTrace items={runs.find((r) => r.recalled.length)?.recalled ?? []} title={t('org:memory.trace.task')} />
      </div>
      {detailsHandle}

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

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="selectable min-h-[120px] flex-1 overflow-y-auto px-4 py-3">
        {pane === 'thread' &&
          (thread.length === 0 ? (
            <div className="text-[13px] text-zinc-400">{t('tasks:drawer.noMessages')}</div>
          ) : (
            <div className="space-y-3">
              {thread.map((m) => {
                const a = agentById(agents, m.senderId)
                if (m.senderType === 'system') {
                  // A "needs you" card's copy: how it ended, the same as in the project chat.
                  const ended = m.meta?.card ? (m.meta.resolution as { outcome: string } | undefined)?.outcome : undefined
                  return (
                    <div key={m.id} className="text-center text-[12px] text-zinc-400">
                      {m.content} · {clock(m.createdAt)}
                      {ended && <div className="mt-0.5 text-zinc-300">{t(`chat:card.outcome.${ended as NeedsOutcome}`)}</div>}
                    </div>
                  )
                }
                return (
                  <div key={m.id} className="flex gap-2.5">
                    {m.senderType === 'user' ? (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-700 text-[11px] font-bold">{t('tasks:drawer.youBadge')}</div>
                    ) : (
                      <PixelAvatar agent={a} size={24} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-zinc-200">{m.senderType === 'user' ? t('tasks:drawer.you') : a?.name}</span>
                        <span className="text-[11px] text-zinc-400">{clock(m.createdAt)}</span>
                      </div>
                      <Markdown text={m.content} />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        {pane === 'logs' && (
          <div className="font-mono text-[12px] leading-[1.65]">
            {logs.length === 0 && <div className="text-zinc-400">{t('tasks:drawer.noLogs')}</div>}
            {logs.map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="shrink-0 text-zinc-500">{clock(l.createdAt)}</span>
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
            {runs.length === 0 && <div className="text-[13px] text-zinc-400">{t('tasks:drawer.noRuns')}</div>}
            {runs.map((r) => (
              <div key={r.id} className="rounded-md border border-line bg-surface p-2.5 text-[13px]">
                <div className="flex items-center gap-2">
                  <PixelAvatar agent={agentById(agents, r.agentId)} size={18} />
                  <span className="text-zinc-300">{agentById(agents, r.agentId)?.name}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 text-[12px]',
                      r.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-300' : r.status === 'failed' ? 'bg-rose-500/10 text-rose-300' : 'bg-white/5 text-zinc-400'
                    )}
                  >
                    {r.status}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-zinc-400">
                    {duration(r.startedAt, r.endedAt)} · {t('tasks:drawer.runTokens', { n: r.tokensIn + r.tokensOut })}
                  </span>
                </div>
                {r.error && <div className="mt-1.5 text-[12px] text-rose-300">{r.error}</div>}
              </div>
            ))}
          </div>
        )}
        <JumpToNew show={scroll.hasNew} onClick={scroll.jump} />
      </div>

      {pane === 'thread' && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 pl-2.5 pr-1 focus-within:border-accent-soft">
            <input
              value={draft}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder={t('tasks:drawer.notePlaceholder')}
              className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
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
