import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Memory, MemoryKind } from '@shared/types'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, timeAgo } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { KindBadge, KINDS, LearnMode, MemoryEditor, SuggestionRow, TopicChips } from './parts'
import { MemoryGraphView } from './MemoryGraph'

type Pane = 'graph' | 'list'

const isProfile = (m: Memory): boolean => m.kind === 'preference' && !m.agentId && !m.projectId && !m.taskId && !m.supersededBy

/** Organization → Memory: what the team knows about you, what it wants to remember, and everything it remembers. */
export function MemoryView() {
  const { t } = useTranslation()
  const version = useAppStore((s) => s.memoryVersion)
  const suggestions = useAppStore((s) => s.memorySuggestions)
  const [pane, setPane] = useState<Pane>('graph')
  const [all, setAll] = useState<Memory[]>([])
  useEffect(() => {
    void call('memory:list', { limit: 1000 }).then(setAll)
  }, [version])
  const profile = useMemo(() => all.filter(isProfile), [all])

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(15rem,3fr)] min-[900px]:grid-cols-[minmax(300px,360px)_1fr] min-[900px]:grid-rows-1">
      <aside className="min-h-0 space-y-4 overflow-y-auto border-r border-line p-4">
        <ProfileCard items={profile} />
        {suggestions.length > 0 && (
          <section className="space-y-2">
            <div className="text-[13px] font-semibold text-zinc-100">{t('org:memory.suggest.heading', { count: suggestions.length })}</div>
            {suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} />
            ))}
          </section>
        )}
        <section className="card p-3">
          <div className="mb-1 text-[13px] font-semibold text-zinc-100">{t('org:memory.learn.title')}</div>
          <div className="mb-2 text-[12px] leading-relaxed text-zinc-400">{t('org:memory.learn.desc')}</div>
          <LearnMode />
        </section>
      </aside>
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 gap-y-1 border-b border-line px-4 py-2">
          <Segmented<Pane>
            value={pane}
            onChange={setPane}
            options={[
              { value: 'graph', label: t('org:memory.tabs.graph') },
              { value: 'list', label: t('org:memory.tabs.list', { count: all.length }) }
            ]}
          />
          <span className="min-w-0 text-[12px] text-zinc-400">{t(pane === 'graph' ? 'org:memory.graphHint' : 'org:memory.listHint')}</span>
        </div>
        <div className="min-h-0 flex-1">{pane === 'graph' ? <MemoryGraphView /> : <MemoryList items={all} />}</div>
      </div>
    </div>
  )
}

/** "Seni tanıyorum": what every agent is told about the user. */
function ProfileCard({ items }: { items: Memory[] }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const add = async (): Promise<void> => {
    try {
      await call('memory:add', text.trim(), 'preference', null, null)
      setText('')
    } catch (e) {
      toast('error', apiError(e))
    }
  }
  return (
    <section className="card p-3" data-testid="memory-profile">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-500/10 text-pink-300">
          <UserRound size={14} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-zinc-100">{t('org:memory.profile.title')}</div>
          <div className="text-[12px] text-zinc-400">{t('org:memory.profile.desc')}</div>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((m) => (
          <li key={m.id} className="group rounded-md border border-line-soft bg-surface-2/60 px-2.5 py-2">
            {editing === m.id ? (
              <MemoryEditor memory={m} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="selectable text-[13px] leading-snug text-zinc-200">{m.content}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                    <span>{t(m.source === 'learned' ? 'org:memory.source.learned' : 'org:memory.source.user')}</span>
                    <span>· {timeAgo(m.createdAt)}</span>
                    <TopicChips topics={m.topics} />
                  </div>
                </div>
                <RowActions onEdit={() => setEditing(m.id)} id={m.id} />
              </div>
            )}
          </li>
        ))}
        {!items.length && <li className="py-2 text-[13px] text-zinc-400">{t('org:memory.profile.empty')}</li>}
      </ul>
      <div className="mt-3 flex gap-1.5">
        <input
          data-testid="memory-profile-add"
          className="input h-8 flex-1 text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && void add()}
          placeholder={t('org:memory.profile.addPlaceholder')}
        />
        <button className="btn-outline h-8" disabled={!text.trim()} onClick={() => void add()} title={t('actions.add')}>
          <Plus size={13} />
        </button>
      </div>
    </section>
  )
}

