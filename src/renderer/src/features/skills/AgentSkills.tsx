import { useEffect, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent } from '@shared/types'
import type { AgentSkill } from '@shared/skills'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { Section } from '@/features/agents/parts'

/** Agent editor → Skills: what this agent can read (directly or through its units); assign / remove direct ones. */
export function AgentSkills({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const skills = useAppStore((s) => s.skills)
  const units = useAppStore((s) => s.units)
  const showOrg = useAppStore((s) => s.showOrg)
  const toast = useAppStore((s) => s.toast)
  const [mine, setMine] = useState<AgentSkill[]>([])

  useEffect(() => {
    let off = false
    call('skills:forAgent', agent.id)
      .then((r) => !off && setMine(r))
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [agent.id, skills, units])

  const direct = new Set(mine.filter((m) => m.via.some((v) => v.type === 'agent')).map((m) => m.skill.id))
  const assign = (id: string, on: boolean): void => {
    void call('skills:assign', id, { type: 'agent', id: agent.id }, on).catch((e) => toast('error', apiError(e)))
  }

  return (
    <Section
      icon={BookOpen}
      title={t('skills:agent.title')}
      desc={t('skills:agent.desc')}
      action={
        <button className="btn-ghost h-7 shrink-0" onClick={() => showOrg('skills')}>
          {t('skills:agent.manage')}
        </button>
      }
    >
      <div className="space-y-1.5" data-testid="agent-skills">
        {mine.length === 0 && <div className="text-[12px] text-zinc-500">{t('skills:agent.none')}</div>}
        {mine.map(({ skill, via }) => (
          <div key={skill.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12.5px] text-zinc-100">{skill.name}</div>
              <div className="truncate text-[11.5px] text-zinc-400">{skill.description}</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {via.map((v) => (
                <span key={`${v.type}:${v.id}`} className={cn('rounded px-1.5 text-[10.5px]', v.type === 'agent' ? 'bg-indigo-500/15 text-indigo-200' : 'bg-zinc-700/50 text-zinc-300')}>
                  {v.type === 'agent' ? t('skills:agent.direct') : t('skills:agent.via', { name: v.name })}
                </span>
              ))}
            </div>
            {direct.has(skill.id) && (
              <button className="icon-btn h-6 w-6" title={t('skills:assign.remove')} onClick={() => assign(skill.id, false)}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {skills.some((s) => !direct.has(s.id)) && (
          <select className="input mt-1 h-8 w-[260px]" value="" onChange={(e) => e.target.value && assign(e.target.value, true)} data-testid="agent-skill-add">
            <option value="">{t('skills:agent.add')}</option>
            {skills
              .filter((s) => !direct.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.enabled ? '' : ` (${t('skills:agent.off')})`}
                </option>
              ))}
          </select>
        )}
      </div>
    </Section>
  )
}
