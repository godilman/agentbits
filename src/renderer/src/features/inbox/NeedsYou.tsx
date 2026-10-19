import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BellRing, Brain, GitMerge, KeyRound, PauseCircle, ShieldAlert, UserCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

interface Item {
  id: string
  icon: typeof BellRing
  tone: string
  title: string
  detail: string
  taskId: string | null
  projectId: string | null
}

/**
 * "Needs you": everything waiting for the user in one place — approvals, unmerged work, reviews the lead left open,
 * held tasks with their reason, agents stopped by an error. Each row jumps to the task.
 */
export function NeedsYouButton() {
  const { t } = useTranslation()
  const approvals = useAppStore((s) => s.approvals)
  const activeRuns = useAppStore((s) => s.activeRuns)
  const tasks = useAppStore((s) => s.tasks)
  const agents = useAppStore((s) => s.agents)
  const waits = useAppStore((s) => s.orchestratorWaits)
  const reviewByLead = useAppStore((s) => s.settings.reviewByLead)
  const suggestions = useAppStore((s) => s.memorySuggestions)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const byId = new Map(tasks.map((x) => [x.id, x]))
    const label = (id: string | null): string => {
      const x = id ? byId.get(id) : null
      return x ? `${x.key} · ${x.title}` : ''
    }
    const out: Item[] = []
    for (const a of approvals) {
      out.push({ id: `ap-${a.id}`, icon: ShieldAlert, tone: 'text-rose-300', title: t('layout:needsYou.approval', { agent: a.agentName, target: a.connectionName }), detail: a.taskKey ?? '', taskId: a.taskId, projectId: a.projectId })
    }
    for (const r of activeRuns.filter((x) => x.status === 'awaiting_approval')) {
      const agent = agents.find((a) => a.id === r.agentId)?.name ?? '?'
      out.push({ id: `run-${r.id}`, icon: KeyRound, tone: 'text-amber-300', title: t('layout:needsYou.runApproval', { agent }), detail: label(r.taskId), taskId: r.taskId, projectId: r.projectId })
    }
    for (const id of waits.undecided) {
      out.push({ id: `un-${id}`, icon: UserCheck, tone: 'text-violet-300', title: t('layout:needsYou.undecided'), detail: label(id), taskId: id, projectId: byId.get(id)?.projectId ?? null })
    }
    if (!reviewByLead) {
      for (const x of tasks.filter((x) => x.status === 'in_review' && !waits.undecided.includes(x.id))) {
        out.push({ id: `rv-${x.id}`, icon: UserCheck, tone: 'text-violet-300', title: t('layout:needsYou.review'), detail: label(x.id), taskId: x.id, projectId: x.projectId })
      }
    }
    for (const id of waits.unmerged) {
      out.push({ id: `mg-${id}`, icon: GitMerge, tone: 'text-sky-300', title: t('layout:needsYou.unmerged'), detail: label(id), taskId: id, projectId: byId.get(id)?.projectId ?? null })
    }
    for (const [id, reason] of Object.entries(waits.held)) {
      const x = byId.get(id)
      if (!x || x.status !== 'todo') continue
      out.push({ id: `hd-${id}`, icon: PauseCircle, tone: 'text-amber-300', title: reason ? t('layout:needsYou.held', { reason }) : t('layout:needsYou.heldNoReason'), detail: label(id), taskId: id, projectId: x.projectId })
    }
    for (const m of suggestions) {
      out.push({
        id: `mem-${m.id}`,
        icon: Brain,
        tone: 'text-pink-300',
        title: m.targetFile ? t('org:memory.suggest.noteTitle') : t('layout:needsYou.memory'),
        detail: m.targetFile ? `${m.targetFile}: ${m.content}` : m.content,
        taskId: null,
        projectId: null
      })
    }
    for (const a of agents.filter((x) => x.enabled && x.status === 'error')) {
      out.push({ id: `ag-${a.id}`, icon: AlertTriangle, tone: 'text-rose-300', title: t('layout:needsYou.agentError', { agent: a.name }), detail: a.statusNote ?? '', taskId: null, projectId: null })
    }
    return out
  }, [approvals, activeRuns, tasks, agents, waits, reviewByLead, suggestions, t])

  const go = (it: Item): void => {
    const s = useAppStore.getState()
    setOpen(false)
    if (it.taskId && it.projectId) {
      s.openProject(it.projectId)
      s.setTab('tasks')
      s.selectTask(it.taskId)
    } else if (it.id.startsWith('ag-')) {
      s.openAgentProfile(it.id.slice(3))
    } else if (it.id.startsWith('mem-')) {
      s.showOrg('memory')
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="needs-you"
        onClick={() => setOpen((v) => !v)}
        title={t('layout:needsYou.title')}
        aria-expanded={open}
        className={cn(
          'btn h-7 border',
          items.length ? 'border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15' : 'border-line bg-surface-2 text-zinc-400 hover:text-zinc-200'
        )}
      >
        <BellRing size={13} />
        <span className="hidden min-[1100px]:inline">{t('layout:needsYou.button')}</span>
        {items.length > 0 && <span className="rounded bg-rose-500/80 px-1 text-[10.5px] font-semibold text-white">{items.length}</span>}
      </button>
      {open && (
        <div className="card shadow-pop absolute right-0 top-9 z-50 w-[420px] overflow-hidden">
          <div className="border-b border-line-soft px-4 py-2.5">
            <div className="text-[13px] font-semibold text-zinc-100">{t('layout:needsYou.title')}</div>
            <div className="text-[11.5px] text-zinc-400">{t('layout:needsYou.desc')}</div>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-zinc-400">{t('layout:needsYou.empty')}</div>
          ) : (
            <div className="max-h-[60vh] divide-y divide-line-soft overflow-y-auto">
              {items.map((it) => (
                <button key={it.id} onClick={() => go(it)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.04]">
                  <it.icon size={14} className={cn('mt-0.5 shrink-0', it.tone)} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] leading-snug text-zinc-200">{it.title}</div>
                    {it.detail && <div className="truncate text-[11.5px] text-zinc-400">{it.detail}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
