import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Brain, Cpu, Database, FolderOpen, Gauge, Plus, Shield, SlidersHorizontal, Trash2, Users, X, Zap } from 'lucide-react'
import type { AccessLevel } from '@shared/types'
import { ENV_LABEL, KIND_LABEL, LEVEL_LABEL, LEVEL_ORDER } from '@shared/connections'
import { LANGUAGES, languageName, resolveLanguage, type I18nKey } from '@shared/i18n'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Segmented, Toggle } from '@/components/common/ui'
import { useLayer } from '@/components/common/Layer'
import { PERMISSIONS } from '@/features/agents/constants'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { shortPath } from '@/lib/org'
import { useAppStore, type SettingsSection } from '@/store/useAppStore'
import { KindIcon, ProviderForm } from './ProviderForm'
import { ModelSelect } from './ModelSelect'
import { DataSection } from './DataSection'
import { LimitsSection } from './LimitsSection'
import { isLocalUrl } from '@shared/endpoints'
import { Heading, Row } from './parts'
import { LearnMode, ProjectMemoryMode } from '@/features/memory/parts'

const SECTIONS: { id: SettingsSection; labelKey: I18nKey; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'agents', labelKey: 'settings:sections.agents', icon: Users },
  { id: 'permissions', labelKey: 'settings:sections.permissions', icon: Shield },
  { id: 'providers', labelKey: 'settings:sections.providers', icon: Cpu },
  { id: 'memory', labelKey: 'settings:sections.memory', icon: Brain },
  { id: 'data', labelKey: 'settings:sections.data', icon: Database },
  { id: 'limits', labelKey: 'settings:sections.limits', icon: Gauge },
  { id: 'general', labelKey: 'settings:sections.general', icon: SlidersHorizontal }
]

