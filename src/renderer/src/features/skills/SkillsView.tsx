import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, FileCode2, FileText, Github, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { I18nKey } from '@shared/i18n'
import type { Skill, SkillDetail, SkillFileInfo } from '@shared/skills'
import { Empty, Modal, Toggle } from '@/components/common/ui'
import { locale } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn, formatBytes } from '@/lib/format'
import { Markdown } from '@/lib/markdown'
import { useAppStore } from '@/store/useAppStore'
import { rootUnit } from '@/features/org/meta'
import { AddSkillModal } from './AddSkillModal'

/** Organization → Skills: installed instruction packages, their files and who may use them. */
export function SkillsView() {
  const { t } = useTranslation()
  const skills = useAppStore((s) => s.skills)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    const k = q.trim().toLocaleLowerCase(locale())
    return k ? skills.filter((s) => `${s.name} ${s.description}`.toLocaleLowerCase(locale()).includes(k)) : skills
  }, [skills, q])
  const selected = skills.find((s) => s.id === selectedId) ?? filtered[0] ?? null

  return (
    <div className="flex h-full min-h-0" data-testid="skills-view">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-line">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-indigo-300" />
            <div className="flex-1 text-[13.5px] font-semibold text-zinc-100">{t('skills:title')}</div>
            <button className="btn-primary h-7" onClick={() => setAdding(true)} data-testid="skills-add">
              <Plus size={13} /> {t('skills:add')}
            </button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-zinc-400">{t('skills:intro')}</p>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input pl-8" placeholder={t('skills:search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              data-testid={`skill-item-${s.name}`}
              className={cn(
                'mb-1 block w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                selected?.id === s.id ? 'border-indigo-500/40 bg-indigo-500/[0.07]' : 'border-transparent hover:bg-surface-2'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn('truncate font-mono text-[12.5px]', s.enabled ? 'text-zinc-100' : 'text-zinc-500 line-through')}>{s.name}</span>
                {s.hasScripts && <Tag tone="sky">{t('skills:badges.scripts')}</Tag>}
                {s.warnings.length > (s.hasScripts ? 1 : 0) && <Tag tone="amber">{t('skills:badges.warnings')}</Tag>}
                {!s.enabled && <Tag>{t('skills:badges.disabled')}</Tag>}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-zinc-400">{s.description}</div>
              <div className="mt-1 text-[10.5px] text-zinc-500">
                {s.assignments.length ? t('skills:badges.assigned', { count: s.assignments.length }) : t('skills:badges.notAssigned')}
              </div>
            </button>
          ))}
          {skills.length > 0 && filtered.length === 0 && <div className="p-3 text-[12px] text-zinc-500">{t('skills:noneMatch')}</div>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {skills.length === 0 ? (
          <Empty
            icon={<BookOpen size={18} />}
            title={t('skills:empty.title')}
            hint={t('skills:empty.hint')}
            action={
              <button className="btn-primary" onClick={() => setAdding(true)}>
                <Plus size={13} /> {t('skills:add')}
              </button>
            }
          />
        ) : selected ? (
          <SkillPanel key={selected.id} skill={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <div className="p-8 text-[12.5px] text-zinc-500">{t('skills:selectHint')}</div>
        )}
      </main>
      <AddSkillModal
        open={adding}
        onClose={() => setAdding(false)}
        onInstalled={(ids) => {
          setAdding(false)
          if (ids[0]) setSelectedId(ids[0])
        }}
      />
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'sky' | 'amber' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[9.5px] font-medium uppercase tracking-wide',
        tone === 'sky' ? 'bg-sky-500/15 text-sky-300' : tone === 'amber' ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-700/50 text-zinc-400'
      )}
    >
      {children}
    </span>
  )
}

