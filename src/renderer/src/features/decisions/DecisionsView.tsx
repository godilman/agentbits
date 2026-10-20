import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Scale, Trash2, X } from 'lucide-react'
import type { Decision, DecisionStatus } from '@shared/types'
import { t as tr } from '@/i18n'
import { Empty, Segmented } from '@/components/common/ui'
import { call } from '@/lib/api'
import { cn, timeAgo } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

// Labels are getters so they always read the current language.
const STATUS: Record<DecisionStatus, { label: string; cls: string }> = {
  proposed: { get label() { return tr('decisions:status.proposed') }, cls: 'bg-sky-500/10 text-sky-300 ring-sky-500/20' },
  accepted: { get label() { return tr('decisions:status.accepted') }, cls: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' },
  rejected: { get label() { return tr('decisions:status.rejected') }, cls: 'bg-rose-500/10 text-rose-300 ring-rose-500/20' },
  superseded: { get label() { return tr('decisions:status.superseded') }, cls: 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20' }
}

type Filter = 'all' | DecisionStatus

export function DecisionsView() {
  const { t } = useTranslation(['common', 'decisions'])
  const allDecisions = useAppStore((s) => s.decisions)
  const pid = useAppStore((s) => s.activeProjectId)
  const decisions = useMemo(() => allDecisions.filter((d) => d.projectId === pid), [allDecisions, pid])
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const list = decisions.filter((d) => filter === 'all' || d.status === filter)
  const current = creating ? null : decisions.find((d) => d.id === selected) ?? list[0]

  return (
    <div className="flex h-full">
      <div className="flex w-[360px] shrink-0 flex-col border-r border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-zinc-100">{t('decisions:list.title')}</h1>
            <div className="text-[12px] text-zinc-400">{t('decisions:list.subtitle')}</div>
          </div>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> {t('decisions:list.new')}
          </button>
        </div>
        <div className="px-3 py-2">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('decisions:filter.all') },
              { value: 'proposed', label: `${t('decisions:filter.proposed')} ${decisions.filter((d) => d.status === 'proposed').length || ''}` },
              { value: 'accepted', label: t('decisions:filter.accepted') },
              { value: 'rejected', label: t('decisions:filter.rejected') }
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {list.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setCreating(false)
                setSelected(d.id)
              }}
              className={cn(
                'w-full rounded-md border p-3 text-left transition-colors',
                current?.id === d.id ? 'border-indigo-500/40 bg-indigo-500/[0.05]' : 'border-line bg-surface hover:border-zinc-700'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-zinc-400">ADR-{d.seq}</span>
                <span className={cn('rounded px-1.5 py-px text-[12px] font-medium ring-1 ring-inset', STATUS[d.status].cls)}>{STATUS[d.status].label}</span>
                <span className="ml-auto text-[11px] text-zinc-400">{timeAgo(d.createdAt)}</span>
              </div>
              <div className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-zinc-200">{d.title}</div>
              {d.decidedBy && <div className="mt-1 text-[12px] text-zinc-400">{d.decidedBy}</div>}
            </button>
          ))}
          {list.length === 0 && <div className="py-8 text-center text-[13px] text-zinc-400">{t('decisions:list.empty')}</div>}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {creating || current ? (
          <DecisionEditor
            key={creating ? 'new' : current!.id}
            decision={creating ? null : current!}
            projectId={pid}
            onSaved={(d) => {
              setCreating(false)
              setSelected(d.id)
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Empty icon={<Scale size={18} />} title={t('decisions:list.emptyTitle')} hint={t('decisions:list.emptyHint')} />
        )}
      </div>
    </div>
  )
}

function DecisionEditor({
  decision,
  projectId,
  onSaved,
  onCancel
}: {
  decision: Decision | null
  projectId: string | null
  onSaved: (d: Decision) => void
  onCancel: () => void
}) {
  const { t } = useTranslation(['common', 'decisions'])
  const [form, setForm] = useState({
    title: decision?.title ?? '',
    context: decision?.context ?? '',
    decision: decision?.decision ?? '',
    rationale: decision?.rationale ?? ''
  })
  const [dirty, setDirty] = useState(false)
  useEffect(() => setDirty(false), [decision?.id])
  const set = (k: keyof typeof form, v: string): void => {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
  }
  const save = async (status?: DecisionStatus): Promise<void> => {
    if (!form.title.trim()) return
    const d = await call('decisions:save', { ...form, ...(status ? { status } : {}), ...(decision ? {} : { decidedBy: t('decisions:editor.decidedByUser'), projectId }) }, decision?.id)
    setDirty(false)
    onSaved(d)
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2 gap-y-2">
        {decision && <span className="font-mono text-[11px] text-zinc-400">ADR-{decision.seq}</span>}
        {decision && <span className={cn('rounded px-1.5 py-px text-[12px] font-medium ring-1 ring-inset', STATUS[decision.status].cls)}>{STATUS[decision.status].label}</span>}
        <div className="ml-auto flex gap-1.5">
          {decision && decision.status !== 'accepted' && (
            <button className="btn h-7 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" onClick={() => void save('accepted')}>
              <Check size={13} /> {t('decisions:editor.accept')}
            </button>
          )}
          {decision && decision.status !== 'rejected' && (
            <button className="btn-ghost h-7" onClick={() => void save('rejected')}>
              <X size={13} /> {t('actions.reject')}
            </button>
          )}
          {decision?.status === 'accepted' && (
            <button className="btn-ghost h-7" onClick={() => void save('superseded')}>
              {t('decisions:editor.supersede')}
            </button>
          )}
          {decision && (
            <button className="icon-btn h-7 w-7 hover:text-rose-400" onClick={() => void call('decisions:delete', decision.id)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      <input
        className="mb-5 w-full bg-transparent text-[18px] font-semibold text-zinc-100 outline-none placeholder:text-zinc-500"
        placeholder={t('decisions:editor.titlePlaceholder')}
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        autoFocus={!decision}
      />
      {(['context', 'decision', 'rationale'] as const).map((k) => (
        <div key={k} className="mb-4">
          <label className="label">{t(`decisions:editor.fields.${k}`)}</label>
          <textarea className="textarea" rows={k === 'decision' ? 4 : 3} value={form[k]} onChange={(e) => set(k, e.target.value)} />
        </div>
      ))}
      <div className="flex justify-end gap-2">
        {!decision && (
          <button className="btn-ghost" onClick={onCancel}>
            {t('actions.cancel')}
          </button>
        )}
        <button className="btn-primary" disabled={!form.title.trim() || (!dirty && !!decision)} onClick={() => void save(decision ? undefined : 'proposed')}>
          {decision ? t('actions.save') : t('decisions:editor.propose')}
        </button>
        {!decision && (
          <button className="btn h-7 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" disabled={!form.title.trim()} onClick={() => void save('accepted')}>
            {t('decisions:editor.acceptDirectly')}
          </button>
        )}
      </div>
    </div>
  )
}
