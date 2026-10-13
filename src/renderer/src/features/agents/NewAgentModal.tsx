import { useEffect, useMemo, useState } from 'react'
import type { Agent } from '@shared/types'
import { Check, Shuffle, TriangleAlert } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Modal } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { PERM_TEMPLATES, PERMISSIONS, WORKER_DESK_COUNT, randomLook, type PermTemplateId } from './constants'
import { Field, TagInput } from './parts'

/**
 * Creates an agent. With `unitId` the new agent also joins that org unit; `onCreated`
 * replaces the default "select it in the Agents editor" behaviour.
 */
export function NewAgentModal({
  open,
  onClose,
  unitId,
  onCreated
}: {
  open: boolean
  onClose: () => void
  unitId?: string | null
  onCreated?: (agent: Agent) => void
}) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const unit = useAppStore((s) => (unitId ? s.units.find((u) => u.id === unitId) : undefined))
  const selectAgent = useAppStore((s) => s.selectAgent)
  const toast = useAppStore((s) => s.toast)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [template, setTemplate] = useState<PermTemplateId>('developer')
  const [look, setLook] = useState(() => randomLook([]))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setRole('')
    setJobDescription('')
    setSkills([])
    setTemplate('developer')
    setLook(randomLook(useAppStore.getState().agents))
    setError(null)
    setBusy(false)
  }, [open])

  const workers = useMemo(() => agents.filter((a) => !a.isLead).length, [agents])
  const deskFull = workers >= WORKER_DESK_COUNT
  const trimmed = name.trim()

  const submit = async (): Promise<void> => {
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const perms = PERM_TEMPLATES.find((pt) => pt.id === template)!.perms
      const a = await call(
        'agents:save',
        { name: trimmed, role: role.trim() || 'Engineer', jobDescription: jobDescription.trim(), skills, ...look },
        undefined,
        perms
      )
      if (unit) await call('units:addMember', unit.id, a.id)
      if (onCreated) onCreated(a)
      else selectAgent(a.id)
      toast('success', unit ? t('agents:new.joinedUnit', { name: a.name, unit: unit.name }) : t('agents:new.joined', { name: a.name }))
      onClose()
    } catch (e) {
      setError(apiError(e))
      setBusy(false)
    }
  }

  const preview = { ...look, name: trimmed || t('agents:new.defaultName'), status: 'idle' as const }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={600}
      title={unit ? t('agents:new.titleUnit', { unit: unit.name }) : t('agents:new.title')}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" disabled={!trimmed || busy} onClick={() => void submit()}>
            {t('agents:new.create')} <span className="kbd ml-1 border-white/20 bg-white/10 text-white/70">Ctrl ↵</span>
          </button>
        </>
      }
    >
      <div className="space-y-5" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void submit()}>
        <div className="flex gap-4">
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <div className="rounded-xl border border-line bg-surface-2 p-1.5">
              <PixelAvatar agent={preview} size={64} />
            </div>
            <button className="btn-ghost h-6 px-1.5 text-[11px]" title={t('agents:new.shuffleTitle')} onClick={() => setLook(randomLook(agents))}>
              <Shuffle size={11} /> {t('agents:fields.shuffle')}
            </button>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 self-start">
            <Field label={t('agents:fields.name')}>
              <input
                autoFocus
                className={cn('input', error && 'border-rose-500/60')}
                value={name}
                placeholder={t('agents:new.namePlaceholder')}
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && !e.ctrlKey && !e.metaKey && void submit()}
              />
            </Field>
            <Field label={t('agents:fields.role')}>
              <input className="input" value={role} placeholder={t('agents:new.rolePlaceholder')} onChange={(e) => setRole(e.target.value)} />
            </Field>
            {error && <div className="col-span-2 -mt-1 text-[11.5px] text-rose-400">{error}</div>}
          </div>
        </div>

        <Field label={t('agents:fields.jobDescription')} hint={t('agents:new.jobDescHint')}>
          <textarea
            className="textarea"
            rows={4}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder={t('agents:new.jobDescPlaceholder')}
          />
        </Field>

        <Field label={t('agents:fields.skills')} hint={t('agents:new.skillsHint')}>
          <TagInput value={skills} onChange={setSkills} placeholder={t('agents:new.skillsPlaceholder')} />
        </Field>

        <div>
          <label className="label">{t('agents:new.permTemplate')}</label>
          <div className="grid grid-cols-3 gap-2">
            {PERM_TEMPLATES.map((pt) => {
              const active = template === pt.id
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => setTemplate(pt.id)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors',
                    active ? 'border-indigo-500/50 bg-indigo-500/[0.08]' : 'border-line bg-surface-2 hover:border-zinc-600'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-[12.5px] font-medium', active ? 'text-zinc-100' : 'text-zinc-300')}>{pt.label}</span>
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                        active ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-zinc-600'
                      )}
                    >
                      {active && <Check size={9} strokeWidth={3} />}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-zinc-400">{pt.desc}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {PERMISSIONS.filter((p) => pt.perms[p.key]).map((p) => (
                      <span key={p.key} title={p.label} className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.05] text-zinc-400">
                        <p.icon size={11} />
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="mt-1.5 text-[11.5px] text-zinc-400">{t('agents:new.permNote')}</div>
        </div>

        {unit && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[12px] text-zinc-400">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: unit.color }} />
            <Trans i18nKey="agents:new.unitNote" values={{ unit: unit.name }} components={{ b: <span className="font-medium text-zinc-200" /> }} />
          </div>
        )}

        {deskFull && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200/90">
            <TriangleAlert size={14} className="mt-px shrink-0 text-amber-400" />
            {t('agents:new.desksFull', { desks: WORKER_DESK_COUNT })}
          </div>
        )}
      </div>
    </Modal>
  )
}
