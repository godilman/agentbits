import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { OrgUnit } from '@shared/types'
import { unitPath } from '@shared/org'
import { Empty } from '@/components/common/ui'
import { locale } from '@/i18n'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { childrenMap, KIND_META, rootUnit } from './meta'
import { UnitEditor } from './UnitEditor'

const norm = (s: string): string => s.toLocaleLowerCase(locale())

/** Left: the unit tree. Right: editor for the selected unit. */
export function TeamsView({ freshUnitId, onCreateChild }: { freshUnitId: string | null; onCreateChild: (parentId: string) => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const selectedId = useAppStore((s) => s.selectedUnitId)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')

  const kids = useMemo(() => childrenMap(units), [units])
  const root = useMemo(() => rootUnit(units), [units])
  const agentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents])
  const unit = units.find((u) => u.id === selectedId) ?? root

  // Keep the selected unit visible: expand its ancestors.
  useEffect(() => {
    if (!unit) return
    const ancestors = unitPath(units, unit.id).slice(0, -1).map((u) => u.id)
    setCollapsed((s) => (ancestors.some((id) => s.has(id)) ? new Set([...s].filter((id) => !ancestors.includes(id))) : s))
  }, [unit, units])

  // While searching, show matches flat with their path.
  const matches = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return null
    return units.filter((u) => norm(u.name).includes(q))
  }, [units, query])

  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const renderNode = (u: OrgUnit, depth: number): React.ReactNode => {
    const children = kids.get(u.id) ?? []
    const open = !collapsed.has(u.id)
    const Icon = KIND_META[u.kind].icon
    const count = u.members.filter((m) => agentIds.has(m.agentId)).length
    const active = unit?.id === u.id
    return (
      <div key={u.id}>
        <div
          className={cn(
            'group flex h-8 items-center gap-1.5 rounded-md pr-1.5 transition-colors',
            active ? 'bg-indigo-500/[0.09] text-zinc-100' : 'text-zinc-300 hover:bg-white/[0.03]'
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            className={cn('flex h-5 w-4 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-300', !children.length && 'invisible')}
            onClick={() => toggle(u.id)}
            title={open ? t('org:teams.collapse') : t('org:teams.expand')}
          >
            <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
          </button>
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => selectUnit(u.id)}>
            <Icon size={13} className="shrink-0" style={{ color: u.color }} />
            <span className={cn('truncate text-[13px]', active && 'font-medium')}>{u.name}</span>
          </button>
          <span className="font-mono text-[10px] text-zinc-500 group-hover:hidden">{count || ''}</span>
          <button
            className="icon-btn hidden h-5 w-5 group-hover:inline-flex"
            title={t('org:teams.addChild')}
            onClick={() => {
              setCollapsed((s) => {
                const n = new Set(s)
                n.delete(u.id)
                return n
              })
              onCreateChild(u.id)
            }}
          >
            <Plus size={12} />
          </button>
        </div>
        {open && children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input h-7 pl-8 text-[13px]" placeholder={t('org:teams.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {matches
            ? matches.map((u) => {
                const Icon = KIND_META[u.kind].icon
                return (
                  <button
                    key={u.id}
                    onClick={() => selectUnit(u.id)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.03]', unit?.id === u.id && 'bg-indigo-500/[0.09]')}
                  >
                    <Icon size={13} style={{ color: u.color }} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-zinc-200">{u.name}</div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {unitPath(units, u.id)
                          .slice(0, -1)
                          .map((p) => p.name)
                          .join(' / ')}
                      </div>
                    </div>
                  </button>
                )
              })
            : root && renderNode(root, 0)}
          {matches && matches.length === 0 && <div className="py-6 text-center text-[13px] text-zinc-500">{t('org:teams.noMatch')}</div>}
        </div>
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-zinc-500">
          <Trans
            i18nKey="org:teams.footer"
            values={{ units: t('org:counts.units', { count: units.length }) }}
            components={{ icon: <Plus size={10} className="inline" /> }}
          />
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {unit ? (
          <UnitEditor key={unit.id} unit={unit} autoFocusName={unit.id === freshUnitId} onCreateChild={onCreateChild} />
        ) : (
          <Empty icon={<Plus size={18} />} title={t('org:teams.empty.title')} hint={t('org:teams.empty.hint')} />
        )}
      </div>
    </div>
  )
}
