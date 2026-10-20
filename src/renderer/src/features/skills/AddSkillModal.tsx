import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, Github, Loader2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SkillPreview, SkillSourceInput } from '@shared/skills'
import { Modal, Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, formatBytes } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

type Tab = 'github' | 'computer' | 'write'

/**
 * Install skills: read a source (GitHub / folder / .zip / .md) → pick from the skills found (with warnings and the
 * SKILL.md visible) → install. Or write a new SKILL.md. Nothing is installed before the user confirms.
 */
export function AddSkillModal({ open, onClose, onInstalled }: { open: boolean; onClose: () => void; onInstalled: (ids: string[]) => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [tab, setTab] = useState<Tab>('github')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState(() => t('skills:modal.writeTemplate'))
  const [dragOver, setDragOver] = useState(false)

  const reset = (): void => {
    setPreview(null)
    setError(null)
    setPicked(new Set())
    setExpanded(null)
  }
  const close = (): void => {
    reset()
    setUrl('')
    onClose()
  }

  const read = async (source: SkillSourceInput): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const p = await call('skills:preview', source)
      setPreview(p)
      setPicked(new Set(p.candidates.length <= 12 ? p.candidates.map((c) => c.key) : []))
      if (p.candidates.length === 1) setExpanded(p.candidates[0].key)
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = async (kind: 'folder' | 'file'): Promise<void> => {
    const path = await call('skills:pickSource', kind)
    if (path) await read({ type: 'path', path })
  }
  const install = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    try {
      const skills = await call('skills:install', preview.stagingId, [...picked])
      toast('success', t('skills:modal.installed', { count: skills.length }))
      reset()
      setUrl('')
      onInstalled(skills.map((s) => s.id))
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const s = await call('skills:saveMd', draft)
      setDraft(t('skills:modal.writeTemplate'))
      onInstalled([s.id])
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const footer = preview ? (
    <>
      <button className="btn-ghost mr-auto" onClick={reset}>
        {t('skills:modal.back')}
      </button>
      <button className="btn-primary" disabled={busy || picked.size === 0} onClick={() => void install()} data-testid="skills-install">
        {busy && <Loader2 size={13} className="animate-spin" />}
        {t('skills:modal.install', { count: picked.size })}
      </button>
    </>
  ) : tab === 'write' ? (
    <button className="btn-primary" disabled={busy} onClick={() => void create()} data-testid="skills-create">
      {t('skills:modal.create')}
    </button>
  ) : undefined

  return (
    <Modal open={open} onClose={close} width={760} title={t('skills:modal.title')} footer={footer}>
      <div data-testid="skills-modal">
        {!preview && (
          <>
            <div className="mb-4">
              <Segmented
                value={tab}
                onChange={(v) => {
                  setTab(v)
                  setError(null)
                }}
                options={(['github', 'computer', 'write'] as Tab[]).map((v) => ({ value: v, label: t(`skills:modal.tabs.${v}`) }))}
              />
            </div>
            {tab === 'github' && (
              <div>
                <label className="label">{t('skills:modal.githubLabel')}</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 font-mono text-[13px]"
                    value={url}
                    placeholder={t('skills:modal.githubPlaceholder')}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && url.trim() && void read({ type: 'github', url })}
                    autoFocus
                    data-testid="skills-github-url"
                  />
                  <button className="btn-primary" disabled={busy || !url.trim()} onClick={() => void read({ type: 'github', url })} data-testid="skills-github-read">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Github size={13} />} {busy ? t('skills:modal.reading') : t('skills:modal.read')}
                  </button>
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">{t('skills:modal.githubHint')}</p>
                <GithubTokenRow />
              </div>
            )}
            {tab === 'computer' && (
              <div
                className={cn('rounded-lg border border-dashed px-6 py-8 text-center transition-colors', dragOver ? 'border-indigo-400 bg-indigo-500/[0.06]' : 'border-line')}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOver(false)
                  const f = e.dataTransfer.files[0]
                  const path = f ? window.agentbits.pathForFile(f) : ''
                  if (path) void read({ type: 'path', path })
                }}
              >
                <Upload size={20} className="mx-auto mb-2 text-zinc-500" />
                <div className="text-[13px] text-zinc-300">{t('skills:modal.drop')}</div>
                <p className="mx-auto mt-1 max-w-[480px] text-[12px] leading-snug text-zinc-500">{t('skills:modal.computerHint')}</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button className="btn-outline" disabled={busy} onClick={() => void pick('folder')}>
                    <FolderOpen size={13} /> {t('skills:modal.pickFolder')}
                  </button>
                  <button className="btn-outline" disabled={busy} onClick={() => void pick('file')}>
                    <Upload size={13} /> {t('skills:modal.pickFile')}
                  </button>
                </div>
                {busy && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-zinc-400">
                    <Loader2 size={12} className="animate-spin" /> {t('skills:modal.reading')}
                  </div>
                )}
              </div>
            )}
            {tab === 'write' && (
              <div>
                <p className="mb-2 text-[12px] text-zinc-400">{t('skills:modal.writeHint')}</p>
                <textarea
                  className="input h-[360px] w-full resize-none font-mono text-[13px] leading-relaxed"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  data-testid="skills-write"
                />
              </div>
            )}
          </>
        )}

        {preview && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-[13px] text-zinc-300">
              <span className="flex-1 truncate">{t('skills:modal.found', { count: preview.candidates.length, source: preview.sourceLabel })}</span>
              {preview.candidates.length > 1 && (
                <>
                  <button className="btn-ghost h-7" onClick={() => setPicked(new Set(preview.candidates.map((c) => c.key)))}>
                    {t('skills:modal.selectAll')}
                  </button>
                  <button className="btn-ghost h-7" onClick={() => setPicked(new Set())}>
                    {t('skills:modal.selectNone')}
                  </button>
                </>
              )}
            </div>
            <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {preview.candidates.map((c) => {
                const on = picked.has(c.key)
                const open = expanded === c.key
                return (
                  <li key={c.key} className={cn('rounded-lg border', on ? 'border-indigo-500/40 bg-indigo-500/[0.04]' : 'border-line')} data-testid={`skills-candidate-${c.name}`}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={() => {
                          const next = new Set(picked)
                          if (on) next.delete(c.key)
                          else next.add(c.key)
                          setPicked(next)
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] text-zinc-100">{c.name}</span>
                          {c.existingId && <span className="rounded bg-sky-500/15 px-1 text-[12px] text-sky-300">{t('skills:modal.existing')}</span>}
                          {c.hasScripts && <span className="rounded bg-sky-500/15 px-1 text-[12px] uppercase text-sky-300">{t('skills:badges.scripts')}</span>}
                          {c.hasBinaries && <span className="rounded bg-rose-500/15 px-1 text-[12px] text-rose-300">{t('skills:modal.binaries')}</span>}
                          <span className="text-[11px] text-zinc-500">
                            {t('skills:modal.sizeLine', { files: t('skills:modal.files', { count: c.fileCount }), size: formatBytes(c.size) })}
                            {c.subpath ? ` · ${c.subpath}` : ''}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[12px] leading-snug text-zinc-400">{c.description || t('skills:modal.noDescription')}</div>
                        {c.notes.map((n) => (
                          <div key={n} className="mt-1 text-[12px] text-zinc-500">
                            • {n}
                          </div>
                        ))}
                        {c.suspicious.length > 0 && (
                          <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5 text-[12px] text-amber-200">
                            <div className="mb-0.5 flex items-center gap-1 font-medium">
                              <AlertTriangle size={11} /> {t('skills:modal.suspicious')}
                            </div>
                            {c.suspicious.map((l) => (
                              <div key={l} className="truncate font-mono text-amber-100/80">
                                {l}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                    <button
                      className="flex w-full items-center gap-1 border-t border-line-soft px-3 py-1.5 text-left text-[12px] text-zinc-400 hover:text-zinc-200"
                      onClick={() => setExpanded(open ? null : c.key)}
                    >
                      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {open ? t('skills:modal.hideMd') : t('skills:modal.showMd')}
                    </button>
                    {open && (
                      <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words border-t border-line-soft px-3 py-2 font-mono text-[12px] text-zinc-300">
                        {c.skillMdPreview}
                      </pre>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[13px] text-rose-200">{error}</div>}
      </div>
    </Modal>
  )
}

/** Private repositories: a GitHub token kept in the OS keychain; only "stored or not" comes back from main. */
function GithubTokenRow() {
  const { t } = useTranslation()
  const [has, setHas] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void call('skills:githubToken').then(setHas, () => setHas(false))
  }, [])
  const save = async (value: string): Promise<void> => {
    setError(null)
    try {
      setHas(await call('skills:setGithubToken', value))
      setToken('')
      setOpen(false)
    } catch (e) {
      setError(apiError(e))
    }
  }
  return (
    <div className="mt-2 rounded-md border border-line bg-surface-2/60 px-2.5 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-zinc-300">{t('skills:modal.token.title')}</span>
        <span className={has ? 'text-emerald-300' : 'text-zinc-400'}>{has ? t('skills:modal.token.stored') : t('skills:modal.token.none')}</span>
        <div className="ml-auto flex gap-1">
          {has && (
            <button className="btn-ghost h-6 text-[12px]" onClick={() => void save('')}>
              {t('skills:modal.token.remove')}
            </button>
          )}
          <button className="btn-outline h-6 text-[12px]" onClick={() => setOpen((v) => !v)}>
            {has ? t('skills:modal.token.replace') : t('skills:modal.token.add')}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            className="input h-7 flex-1 font-mono text-[13px]"
            placeholder="github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && void save(token)}
            autoFocus
          />
          <button className="btn-primary h-7 text-[12px]" disabled={!token.trim()} onClick={() => void save(token)}>
            {t('actions.save')}
          </button>
        </div>
      )}
      {error && <div className="mt-1 text-rose-300">{error}</div>}
      <div className="mt-1 text-zinc-400">{t('skills:modal.token.hint')}</div>
    </div>
  )
}