function RowActions({ id, onEdit }: { id: string; onEdit: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      <button className="icon-btn h-6 w-6" title={t('actions.edit')} onClick={onEdit}>
        <Pencil size={12} />
      </button>
      <button className="icon-btn h-6 w-6 hover:text-rose-400" title={t('org:memory.forget')} onClick={() => void call('memory:delete', id)}>
        <Trash2 size={12} />
      </button>
    </div>
  )
}

/** Every memory: search, filter by kind, add, edit, forget. */
function MemoryList({ items }: { items: Memory[] }) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const toast = useAppStore((s) => s.toast)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Set<string> | null>(null)
  const [kind, setKind] = useState<MemoryKind | 'all'>('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [newKind, setNewKind] = useState<MemoryKind>('fact')
  const [agentId, setAgentId] = useState('')
  const [projectId, setProjectId] = useState('')

  // Search by words (full-text index, same as agents' recall); empty = everything.
  useEffect(() => {
    if (!query.trim()) return setFound(null)
    const timer = setTimeout(() => void call('memory:list', { query, limit: 500 }).then((r) => setFound(new Set(r.map((m) => m.id)))), 150)
    return () => clearTimeout(timer)
  }, [query, items])

  const shown = items.filter((m) => (kind === 'all' || m.kind === kind) && (!found || found.has(m.id)))
  const add = async (): Promise<void> => {
    try {
      await call('memory:add', content.trim(), newKind, agentId || null, projectId || null)
      setContent('')
    } catch (e) {
      toast('error', apiError(e))
    }
  }
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="card mb-4 p-3">
        <textarea className="textarea text-[13px]" rows={2} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('org:memory.add.placeholder')} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="input h-7 min-w-36 text-[13px]" value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`org:memory.kinds.${k}`)}
              </option>
            ))}
          </select>
          <select className="input h-7 min-w-44 text-[13px]" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t('org:memory.add.allAgents')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {t('org:memory.add.onlyAgent', { name: a.name })}
              </option>
            ))}
          </select>
          <select className="input h-7 min-w-44 text-[13px]" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('org:memory.add.allProjects')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {t('org:memory.add.onlyProject', { name: p.name })}
              </option>
            ))}
          </select>
          <button className="btn-primary ml-auto h-7" disabled={!content.trim()} onClick={() => void add()}>
            {t('actions.add')}
          </button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input data-testid="memory-search" className="input pl-8" placeholder={t('org:memory.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Segmented<MemoryKind | 'all'>
          value={kind}
          onChange={setKind}
          options={[{ value: 'all' as const, label: t('org:memory.kinds.all') }, ...KINDS.map((k) => ({ value: k, label: t(`org:memory.kinds.${k}`) }))]}
        />
      </div>
      <div className="space-y-1.5">
        {shown.map((m) => {
          const a = agents.find((x) => x.id === m.agentId)
          const p = projects.find((x) => x.id === m.projectId)
          return (
            <div key={m.id} className={cn('group rounded-md border border-line bg-surface px-3 py-2.5', m.supersededBy && 'opacity-55')}>
              {editing === m.id ? (
                <MemoryEditor memory={m} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-start gap-3">
                  <KindBadge kind={m.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="selectable text-[13px] leading-snug text-zinc-300">{m.content}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      {m.supersededBy && <span className="rounded bg-rose-500/10 px-1.5 text-[12px] text-rose-300">{t('org:memory.superseded')}</span>}
                      <span>{a ? a.name : t('org:memory.shared')}</span>
                      {p && <span>· {p.name}</span>}
                      <span>
                        · ★{m.importance.toFixed(1)} · {t('org:memory.used', { count: m.accessCount })} · {timeAgo(m.createdAt)}
                      </span>
                      <TopicChips topics={m.topics} />
                    </div>
                  </div>
                  <RowActions id={m.id} onEdit={() => setEditing(m.id)} />
                </div>
              )}
            </div>
          )
        })}
        {shown.length === 0 && <div className="py-6 text-center text-[13px] text-zinc-400">{t('org:memory.empty')}</div>}
      </div>
    </div>
  )
}
