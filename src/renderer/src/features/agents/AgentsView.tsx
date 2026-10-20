import { useMemo, useState } from 'react'
import { Plus, Search, Star, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResize } from '@/components/common/Resize'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Empty } from '@/components/common/ui'
import { locale } from '@/i18n'
import { cn, STATUS_META } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { AgentEditor } from './AgentEditor'
import { WORKER_DESK_COUNT } from './constants'
import { NewAgentModal } from './NewAgentModal'

const norm = (s: string): string => s.toLocaleLowerCase(locale())

export function AgentsView() {
  const { t } = useTranslation()
  const [listWidth, listHandle] = useResize('agentsList', 300, { min: 220, max: 600 })
  const agents = useAppStore((s) => s.agents)
  const selectedId = useAppStore((s) => s.selectedAgentId)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return agents
    return agents.filter((a) => [a.name, a.role, ...a.skills].some((v) => norm(v).includes(q)))
  }, [agents, query])
  const workers = useMemo(() => agents.filter((a) => !a.isLead).length, [agents])

  // Fall back to the first agent when nothing (or a deleted agent) is selected.
  const agent = agents.find((a) => a.id === selectedId) ?? agents[0]

  return (
    <div className="flex h-full">
      <aside style={{ width: listWidth }} className="flex shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-[15px] font-semibold text-zinc-100">{t('agents:view.title')}</h1>
              <p className="text-[12px] text-zinc-400">{t('agents:view.subtitle')}</p>
            </div>
          </div>
          <button className="btn-primary h-8 w-full text-[13px]" onClick={() => setCreating(true)}>
            <Plus size={15} /> {t('agents:view.newAgent')}
          </button>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input className="input h-7 pl-8 text-[13px]" placeholder={t('agents:view.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {filtered.map((a) => {
            const active = agent?.id === a.id
            return (
              <button
                key={a.id}
                onClick={() => selectAgent(a.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                  active ? 'border-indigo-500/30 bg-indigo-500/[0.07]' : 'border-transparent hover:bg-white/[0.03]'
                )}
              >
                <PixelAvatar agent={a} size={32} showStatus className={!a.enabled ? 'opacity-40 grayscale' : ''} />
                <div className={cn('min-w-0 flex-1', !a.enabled && 'opacity-60')}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-zinc-100">{a.name}</span>
                    {a.isLead && <Star size={11} className="shrink-0 fill-indigo-300 text-indigo-300" />}
                  </div>
                  <div className="truncate text-[12px] text-zinc-400">{a.role || t('agents:view.noRole')}</div>
                </div>
                <span className={cn('shrink-0 text-[12px]', STATUS_META[a.status].text)}>{STATUS_META[a.status].label}</span>
              </button>
            )
          })}
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-zinc-400">{t('agents:view.noMatch')}</div>}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-zinc-400">
          <span>{t('agents:view.count', { count: agents.length })}</span>
          <span className={cn(workers > WORKER_DESK_COUNT && 'text-amber-400/80')}>
            {t('agents:view.desks', { used: Math.min(workers, WORKER_DESK_COUNT), total: WORKER_DESK_COUNT })}
          </span>
        </div>
      </aside>
      {listHandle}

      <div className="min-w-0 flex-1 overflow-y-auto">
        {agent ? (
          <AgentEditor key={agent.id} agent={agent} />
        ) : (
          <Empty
            icon={<Users size={18} />}
            title={t('agents:view.empty.title')}
            hint={t('agents:view.empty.hint')}
            action={
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t('agents:view.newAgent')}
              </button>
            }
          />
        )}
      </div>

      <NewAgentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
