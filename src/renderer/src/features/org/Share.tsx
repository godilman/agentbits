import { useEffect, useMemo, useState } from 'react'
import { Download, FileUp, Link2, Package, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SharePreview } from '@shared/share'
import { Modal } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { Field } from '@/features/agents/parts'
import { PROVIDER_KINDS } from '@/features/settings/ProviderForm'
import { flattenTree, indentLabel, KIND_META, rootUnit } from './meta'

/** "Share" card: saves a unit (with everything under it) or an agent as a .agentbits file. */
export function ShareCard({ target }: { target: { type: 'unit' | 'agent'; id: string } }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await call('share:export', target)
      if (path) toast('success', t('org:share.export.done', { path }))
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white/[0.03] text-sky-300">
          <Package size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-zinc-100">{t('org:share.export.title')}</div>
          <div className="text-[12px] text-zinc-400">{t(target.type === 'unit' ? 'org:share.export.descUnit' : 'org:share.export.descAgent')}</div>
        </div>
        <button data-testid="share-export" className="btn-outline" disabled={busy} onClick={() => void save()}>
          <Download size={13} /> {t('org:share.export.action')}
        </button>
      </div>
    </section>
  )
}

const PERMS = ['fsRead', 'fsWrite', 'terminal', 'network', 'browser'] as const

