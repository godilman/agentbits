import { Blocks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent } from '@shared/types'
import { policyOf } from '@shared/apps'
import { Toggle } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { Section } from '@/features/agents/parts'

/** Agent editor → Apps: which connected apps (MCP) this agent may use. */
export function AgentApps({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)
  const showOrg = useAppStore((s) => s.showOrg)
  const toast = useAppStore((s) => s.toast)
  return (
    <Section
      icon={Blocks}
      title={t('apps:agent.title')}
      desc={t('apps:agent.desc')}
      action={
        <button className="btn-ghost h-7 shrink-0" onClick={() => showOrg('apps')}>
          {t('apps:agent.manage')}
        </button>
      }
    >
      <div className="space-y-1.5" data-testid="agent-apps">
        {apps.length === 0 && <div className="text-[13px] text-zinc-500">{t('apps:agent.none')}</div>}
        {apps.map((a) => (
          <label key={a.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <Toggle
              size="sm"
              checked={a.agentIds.includes(agent.id)}
              onChange={(v) => void call('apps:setPermission', a.id, agent.id, v).catch((e) => toast('error', apiError(e)))}
            />
            <div className="min-w-0 flex-1">
              <div className={a.enabled ? 'text-[13px] text-zinc-100' : 'text-[13px] text-zinc-500'}>{a.name}</div>
              {a.description && <div className="truncate text-[12px] text-zinc-400">{a.description}</div>}
            </div>
            <span className="shrink-0 text-[11px] text-zinc-500">{t('apps:toolCount', { count: a.tools.filter((tl) => policyOf(a, tl) !== 'block').length })}</span>
          </label>
        ))}
      </div>
    </Section>
  )
}