export function SettingsPanel() {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.settingsOpen)
  const section = useAppStore((s) => s.settingsSection)
  const openSettings = useAppStore((s) => s.openSettings)
  const close = useAppStore((s) => s.closeSettings)

  const ref = useRef<HTMLDivElement>(null)
  useLayer(open, close, ref, { trap: true })

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 animate-fade-in" onMouseDown={close}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings:title')}
        tabIndex={-1}
        className="flex h-full w-[min(980px,92vw)] border-l border-line bg-[#0e0e11] shadow-pop outline-none animate-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="w-[190px] shrink-0 border-r border-line p-3 pt-14">
          <div className="panel-title mb-2 px-2">{t('settings:title')}</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => openSettings(s.id)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
                section === s.id ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
              )}
            >
              <s.icon size={14} /> {t(s.labelKey)}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <button className="icon-btn absolute right-4 top-14 z-10" onClick={close} title={t('actions.close')} aria-label={t('actions.close')} data-testid="settings-close">
            <X size={15} />
          </button>
          <div className="px-8 pb-10 pt-14">
            {section === 'agents' && <AgentsSection />}
            {section === 'permissions' && <PermissionsSection />}
            {section === 'providers' && <ProvidersSection />}
            {section === 'memory' && <MemorySection />}
            {section === 'data' && <DataSection />}
            {section === 'limits' && <LimitsSection />}
            {section === 'general' && <GeneralSection />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── agents ───────────────────────────── */

function AgentsSection() {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const openAgentProfile = useAppStore((s) => s.openAgentProfile)
  return (
    <>
      <Heading title={t('settings:agents.title')} desc={t('settings:agents.desc')} />
      <div className="card flex flex-wrap items-center gap-5 p-5">
        <div className="flex -space-x-1.5">
          {agents.slice(0, 6).map((a) => (
            <PixelAvatar key={a.id} agent={a} size={30} className="rounded-md ring-2 ring-surface" />
          ))}
        </div>
        <div className="min-w-[12rem] flex-1">
          <div className="text-[13px] text-zinc-200">{t('settings:agents.count', { count: agents.length })}</div>
          <div className="text-[12px] text-zinc-400">{t('settings:agents.manage')}</div>
        </div>
        <button className="btn-primary" onClick={() => openAgentProfile()}>
          <Users size={14} /> {t('settings:agents.openInOrg')}
        </button>
      </div>
    </>
  )
}

/* ───────────────────────────── permissions ───────────────────────────── */

const PERM_COLS = PERMISSIONS

function PermissionsSection() {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const permissions = useAppStore((s) => s.permissions)
  const workspace = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.rootPath ?? '')
  const [pathAgent, setPathAgent] = useState<string | null>(null)

  return (
    <>
      <Heading title={t('settings:permissions.title')} desc={t('settings:permissions.desc')} />
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-white/[0.02]">
              <th className="px-4 py-2.5 text-left font-medium text-zinc-400">{t('settings:permissions.colAgent')}</th>
              {PERM_COLS.map((c) => (
                <th key={c.key} className="px-2 py-2.5 text-center font-medium text-zinc-400">
                  <div>{c.label}</div>
                  <div className="text-[11px] font-normal text-zinc-400">{c.hint}</div>
                </th>
              ))}
              <th className="px-3 py-2.5 text-center font-medium text-zinc-400">{t('settings:permissions.colPaths')}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const p = permissions.find((x) => x.agentId === a.id)
              if (!p) return null
              return (
                <tr key={a.id} className="border-b border-line-soft last:border-0 hover:bg-white/[0.015]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <PixelAvatar agent={a} size={22} />
                      <div>
                        <div className="text-zinc-200">{a.name}</div>
                        <div className="text-[12px] text-zinc-400">{a.role}</div>
                      </div>
                    </div>
                  </td>
                  {PERM_COLS.map((c) => (
                    <td key={c.key} className="px-2 py-2.5 text-center">
                      <div className="flex justify-center">
                        <Toggle size="sm" checked={p[c.key]} onChange={(v) => void call('permissions:update', a.id, { [c.key]: v })} />
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-center">
                    <button className={cn('btn-ghost h-6 text-[12px]', pathAgent === a.id && 'bg-white/5 text-zinc-200')} onClick={() => setPathAgent(pathAgent === a.id ? null : a.id)}>
                      <FolderOpen size={12} /> {p.allowedPaths.length}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pathAgent && <PathEditor agentId={pathAgent} />}

      <div className="mt-5 rounded-md border border-line bg-surface px-4 py-3 text-[12px] leading-relaxed text-zinc-400">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
          <Zap size={13} className="text-amber-300" /> {t('settings:permissions.howTitle')}
        </div>
        <Trans
          i18nKey="settings:permissions.how"
          values={{ workspace: workspace || t('settings:permissions.noWorkspace') }}
          components={{ code: <code className="rounded bg-white/5 px-1 text-zinc-400" /> }}
        />
      </div>
      <ConnectionMatrix />
    </>
  )
}

/** Agent × connection access levels (deny-all by default). */
function ConnectionMatrix() {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const connections = useAppStore((s) => s.connections)
  const perms = useAppStore((s) => s.connPerms)
  const toast = useAppStore((s) => s.toast)
  const showOrg = useAppStore((s) => s.showOrg)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const level = (c: string, a: string): AccessLevel => perms.find((p) => p.connectionId === c && p.agentId === a)?.level ?? 'none'
  const set = async (c: string, a: string, l: AccessLevel): Promise<void> => {
    try {
      await call('connections:setPermission', c, a, l)
      await useAppStore.getState().refresh('connections')
    } catch (e) {
      toast('error', apiError(e))
    }
  }
  return (
    <div className="mt-8">
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <div className="text-[15px] font-semibold text-zinc-100">{t('settings:connections.title')}</div>
          <div className="text-[12px] text-zinc-400">{t('settings:connections.desc')}</div>
        </div>
        <button
          className="btn-outline h-7 shrink-0"
          onClick={() => {
            closeSettings()
            showOrg('connections')
          }}
        >
          {t('settings:connections.manage')}
        </button>
      </div>
      {connections.length === 0 ? (
        <div className="card px-4 py-5 text-center text-[13px] text-zinc-500">{t('settings:connections.empty')}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-white/[0.02]">
                <th className="px-3 py-2 text-left font-medium text-zinc-400">{t('settings:permissions.colAgent')}</th>
                {connections.map((c) => (
                  <th key={c.id} className="px-2 py-2 text-left font-medium text-zinc-400" title={`${KIND_LABEL[c.kind]} · ${ENV_LABEL[c.env]}`}>
                    <div className="max-w-[150px] truncate text-zinc-300">{c.name}</div>
                    <div className={cn('text-[12px] font-normal', c.env === 'production' ? 'text-rose-300' : 'text-zinc-500')}>{ENV_LABEL[c.env]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <PixelAvatar agent={a} size={18} />
                      <span className="text-zinc-200">{a.name}</span>
                    </span>
                  </td>
                  {connections.map((c) => {
                    const l = level(c.id, a.id)
                    return (
                      <td key={c.id} className="px-2 py-1.5">
                        <select
                          className={cn('input h-7 w-[150px] text-[13px]', l !== 'none' ? 'border-indigo-500/40 text-indigo-200' : 'text-zinc-500')}
                          value={l}
                          onChange={(e) => void set(c.id, a.id, e.target.value as AccessLevel)}
                        >
                          {LEVEL_ORDER.map((x) => (
                            <option key={x} value={x}>
                              {LEVEL_LABEL[x]}
                            </option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PathEditor({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const p = useAppStore((s) => s.permissions.find((x) => x.agentId === agentId))
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId))
  if (!p || !agent) return null
  const update = (paths: string[]): void => void call('permissions:update', agentId, { allowedPaths: paths })
  return (
    <div className="card mt-3 p-4 animate-fade-in">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] text-zinc-300">{t('settings:permissions.paths.title', { name: agent.name })}</div>
        <button
          className="btn-outline h-6 text-[12px]"
          onClick={async () => {
            const dir = await call('app:pickFolder')
            if (dir && !p.allowedPaths.includes(dir)) update([...p.allowedPaths, dir])
          }}
        >
          <Plus size={12} /> {t('settings:permissions.paths.add')}
        </button>
      </div>
      {p.allowedPaths.length === 0 && <div className="text-[13px] text-zinc-400">{t('settings:permissions.paths.workspaceOnly')}</div>}
      {p.allowedPaths.map((path) => (
        <div key={path} className="flex items-center gap-2 border-t border-line-soft py-1.5 font-mono text-[12px] text-zinc-400">
          <FolderOpen size={12} className="text-zinc-400" /> <span className="flex-1 truncate">{path}</span>
          <button className="icon-btn" onClick={() => update(p.allowedPaths.filter((x) => x !== path))} title={t('actions.remove')} aria-label={t('actions.remove')}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ───────────────────────────── providers ───────────────────────────── */

function ProvidersSection() {
  const { t } = useTranslation()
  const providers = useAppStore((s) => s.providers)
  const toast = useAppStore((s) => s.toast)
  const [adding, setAdding] = useState(providers.length === 0)
  const [testing, setTesting] = useState<string | null>(null)

  return (
    <>
      <Heading
        title={t('settings:providers.title')}
        desc={t('settings:providers.desc')}
        action={
          !adding && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> {t('settings:providers.add')}
            </button>
          )
        }
      />
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 px-4 py-3">
            <KindIcon kind={p.kind} size={18} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-[13px] font-medium text-zinc-100">{p.label}</span>
                {p.isDefault && <span className="rounded bg-indigo-500/15 px-1.5 text-[12px] font-medium text-indigo-300">{t('settings:providers.default')}</span>}
              </div>
              <div className="font-mono text-[11px] text-zinc-400">
                {p.model || t('settings:providers.defaultModel')}
                {(p.kind === 'anthropic' || p.kind === 'openai') && !(p.baseUrl && isLocalUrl(p.baseUrl)) ? ' · ' + (p.hasKey ? t('settings:providers.keySet') : t('settings:providers.keyMissing')) : ''}
                {p.cliPath ? ` · ${p.cliPath}` : ''}
                {p.baseUrl ? ` · ${p.baseUrl}` : ''}
              </div>
              {p.kind !== 'mock' && (
                <div className="mt-2 max-w-[460px]">
                  <ModelSelect
                    key={p.id}
                    kind={p.kind}
                    providerId={p.id}
                    baseUrl={p.baseUrl || undefined}
                    value={p.model}
                    onChange={(model) =>
                      void call('providers:save', { kind: p.kind, model }, p.id)
                        .then(() => toast('success', t('settings:providers.modelSaved', { model: model || t('settings:providers.defaultModel') })))
                        .catch((e) => toast('error', apiError(e)))
                    }
                    testId={`provider-row-model-${p.kind}`}
                  />
                </div>
              )}
            </div>
            <button
              className="btn-outline h-7"
              disabled={testing === p.id}
              onClick={async () => {
                setTesting(p.id)
                const r = await call('providers:test', p.id)
                setTesting(null)
                toast(r.ok ? 'success' : 'error', r.message)
              }}
            >
              {testing === p.id ? t('settings:providers.testing') : t('actions.test')}
            </button>
            {!p.isDefault && (
              <button className="btn-ghost h-7" onClick={() => void call('providers:save', { kind: p.kind, isDefault: true }, p.id)}>
                {t('settings:providers.makeDefault')}
              </button>
            )}
            <button className="icon-btn h-7 w-7 hover:text-rose-400" onClick={() => void call('providers:delete', p.id)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {providers.length === 0 && !adding && <div className="text-[13px] text-zinc-400">{t('settings:providers.empty')}</div>}
      </div>
      {adding && (
        <div className="card mt-5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[13px] font-medium text-zinc-200">{t('settings:providers.newTitle')}</div>
            {providers.length > 0 && (
              <button className="icon-btn" onClick={() => setAdding(false)} title={t('actions.close')} aria-label={t('actions.close')}>
                <X size={14} />
              </button>
            )}
          </div>
          <ProviderForm
            onSaved={(p) => {
              toast('success', t('settings:providers.added', { label: p.label }))
              setAdding(false)
            }}
          />
        </div>
      )}
    </>
  )
}

/* ───────────────────────────── memory ───────────────────────────── */

/** Semantic memory: which OpenAI-compatible provider embeds memories (off by default), and how far indexing got. */
function SemanticCard() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const providers = useAppStore((s) => s.providers)
  const version = useAppStore((s) => s.memoryVersion)
  const toast = useAppStore((s) => s.toast)
  const usable = useMemo(() => providers.filter((p) => p.kind === 'openai'), [providers])
  const [model, setModel] = useState(settings.memoryEmbedModel)
  const [status, setStatus] = useState<{ enabled: boolean; indexed: number; total: number; error: string } | null>(null)
  useEffect(() => setModel(settings.memoryEmbedModel), [settings.memoryEmbedModel])
  useEffect(() => {
    void call('memory:vectorStatus').then(setStatus)
  }, [version, settings.memoryEmbedProviderId, settings.memoryEmbedModel])
  const update = (patch: Partial<typeof settings>): void => {
    call('settings:update', patch).catch((e) => toast('error', apiError(e)))
  }
  const local = usable.find((p) => p.id === settings.memoryEmbedProviderId)
  return (
    <div className="card mb-5 p-4">
      <div className="text-[13px] font-semibold text-zinc-100">{t('settings:memory.semantic.title')}</div>
      <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{t('settings:memory.semantic.desc')}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          data-testid="memory-embed-provider"
          className="input h-7 w-56 text-[13px]"
          value={settings.memoryEmbedProviderId}
          onChange={(e) => update({ memoryEmbedProviderId: e.target.value })}
        >
          <option value="">{t('settings:memory.semantic.off')}</option>
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className="input h-7 w-64 text-[13px]"
          disabled={!settings.memoryEmbedProviderId}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => model.trim() !== settings.memoryEmbedModel && update({ memoryEmbedModel: model.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder={t('settings:memory.semantic.modelHint')}
        />
      </div>
      {!usable.length && <div className="mt-2 text-[12px] text-zinc-500">{t('settings:memory.semantic.noProvider')}</div>}
      {local && <div className="mt-2 text-[12px] text-zinc-500">{t(isLocalUrl(local.baseUrl) ? 'settings:memory.semantic.stays' : 'settings:memory.semantic.leaves')}</div>}
      {status?.enabled && (
        <div className={cn('mt-2 text-[12px]', status.error ? 'text-amber-300' : 'text-emerald-400')}>
          {status.error ? t('settings:memory.semantic.error', { error: status.error }) : t('settings:memory.semantic.status', { indexed: status.indexed, total: status.total })}
        </div>
      )}
    </div>
  )
}

/** Memory settings: semantic search and learning; the memories themselves live in Organization → Memory. */
function MemorySection() {
  const { t } = useTranslation()
  const showOrg = useAppStore((s) => s.showOrg)
  const closeSettings = useAppStore((s) => s.closeSettings)
  return (
    <>
      <Heading
        title={t('settings:memory.title')}
        desc={t('settings:memory.desc')}
        action={
          <button
            data-testid="memory-open"
            className="btn-outline shrink-0"
            onClick={() => {
              closeSettings()
              showOrg('memory')
            }}
          >
            <Brain size={13} /> {t('settings:memory.open')}
          </button>
        }
      />
      <SemanticCard />
      <div className="card mb-5 p-4">
        <div className="text-[13px] font-semibold text-zinc-100">{t('org:memory.learn.title')}</div>
        <div className="mb-3 mt-0.5 text-[12px] leading-relaxed text-zinc-400">{t('org:memory.learn.desc')}</div>
        <LearnMode />
      </div>
      <div className="card mb-5 p-4">
        <div className="text-[13px] font-semibold text-zinc-100">{t('org:memory.projectNotes.title')}</div>
        <div className="mb-3 mt-0.5 text-[12px] leading-relaxed text-zinc-400">{t('org:memory.projectNotes.desc')}</div>
        <ProjectMemoryMode />
      </div>
    </>
  )
}

/* ───────────────────────────── general ───────────────────────────── */

function GeneralSection() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const [info, setInfo] = useState<{ version: string; dbPath: string; platform: string } | null>(null)
  useEffect(() => {
    void call('app:info').then(setInfo)
  }, [])
  const toast = useAppStore((s) => s.toast)
  const update = (patch: Partial<typeof settings>): void => {
    call('settings:update', patch).catch((e) => toast('error', apiError(e)))
  }

  return (
    <>
      <Heading title={t('settings:general.title')} desc={t('settings:general.desc')} />
      <div className="card divide-y divide-line">
        <Row title={t('language.label')} desc={t('language.hint')}>
          <select
            data-testid="settings-language"
            className="input h-7 w-48 text-[13px]"
            value={settings.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            <option value="auto">{t('language.auto', { name: languageName(resolveLanguage('auto', navigator.language)) })}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
        <Row title={t('settings:general.folders.title')} desc={t('settings:general.folders.desc')}>
          <div className="flex items-center gap-2">
            <span className="max-w-[220px] truncate font-mono text-[11px] text-zinc-400" title={project?.rootPath}>
              {project ? (project.rootPath ? shortPath(project.rootPath, 34) : t('settings:general.folders.none')) : '—'}
            </span>
            <button
              className="btn-outline h-7"
              disabled={!project}
              onClick={() => {
                closeSettings()
                openProjectModal(project?.id ?? null)
              }}
            >
              <FolderOpen size={13} /> {t('settings:general.folders.open')}
            </button>
          </div>
        </Row>
        <Row title={t('settings:general.startup.title')} desc={t('settings:general.startup.desc')}>
          <Segmented<'ask' | 'restore'>
            value={settings.startupProjects}
            onChange={(v) => update({ startupProjects: v })}
            options={[
              { value: 'ask', label: t('settings:general.startup.ask') },
              { value: 'restore', label: t('settings:general.startup.restore') }
            ]}
          />
        </Row>
        <Row title={t('settings:general.autopilot.title')} desc={t('settings:general.autopilot.desc')}>
          <Toggle checked={settings.autopilot} onChange={(v) => update({ autopilot: v })} />
        </Row>
        <Row title={t('settings:general.review.title')} desc={t('settings:general.review.desc')}>
          <Toggle checked={settings.reviewByLead} onChange={(v) => update({ reviewByLead: v })} />
        </Row>
        <Row title={t('settings:general.notifications.title')} desc={t('settings:general.notifications.desc')}>
          <Toggle checked={settings.notifications} onChange={(v) => update({ notifications: v })} />
        </Row>
        <Row title={t('settings:general.race.title')} desc={t('settings:general.race.desc')}>
          <Toggle checked={settings.raceMode} onChange={(v) => update({ raceMode: v })} />
        </Row>
        <Row title={t('settings:general.twins.title')} desc={t('settings:general.twins.desc')}>
          <Toggle checked={settings.shareWithTwins} onChange={(v) => update({ shareWithTwins: v })} />
        </Row>
        <Row title={t('settings:general.wizard.title')} desc={t('settings:general.wizard.desc')}>
          <button className="btn-outline h-7" onClick={() => update({ onboarded: false })}>
            {t('settings:general.wizard.restart')}
          </button>
        </Row>
      </div>
      {info && (
        <div className="mt-4 space-y-1 font-mono text-[11px] text-zinc-400">
          <div>Agentbits v{info.version} · {info.platform}</div>
          <div className="selectable">DB: {info.dbPath}</div>
        </div>
      )}
    </>
  )
}