function SkillPanel({ skill, onDeleted }: { skill: Skill; onDeleted: () => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [openFile, setOpenFile] = useState<{ path: string; text: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'update' | null>(null)

  useEffect(() => {
    let off = false
    call('skills:get', skill.id)
      .then((d) => !off && setDetail(d))
      .catch((e) => toast('error', apiError(e)))
    return () => {
      off = true
    }
  }, [skill.id, skill.updatedAt, toast])

  const src = skill.source
  const sourceText = t(`skills:source.${src.type}` as I18nKey)
  const sourceWhere = src.type === 'github' ? `${src.location?.replace('https://github.com/', '')}${src.subpath ? '/' + src.subpath : ''}` : src.location

  const update = async (): Promise<void> => {
    setConfirm(null)
    setBusy(true)
    try {
      await call('skills:update', skill.id)
      toast('success', t('skills:detail.updated'))
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    try {
      await call('skills:delete', skill.id)
      toast('success', t('skills:detail.deleted'))
      onDeleted()
    } catch (e) {
      toast('error', apiError(e))
    }
  }
  const showFile = async (f: SkillFileInfo): Promise<void> => {
    if (!f.text) return setOpenFile({ path: f.path, text: t('skills:detail.binaryFile') })
    try {
      setOpenFile({ path: f.path, text: await call('skills:file', skill.id, f.path) })
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <div className="mx-auto max-w-[920px] space-y-4 px-8 py-6" data-testid="skill-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-indigo-300">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-mono text-[16px] font-semibold text-zinc-100">{skill.name}</h2>
            {skill.modified && <Tag>{t('skills:badges.modified')}</Tag>}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-300">{skill.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1">
              {src.type === 'github' ? <Github size={11} /> : <FileText size={11} />} {sourceText}
              {sourceWhere && (
                <span className="max-w-[420px] truncate font-mono text-zinc-400" title={sourceWhere}>
                  {' '}
                  {sourceWhere}
                </span>
              )}
            </span>
            <span>{t('skills:detail.files', { count: skill.fileCount, size: formatBytes(skill.size) })}</span>
            <span>{t('skills:detail.installed', { date: new Date(skill.installedAt).toLocaleDateString(locale()) })}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="mr-2 flex items-center gap-2 text-[12px] text-zinc-300" title={t('skills:detail.enabledHint')}>
            <Toggle checked={skill.enabled} onChange={(v) => void call('skills:setEnabled', skill.id, v).catch((e) => toast('error', apiError(e)))} />
            {t('skills:detail.enabled')}
          </label>
          <button className="btn-ghost h-7" onClick={() => setEditing(true)} disabled={!detail}>
            <Pencil size={12} /> {t('skills:detail.edit')}
          </button>
          {src.type !== 'created' && (
            <button className="btn-ghost h-7" onClick={() => setConfirm('update')} disabled={busy}>
              <RefreshCw size={12} className={cn(busy && 'animate-spin')} /> {t('skills:detail.update')}
            </button>
          )}
          <button className="icon-btn h-7 w-7 hover:text-rose-400" title={t('skills:detail.delete')} onClick={() => setConfirm('delete')}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {confirm && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3 text-[12.5px]',
            confirm === 'delete' ? 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200' : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-100'
          )}
        >
          <span className="flex-1">{confirm === 'delete' ? t('skills:detail.deleteConfirm', { name: skill.name }) : t('skills:detail.updateConfirm')}</span>
          <button className="btn-ghost h-7" onClick={() => setConfirm(null)}>
            {t('actions.cancel')}
          </button>
          {confirm === 'delete' ? (
            <button className="btn-danger h-7" onClick={() => void remove()} data-testid="skill-delete-confirm">
              {t('actions.yesDelete')}
            </button>
          ) : (
            <button className="btn-primary h-7" onClick={() => void update()} data-testid="skill-update-confirm">
              {t('skills:detail.update')}
            </button>
          )}
        </div>
      )}

      {skill.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-amber-200">
            <AlertTriangle size={13} /> {t('skills:detail.warningsTitle')}
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-amber-100/90">
            {skill.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <AssignCard skill={skill} />

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4">
        <section className="card min-w-0">
          <header className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-[12.5px] font-semibold text-zinc-200">
            <FileText size={13} className="text-zinc-400" />
            <span className="flex-1 truncate">{openFile ? openFile.path : t('skills:detail.instructions')}</span>
            {openFile && (
              <button className="icon-btn h-6 w-6" onClick={() => setOpenFile(null)}>
                <X size={12} />
              </button>
            )}
          </header>
          <div className="max-h-[560px] overflow-y-auto px-5 py-4">
            {openFile ? (
              /\.(md|markdown)$/i.test(openFile.path) ? (
                <Markdown text={openFile.text} />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-zinc-300">{openFile.text}</pre>
              )
            ) : detail ? (
              <Markdown text={detail.skillMd.replace(/^---\n[\s\S]*?\n---\n?/, '')} />
            ) : null}
          </div>
        </section>
        <section className="card self-start">
          <header className="border-b border-line-soft px-3 py-2.5 text-[12px] font-semibold text-zinc-300">{t('skills:detail.fileList')}</header>
          <ul className="max-h-[560px] overflow-y-auto p-1.5">
            {detail?.files.map((f) => (
              <li key={f.path}>
                <button
                  onClick={() => (f.path === 'SKILL.md' ? setOpenFile(null) : void showFile(f))}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-surface-2',
                    (openFile?.path ?? 'SKILL.md') === f.path ? 'text-indigo-200' : f.text ? 'text-zinc-300' : 'text-zinc-500'
                  )}
                  title={`${f.path} · ${formatBytes(f.size)}`}
                >
                  <FileCode2 size={11} className="shrink-0" />
                  <span className="truncate">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editing && detail && <EditSkillModal skill={skill} content={detail.skillMd} onClose={() => setEditing(false)} />}
    </div>
  )
}

function AssignCard({ skill }: { skill: Skill }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const toast = useAppStore((s) => s.toast)
  const root = rootUnit(units)
  const assigned = new Set(skill.assignments.map((a) => `${a.type}:${a.id}`))
  const label = (type: 'agent' | 'unit', id: string): string =>
    type === 'agent' ? (agents.find((a) => a.id === id)?.name ?? '?') : id === root?.id ? t('skills:assign.everyone', { name: root?.name ?? '' }) : (units.find((u) => u.id === id)?.name ?? '?')
  const set = (type: 'agent' | 'unit', id: string, on: boolean): void => {
    void call('skills:assign', skill.id, { type, id }, on).catch((e) => toast('error', apiError(e)))
  }
  return (
    <section className="card px-4 py-3.5" data-testid="skill-assign">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-zinc-100">{t('skills:assign.title')}</div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-400">{t('skills:assign.hint')}</p>
        </div>
        <select
          className="input h-8 w-[240px]"
          value=""
          data-testid="skill-assign-select"
          onChange={(e) => {
            const [type, id] = e.target.value.split(':') as ['agent' | 'unit', string]
            if (id) set(type, id, true)
          }}
        >
          <option value="">{t('skills:assign.add')}</option>
          <optgroup label={t('skills:assign.units')}>
            {units
              .filter((u) => !assigned.has(`unit:${u.id}`))
              .map((u) => (
                <option key={u.id} value={`unit:${u.id}`}>
                  {label('unit', u.id)}
                </option>
              ))}
          </optgroup>
          <optgroup label={t('skills:assign.agents')}>
            {agents
              .filter((a) => !assigned.has(`agent:${a.id}`))
              .map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {a.name}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {skill.assignments.length === 0 && <span className="text-[12px] text-zinc-500">{t('skills:assign.none')}</span>}
        {skill.assignments.map((a) => (
          <span key={`${a.type}:${a.id}`} className="flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-[11.5px] text-zinc-200">
            {label(a.type, a.id)}
            <button className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200" title={t('skills:assign.remove')} onClick={() => set(a.type, a.id, false)}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
    </section>
  )
}

function EditSkillModal({ skill, content, onClose }: { skill: Skill; content: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [text, setText] = useState(content)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    try {
      await call('skills:saveMd', text, skill.id)
      toast('success', t('skills:edit.saved'))
      onClose()
    } catch (e) {
      setError(apiError(e))
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      width={820}
      title={t('skills:edit.title', { name: skill.name })}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" onClick={() => void save()}>
            {t('skills:edit.save')}
          </button>
        </>
      }
    >
      {skill.source.type !== 'created' && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200">
          {t('skills:edit.warning', { source: t(`skills:source.${skill.source.type}` as I18nKey) })}
        </div>
      )}
      <textarea className="input h-[460px] w-full resize-none font-mono text-[12px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error && <div className="mt-2 whitespace-pre-wrap text-[12px] text-rose-300">{error}</div>}
    </Modal>
  )
}
