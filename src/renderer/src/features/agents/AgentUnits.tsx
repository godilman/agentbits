import { useMemo, useState } from 'react'
import { FolderKanban, Network, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent, OrgUnit } from '@shared/types'
import { projectMemberIds, unitPath } from '@shared/org'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { flattenTree, indentLabel, KIND_META } from '@/features/org/meta'
import { Section } from './parts'

/** Org units the agent belongs to (with its title in each) and the projects that follows from. */
export function AgentUnits({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const projects = useAppStore((s) => s.projects)
  const toast = useAppStore((s) => s.toast)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const showOrg = useAppStore((s) => s.showOrg)
  const openProject = useAppStore((s) => s.openProject)

  const memberships = useMemo(
    () =>
      units.flatMap((u) => {
        const m = u.members.find((x) => x.agentId === agent.id)
        return m ? [{ unit: u, title: m.title }] : []
      }),
    [units, agent.id]
  )
  const options = useMemo(() => flattenTree(units).filter(({ unit }) => !unit.members.some((m) => m.agentId === agent.id)), [units, agent.id])
  const agentProjects = useMemo(
    () => projects.filter((p) => p.status !== 'archived' && projectMemberIds(p, units).includes(agent.id)),
    [projects, units, agent.id]
  )

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      onSaved()
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <Section
      icon={Network}
      title={t('agents:units.title')}
      desc={t('agents:units.desc')}
    >
      <div className="space-y-1.5">
        {memberships.map(({ unit, title }) => (
          <MembershipRow
            key={unit.id}
            unit={unit}
            path={unitPath(units, unit.id)
              .slice(0, -1)
              .map((u) => u.name)
              .join(' / ')}
            title={title}
            isLead={unit.leadAgentId === agent.id}
            onOpen={() => {
              selectUnit(unit.id)
              showOrg('teams')
            }}
            onTitle={(title) => void run(() => call('units:addMember', unit.id, agent.id, title))}
            onRemove={() => void run(() => call('units:removeMember', unit.id, agent.id))}
          />
        ))}
        {memberships.length === 0 && (
          <div className="rounded-md border border-dashed border-line px-3 py-3 text-[13px] text-zinc-500">
            {t('agents:units.none')}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <select
          className="input h-7 w-auto min-w-[240px] text-[13px]"
          value=""
          onChange={(e) => e.target.value && void run(() => call('units:addMember', e.target.value, agent.id))}
          disabled={options.length === 0}
        >
          <option value="">{options.length ? t('agents:units.addTo') : t('agents:units.allUnits')}</option>
          {options.map(({ unit, depth }) => (
            <option key={unit.id} value={unit.id}>
              {indentLabel(unit.name, depth)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 border-t border-line-soft pt-4">
        <div className="label">{t('agents:units.projects')}</div>
        {agentProjects.length ? (
          <div className="flex flex-wrap gap-1.5">
            {agentProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-[12px] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[13px] text-zinc-500">
            <FolderKanban size={12} /> {t('agents:units.noProjects')}
          </div>
        )}
      </div>
    </Section>
  )
}

function MembershipRow({
  unit,
  path,
  title,
  isLead,
  onOpen,
  onTitle,
  onRemove
}: {
  unit: OrgUnit
  path: string
  title: string
  isLead: boolean
  onOpen: () => void
  onTitle: (t: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(title)
  const Icon = KIND_META[unit.kind].icon
  return (
    <div className="group flex items-center gap-3 rounded-md border border-line-soft bg-surface-2/40 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${unit.color}22`, color: unit.color }}>
        <Icon size={14} />
      </div>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} title={t('agents:units.openUnit')}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-zinc-200 hover:text-white">{unit.name}</span>
          {isLead && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 text-[12px] font-medium text-amber-300">
              <Star size={9} className="fill-amber-300" /> {t('agents:units.lead')}
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-zinc-500">{path ? `${path} · ${KIND_META[unit.kind].label}` : KIND_META[unit.kind].label}</div>
      </button>
      <input
        className="input h-7 w-[200px] text-[13px]"
        placeholder={t('agents:units.titlePlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== title && onTitle(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button className="icon-btn hover:text-rose-400" title={t('agents:units.remove')} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  )
}
