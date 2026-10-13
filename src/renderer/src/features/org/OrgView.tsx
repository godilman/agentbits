import { useState } from 'react'
import { Network, Plus, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { I18nKey } from '@shared/i18n'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { useAppStore, type OrgTab } from '@/store/useAppStore'
import { AgentsView } from '@/features/agents/AgentsView'
import { nextUnitName, rootUnit } from './meta'
import { OrgChart } from './OrgChart'
import { TeamsView } from './TeamsView'
import { TemplatesView } from './TemplatesView'
import { ConnectionsView } from '@/features/connections/ConnectionsView'
import { SkillsView } from '@/features/skills/SkillsView'
import { AppsView } from '@/features/apps/AppsView'

const TABS: { value: OrgTab; labelKey: I18nKey }[] = [
  { value: 'chart', labelKey: 'org:view.tabs.chart' },
  { value: 'teams', labelKey: 'org:view.tabs.teams' },
  { value: 'agents', labelKey: 'org:view.tabs.agents' },
  { value: 'templates', labelKey: 'org:view.tabs.templates' },
  { value: 'skills', labelKey: 'org:view.tabs.skills' },
  { value: 'apps', labelKey: 'org:view.tabs.apps' },
  { value: 'connections', labelKey: 'org:view.tabs.connections' }
]

/** Organization page: chart, teams (units), agents and templates. */
export function OrgView() {
  const { t } = useTranslation()
  const orgTab = useAppStore((s) => s.orgTab)
  const showOrg = useAppStore((s) => s.showOrg)
  const unitCount = useAppStore((s) => s.units.length)
  const agentCount = useAppStore((s) => s.agents.length)
  // Unit just created from here: its name field gets focus in the editor.
  const [freshUnitId, setFreshUnitId] = useState<string | null>(null)

  const createUnit = async (parentId?: string): Promise<void> => {
    const { units, selectedUnitId, selectUnit, toast, orgTab: tab } = useAppStore.getState()
    // From the Takımlar tab the new unit goes under the unit being edited; elsewhere under the root.
    const parent = parentId ?? (tab === 'teams' && units.some((u) => u.id === selectedUnitId) ? selectedUnitId : rootUnit(units)?.id)
    try {
      const u = await call('units:save', { name: nextUnitName(units, 'team'), kind: 'team', parentId: parent ?? null })
      // The store refreshes on `units:changed`; make sure the new unit is there before selecting it.
      await useAppStore.getState().refresh('units')
      setFreshUnitId(u.id)
      selectUnit(u.id)
      showOrg('teams')
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-5 border-b border-line px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Network size={16} className="shrink-0 text-indigo-300" />
          <div className="min-w-0 leading-tight">
            <div className="text-[13.5px] font-semibold text-zinc-100">{t('org:view.title')}</div>
            <div className="truncate text-[11px] text-zinc-500">
              {t('org:view.subtitle', { units: t('org:counts.units', { count: unitCount }), agents: t('org:counts.agents', { count: agentCount }) })}
            </div>
          </div>
        </div>
        <Segmented value={orgTab} options={TABS.map((tab) => ({ value: tab.value, label: t(tab.labelKey) }))} onChange={(v) => showOrg(v)} />
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-ghost" onClick={() => showOrg('templates')}>
            <Wand2 size={13} /> {t('org:view.fromTemplate')}
          </button>
          <button className="btn-primary" onClick={() => void createUnit()}>
            <Plus size={14} /> {t('org:view.newUnit')}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {orgTab === 'chart' && <OrgChart />}
        {orgTab === 'teams' && <TeamsView freshUnitId={freshUnitId} onCreateChild={(id) => void createUnit(id)} />}
        {orgTab === 'agents' && <AgentsView />}
        {orgTab === 'templates' && <TemplatesView />}
        {orgTab === 'skills' && <SkillsView />}
        {orgTab === 'apps' && <AppsView />}
        {orgTab === 'connections' && <ConnectionsView />}
      </div>
    </div>
  )
}