/** Import a package: pick a file or paste a GitHub link → full preview → choose where it goes → import. */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const toast = useAppStore((s) => s.toast)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const showOrg = useAppStore((s) => s.showOrg)
  const options = useMemo(() => flattenTree(units), [units])
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<SharePreview | null>(null)
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setPreview(null)
    setBusy(false)
    setParentId(rootUnit(useAppStore.getState().units)?.id ?? '')
  }, [open])

  const load = async (source: { type: 'file' } | { type: 'url'; url: string }): Promise<void> => {
    setBusy(true)
    try {
      const p = await call('share:preview', source)
      if (p) setPreview(p)
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!preview || busy) return
    setBusy(true)
    try {
      const r = await call('share:import', preview.stagingId, parentId || null)
      toast('success', t('org:share.import.done', { name: preview.title, count: r.agentIds.length }))
      if (r.reusedSkills.length) toast('info', t('org:share.import.reused', { names: r.reusedSkills.join(', ') }))
      if (r.unitId) selectUnit(r.unitId)
      showOrg('teams')
      onClose()
    } catch (e) {
      toast('error', apiError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={720}
      title={preview ? t('org:share.import.previewTitle', { name: preview.title }) : t('org:share.import.title')}
      footer={
        preview && (
          <>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              {t('org:share.import.back')}
            </button>
            <button data-testid="share-import" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              <FileUp size={13} /> {t('org:share.import.action')}
            </button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-zinc-400">{t('org:share.import.intro')}</p>
          <button className="btn-outline w-full justify-center" disabled={busy} onClick={() => void load({ type: 'file' })}>
            <FileUp size={13} /> {t('org:share.import.pickFile')}
          </button>
          <Field label={t('org:share.import.urlLabel')}>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && void load({ type: 'url', url: url.trim() })}
                placeholder="https://github.com/…/team.agentbits"
              />
              <button className="btn-outline" disabled={busy || !url.trim()} onClick={() => void load({ type: 'url', url: url.trim() })}>
                <Link2 size={13} /> {t('actions.open')}
              </button>
            </div>
          </Field>
        </div>
      ) : (
        <div className="space-y-4 text-[12.5px]">
          <div className="text-[11.5px] text-zinc-500">
            {t('org:share.import.meta', { source: preview.sourceLabel, version: preview.appVersion || '?', date: preview.exportedAt.slice(0, 10) })}
          </div>
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-amber-200/90">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>{t('org:share.import.trust')}</span>
          </div>

          {preview.units.length > 0 && (
            <div>
              <div className="mb-1.5 font-semibold text-zinc-200">{t('org:share.import.units', { count: preview.units.length })}</div>
              <div className="space-y-1 rounded-md border border-line bg-surface-2/60 px-3 py-2">
                {preview.units.map((u) => {
                  const Icon = KIND_META[u.kind === 'organization' ? 'company' : u.kind].icon
                  let depth = 0
                  for (let p = u.parentRef; p; p = preview.units.find((x) => x.ref === p)?.parentRef ?? null) depth++
                  return (
                    <div key={u.ref} style={{ paddingLeft: depth * 16 }} className="flex items-start gap-2">
                      <Icon size={13} className="mt-0.5 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <span className="text-zinc-200">{u.name}</span>
                        {u.members.length > 0 && (
                          <span className="text-zinc-500"> — {u.members.map((m) => (m.title ? `${m.name} (${m.title})` : m.name)).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 font-semibold text-zinc-200">{t('org:share.import.agents', { count: preview.agents.length })}</div>
            <div className="space-y-2">
              {preview.agents.map((a) => (
                <details key={a.ref} className="rounded-md border border-line bg-surface-2/60 px-3 py-2" open={a.suspicious.length > 0}>
                  <summary className="cursor-pointer select-none">
                    <span className="text-zinc-100">{a.name}</span> <span className="text-zinc-500">· {a.role}</span>
                    {a.suspicious.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-amber-300">
                        <TriangleAlert size={12} /> {t('org:share.import.suspicious')}
                      </span>
                    )}
                  </summary>
                  <div className="mt-2 space-y-2 text-[12px] text-zinc-400">
                    {a.suspicious.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-5 text-amber-200/90">
                        {a.suspicious.map((s, i) => (
                          <li key={i} className="font-mono text-[11px]">
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.jobDescription && <Block label={t('org:share.import.jobDescription')} text={a.jobDescription} />}
                    {a.persona && <Block label={t('org:share.import.persona')} text={a.persona} />}
                    {a.skills.length > 0 && <div>{t('org:share.import.tags', { tags: a.skills.join(', ') })}</div>}
                    <div>
                      {a.provider
                        ? t('org:share.import.provider', {
                            suggested: `${PROVIDER_KINDS.find((k) => k.kind === a.provider!.kind)?.title ?? a.provider.kind}${a.provider.model ? ` · ${a.provider.model}` : ''}`,
                            mine: a.providerLabel || t('org:share.import.defaultProvider')
                          })
                        : t('org:share.import.providerDefault')}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PERMS.map((k) => (
                        <span
                          key={k}
                          className={cn('rounded px-1.5 py-0.5 text-[11px]', a.requested[k] ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-500/10 text-zinc-500 line-through')}
                        >
                          {t(`agents:perms.${k}.label`)}
                        </span>
                      ))}
                      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-300">{t('agents:perms.requireApproval.label')}</span>
                    </div>
                    {a.needs.length > 0 && <div className="text-amber-200/80">{t('org:share.import.needs', { names: a.needs.join(', ') })}</div>}
                  </div>
                </details>
              ))}
            </div>
          </div>

          {preview.skills.length > 0 && (
            <div>
              <div className="mb-1.5 font-semibold text-zinc-200">{t('org:share.import.skills', { count: preview.skills.length })}</div>
              <div className="space-y-1 rounded-md border border-line bg-surface-2/60 px-3 py-2">
                {preview.skills.map((s) => (
                  <div key={s.name} className="flex flex-wrap items-center gap-x-2">
                    <ScrollText size={12} className="text-zinc-500" />
                    <span className="text-zinc-200">{s.name}</span>
                    <span className="text-zinc-500">{t('org:share.import.files', { count: s.fileCount })}</span>
                    {s.existing && <span className="text-sky-300">{t('org:share.import.skillExists')}</span>}
                    {s.hasScripts && <span className="text-amber-300">{t('org:share.import.scripts')}</span>}
                    {s.suspicious.length > 0 && <span className="text-amber-300">{t('org:share.import.suspicious')}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Field label={t('org:share.import.parent')}>
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {options.map(({ unit, depth }) => (
                <option key={unit.id} value={unit.id}>
                  {indentLabel(unit.name, depth)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-line-soft bg-black/20 px-2 py-1.5 text-zinc-300">{text}</div>
    </div>
  )
}
