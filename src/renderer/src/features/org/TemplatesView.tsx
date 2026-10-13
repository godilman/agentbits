import { useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Recycle, Star, Wand2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { TeamTemplate, TemplateNodePreview } from '@shared/types'
import { Empty, Modal } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { Field } from '@/features/agents/parts'
import { flattenTree, indentLabel, KIND_META, rootUnit } from './meta'

export function TemplatesView() {
  const { t } = useTranslation()
  const templates = useAppStore((s) => s.templates)
  const showOrg = useAppStore((s) => s.showOrg)
  const [using, setUsing] = useState<TeamTemplate | null>(null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-6">
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <Recycle size={16} className="shrink-0 text-emerald-400" />
          <div className="flex-1 text-[12.5px] leading-snug text-zinc-400">
            <span className="text-zinc-200">{t('org:templates.intro.lead')}</span> {t('org:templates.intro.body')}
          </div>
          <button className="btn-ghost shrink-0" onClick={() => showOrg('teams')}>
            {t('org:templates.goToTeams')}
          </button>
        </div>

        {templates.length === 0 ? (
          <Empty icon={<LayoutTemplate size={18} />} title={t('org:templates.empty')} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
            {templates.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} onUse={() => setUsing(tpl)} />
            ))}
          </div>
        )}
      </div>
      <InstantiateModal template={using} onClose={() => setUsing(null)} />
    </div>
  )
}

function TemplateCard({ template: tpl, onUse }: { template: TeamTemplate; onUse: () => void }) {
  const { t } = useTranslation()
  const meta = KIND_META[tpl.kind]
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="h-[3px]" style={{ background: tpl.color }} />
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${tpl.color}22`, color: tpl.color }}>
          <meta.icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-zinc-100">{tpl.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span style={{ color: tpl.color }}>{meta.label}</span>
            <span className="text-zinc-700">·</span>
            {tpl.unitCount > 1 && (
              <>
                <span>{t('org:counts.units', { count: tpl.unitCount })}</span>
                <span className="text-zinc-700">·</span>
              </>
            )}
            <span>{t('org:counts.agents', { count: tpl.agentCount })}</span>
          </div>
        </div>
      </div>
      <p className="px-4 text-[12px] leading-relaxed text-zinc-400">{tpl.description}</p>
      <div className="mx-4 mt-3 max-h-[220px] overflow-y-auto rounded-md border border-line-soft bg-black/20 px-3 py-2">
        <PreviewNode node={tpl.tree} depth={0} />
      </div>
      <div className="mt-auto flex justify-end px-4 py-3">
        <button className="btn-primary" onClick={onUse}>
          <Wand2 size={13} /> {t('actions.create')}
        </button>
      </div>
    </div>
  )
}

function PreviewNode({ node, depth }: { node: TemplateNodePreview; depth: number }) {
  const Icon = KIND_META[node.kind].icon
  return (
    <div className={depth ? 'mt-1.5 border-l border-line pl-3' : ''}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-300">
        <Icon size={11} className="text-zinc-500" /> {node.name}
      </div>
      {node.agents.length > 0 && (
        <div className="mt-0.5 space-y-px pl-[17px]">
          {node.agents.map((a) => (
            <div key={a.name} className="flex items-center gap-1.5 text-[11px]">
              <span className={a.lead ? 'text-zinc-200' : 'text-zinc-400'}>{a.name}</span>
              {a.lead && <Star size={9} className="fill-amber-300 text-amber-300" />}
              <span className="truncate text-zinc-600">{a.role}</span>
            </div>
          ))}
        </div>
      )}
      {node.children.map((c) => (
        <PreviewNode key={c.name} node={c} depth={depth + 1} />
      ))}
    </div>
  )
}

function InstantiateModal({ template, onClose }: { template: TeamTemplate | null; onClose: () => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const toast = useAppStore((s) => s.toast)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const showOrg = useAppStore((s) => s.showOrg)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)
  const options = useMemo(() => flattenTree(units), [units])

  useEffect(() => {
    if (!template) return
    setName(template.name)
    setParentId(rootUnit(useAppStore.getState().units)?.id ?? '')
    setBusy(false)
  }, [template])

  const submit = async (): Promise<void> => {
    if (!template || busy) return
    setBusy(true)
    try {
      const r = await call('templates:instantiate', template.id, { parentId: parentId || null, name: name.trim() || template.name })
      toast('success', t('org:templates.instantiated', { name: name.trim() || template.name, agents: t('org:templates.newAgents', { count: r.agentIds.length }) }))
      selectUnit(r.unitId)
      showOrg('teams')
      onClose()
    } catch (e) {
      toast('error', apiError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!template}
      onClose={onClose}
      width={480}
      title={template ? t('org:templates.modalTitle', { name: template.name }) : ''}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>
            <Wand2 size={13} /> {busy ? t('org:templates.creating') : t('actions.create')}
          </button>
        </>
      }
    >
      {template && (
        <div className="space-y-4" onKeyDown={(e) => e.key === 'Enter' && void submit()}>
          <Field label={t('org:templates.name')}>
            <input autoFocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.name} />
          </Field>
          <Field label={t('org:templates.parent')}>
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {options.map(({ unit, depth }) => (
                <option key={unit.id} value={unit.id}>
                  {indentLabel(unit.name, depth)}
                </option>
              ))}
            </select>
          </Field>
          <div className="rounded-md border border-line bg-surface-2/60 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-400">
            <Trans
              i18nKey={template.unitCount > 1 ? 'org:templates.summaryWithUnits' : 'org:templates.summary'}
              values={{
                units: t('org:counts.units', { count: template.unitCount }),
                agents: t('org:templates.newAgents', { count: template.agentCount })
              }}
              components={{ b: <span className="text-zinc-200" /> }}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
