import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Blocks, ChevronDown, ClipboardPaste, Globe, LogIn, LogOut, Plus, RefreshCw, Terminal, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResize } from '@/components/common/Resize'
import type { I18nKey } from '@shared/i18n'
import { defaultPolicy, policyOf, type AppImportCandidate, type AppServer, type AppServerInput, type AppTransport, type ToolPolicy } from '@shared/apps'
import { Empty, Modal, Segmented, Toggle } from '@/components/common/ui'
import { locale, t as tr } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { AuditList } from '@/features/connections/AuditList'

/** Organization → Apps: MCP servers the user connects, their tools' policies and which agents may use them. */
export function AppsView() {
  const { t } = useTranslation()
  const [listWidth, listHandle] = useResize('appsList', 340, { min: 240, max: 640 })
  const apps = useAppStore((s) => s.apps)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<AppTransport | null>(null)
  const [importing, setImporting] = useState<'json' | 'claude-desktop' | null>(null)
  const selected = apps.find((a) => a.id === selectedId) ?? apps[0] ?? null

  const addMenu = (
    <AddMenu
      onPick={(k) => {
        if (k === 'local') setCreating('stdio')
        else if (k === 'remote') setCreating('http')
        else setImporting(k === 'json' ? 'json' : 'claude-desktop')
      }}
    />
  )

  return (
    <div className="flex h-full min-h-0" data-testid="apps-view">
      <aside style={{ width: listWidth }} className="flex shrink-0 flex-col border-r border-line">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center gap-2">
            <Blocks size={15} className="text-indigo-300" />
            <div className="flex-1 text-[13.5px] font-semibold text-zinc-100">{t('apps:title')}</div>
            {addMenu}
          </div>
          <p className="text-[11.5px] leading-relaxed text-zinc-400">{t('apps:intro')}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {apps.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              data-testid={`app-item-${a.name}`}
              className={cn(
                'mb-1 block w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                selected?.id === a.id ? 'border-indigo-500/40 bg-indigo-500/[0.07]' : 'border-transparent hover:bg-surface-2'
              )}
            >
              <div className="flex items-center gap-1.5">
                <StatusDot app={a} />
                <span className={cn('truncate text-[12.5px] font-medium', a.enabled ? 'text-zinc-100' : 'text-zinc-500')}>{a.name}</span>
                <span className="ml-auto shrink-0 rounded bg-zinc-700/50 px-1 text-[9.5px] font-medium uppercase tracking-wide text-zinc-400">
                  {t(a.transport === 'stdio' ? 'apps:kind.stdio' : 'apps:kind.http')}
                </span>
              </div>
              {a.description && <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-zinc-400">{a.description}</div>}
              <div className="mt-1 text-[10.5px] text-zinc-500">
                {statusText(a)} · {t('apps:toolCount', { count: a.tools.length })} · {a.agentIds.length ? t('apps:agentCount', { count: a.agentIds.length }) : t('apps:noAgents')}
              </div>
            </button>
          ))}
        </div>
      </aside>
      {listHandle}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {apps.length === 0 ? (
          <Empty icon={<Blocks size={18} />} title={t('apps:empty.title')} hint={t('apps:empty.hint')} action={addMenu} />
        ) : selected ? (
          <AppPanel key={selected.id} app={selected} onDeleted={() => setSelectedId(null)} />
        ) : null}
      </main>
      {creating && (
        <CreateModal
          transport={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null)
            setSelectedId(id)
          }}
        />
      )}
      {importing && (
        <ImportModal
          source={importing}
          onClose={() => setImporting(null)}
          onDone={(id) => {
            setImporting(null)
            if (id) setSelectedId(id)
          }}
        />
      )}
    </div>
  )
}

type AddKind = 'local' | 'remote' | 'json' | 'claude'

function AddMenu({ onPick }: { onPick: (k: AddKind) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const items: { k: AddKind; icon: typeof Terminal; label: string }[] = [
    { k: 'local', icon: Terminal, label: t('apps:addMenu.local') },
    { k: 'remote', icon: Globe, label: t('apps:addMenu.remote') },
    { k: 'json', icon: ClipboardPaste, label: t('apps:addMenu.json') },
    { k: 'claude', icon: Blocks, label: t('apps:addMenu.claude') }
  ]
  return (
    <div className="relative" ref={ref}>
      <button className="btn-primary h-7" onClick={() => setOpen((v) => !v)} data-testid="apps-add">
        <Plus size={13} /> {t('apps:add')} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="card shadow-pop absolute right-0 top-8 z-30 w-[250px] p-1">
          {items.map(({ k, icon: Icon, label }) => (
            <button key={k} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] text-zinc-200 hover:bg-surface-2" onClick={() => {
                setOpen(false)
                onPick(k)
              }}
              data-testid={`apps-add-${k}`}>
              <Icon size={13} className="text-zinc-400" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Status = 'ok' | 'error' | 'unknown' | 'off' | 'signIn'
function statusOf(a: AppServer): Status {
  if (!a.enabled) return 'off'
  if (a.oauth && !a.signedIn) return 'signIn'
  return a.lastOk === true ? 'ok' : a.lastOk === false ? 'error' : 'unknown'
}
const STATUS_KEYS = {
  ok: 'apps:status.ok',
  error: 'apps:status.error',
  unknown: 'apps:status.unknown',
  off: 'apps:status.off',
  signIn: 'apps:status.signIn'
} as const satisfies Record<Status, I18nKey>
function statusText(a: AppServer): string {
  return tr(STATUS_KEYS[statusOf(a)])
}
function StatusDot({ app }: { app: AppServer }) {
  const s = statusOf(app)
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        s === 'ok' ? 'bg-emerald-400' : s === 'error' ? 'bg-rose-400' : s === 'signIn' ? 'bg-amber-400' : s === 'off' ? 'bg-zinc-600' : 'bg-zinc-400'
      )}
    />
  )
}

type DetailTab = 'tools' | 'access' | 'settings' | 'audit'

function AppPanel({ app, onDeleted }: { app: AppServer; onDeleted: () => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [tab, setTab] = useState<DetailTab>('tools')
  const [busy, setBusy] = useState<'test' | 'signIn' | null>(null)
  const [confirm, setConfirm] = useState(false)

  const test = async (): Promise<void> => {
    setBusy('test')
    try {
      const r = await call('apps:test', app.id)
      toast(r.ok ? 'success' : 'error', r.message)
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(null)
    }
  }
  const signIn = async (): Promise<void> => {
    setBusy('signIn')
    try {
      const r = await call('apps:signIn', app.id)
      toast(r.ok ? 'success' : 'error', r.message)
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(null)
    }
  }
  const remove = async (): Promise<void> => {
    try {
      await call('apps:delete', app.id)
      toast('success', t('apps:detail.deleted'))
      onDeleted()
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <div className="mx-auto max-w-[920px] space-y-4 px-8 py-6" data-testid="app-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-indigo-300">
          {app.transport === 'stdio' ? <Terminal size={18} /> : <Globe size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-zinc-100">{app.name}</h2>
            <StatusDot app={app} />
            <span className="text-[11.5px] text-zinc-400">{statusText(app)}</span>
          </div>
          {app.description && <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-300">{app.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span className="max-w-[520px] truncate font-mono text-zinc-400" title={app.transport === 'stdio' ? [app.command, ...app.args].join(' ') : app.url}>
              {app.transport === 'stdio' ? [app.command, ...app.args].join(' ') : app.url}
            </span>
            {app.serverName && <span>{t('apps:detail.server', { name: app.serverName })}</span>}
            {app.toolsAt && <span>{t('apps:detail.toolsAt', { date: new Date(app.toolsAt).toLocaleString(locale()) })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="mr-2 flex items-center gap-2 text-[12px] text-zinc-300" title={t('apps:detail.enabledHint')}>
            <Toggle checked={app.enabled} onChange={(v) => void call('apps:save', { enabled: v }, app.id).catch((e) => toast('error', apiError(e)))} />
            {t('apps:detail.enabled')}
          </label>
          <button className="icon-btn h-7 w-7 hover:text-rose-400" title={t('apps:detail.delete')} onClick={() => setConfirm(true)} data-testid="app-delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary h-8" onClick={() => void test()} disabled={!!busy} data-testid="app-test">
          <RefreshCw size={12} className={cn(busy === 'test' && 'animate-spin')} /> {busy === 'test' ? t('apps:detail.testing') : t('apps:detail.test')}
        </button>
        {app.oauth &&
          (app.signedIn ? (
            <button className="btn-ghost h-8" onClick={() => void call('apps:signOut', app.id).catch((e) => toast('error', apiError(e)))} data-testid="app-signout">
              <LogOut size={12} /> {t('apps:detail.signOut')}
            </button>
          ) : (
            <button className="btn-ghost h-8" onClick={() => void signIn()} disabled={!!busy} title={t('apps:detail.signInHint')} data-testid="app-signin">
              <LogIn size={12} /> {busy === 'signIn' ? t('apps:detail.signingIn') : t('apps:detail.signIn')}
            </button>
          ))}
      </div>

      {confirm && (
        <div className="flex items-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-[12.5px] text-rose-200">
          <span className="flex-1">{t('apps:detail.deleteConfirm', { name: app.name })}</span>
          <button className="btn-ghost h-7" onClick={() => setConfirm(false)}>
            {t('actions.cancel')}
          </button>
          <button className="btn-danger h-7" onClick={() => void remove()} data-testid="app-delete-confirm">
            {t('actions.yesDelete')}
          </button>
        </div>
      )}

      {app.lastOk === false && app.lastMessage && (
        <div className="whitespace-pre-wrap break-words rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 font-mono text-[11.5px] text-rose-200" data-testid="app-error">
          {app.lastMessage}
        </div>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'tools', label: `${t('apps:tabs.tools')} (${app.tools.length})` },
          { value: 'access', label: `${t('apps:tabs.access')} (${app.agentIds.length})` },
          { value: 'settings', label: t('apps:tabs.settings') },
          { value: 'audit', label: t('apps:tabs.audit') }
        ]}
      />

      {tab === 'tools' && <ToolsTab app={app} />}
      {tab === 'access' && <AccessTab app={app} />}
      {tab === 'settings' && (
        <section className="card px-5 py-4">
          <AppForm app={app} />
        </section>
      )}
      {tab === 'audit' && (
        <section className="card">
          <AuditList connectionId={app.id} />
        </section>
      )}
    </div>
  )
}

function ToolsTab({ app }: { app: AppServer }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const setPolicy = (tool: string, p: ToolPolicy, def: ToolPolicy): void => {
    void call('apps:setPolicy', app.id, tool, p === def ? null : p).catch((e) => toast('error', apiError(e)))
  }
  if (!app.tools.length) return <div className="card px-5 py-6 text-[12.5px] text-zinc-500">{t('apps:tools.none')}</div>
  return (
    <section className="card" data-testid="app-tools">
      <p className="border-b border-line-soft px-4 py-2.5 text-[11.5px] leading-snug text-zinc-400">{t('apps:tools.policyHint')}</p>
      <ul className="divide-y divide-line-soft">
        {app.tools.map((tool) => {
          const def = defaultPolicy(tool)
          const cur = policyOf(app, tool)
          return (
            <li key={tool.name} className="flex items-start gap-3 px-4 py-2.5" data-testid={`app-tool-${tool.name}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[12.5px] text-zinc-100">{tool.name}</span>
                  {tool.readOnly && <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-300">{t('apps:tools.readOnly')}</span>}
                  {tool.destructive && <span className="rounded bg-rose-500/15 px-1 text-[10px] text-rose-300">{t('apps:tools.destructive')}</span>}
                </div>
                {(tool.description || tool.title) && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-zinc-400">{tool.description || tool.title}</div>}
              </div>
              <select
                className={cn('input h-7 w-[236px] shrink-0 text-[12px]', cur === 'block' ? 'text-zinc-500' : cur === 'auto' ? 'text-emerald-200' : 'text-amber-200')}
                value={cur}
                onChange={(e) => setPolicy(tool.name, e.target.value as ToolPolicy, def)}
                aria-label={t('apps:tools.policy')}
              >
                {(['auto', 'approve', 'block'] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`apps:tools.policies.${p}`)}
                    {p === def ? ` (${t('apps:tools.default')})` : ''}
                  </option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AccessTab({ app }: { app: AppServer }) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const toast = useAppStore((s) => s.toast)
  const set = (agentId: string, on: boolean): Promise<void> => call('apps:setPermission', app.id, agentId, on).catch((e) => toast('error', apiError(e)))
  return (
    <section className="card px-4 py-3.5" data-testid="app-access">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[11.5px] leading-snug text-zinc-400">{t('apps:access.hint')}</p>
        {agents.length > 0 && (
          <div className="flex shrink-0 gap-1.5">
            <button className="btn-ghost h-7" onClick={() => void Promise.all(agents.filter((a) => !app.agentIds.includes(a.id)).map((a) => set(a.id, true)))}>
              {t('apps:access.all')}
            </button>
            <button className="btn-ghost h-7" onClick={() => void Promise.all(app.agentIds.map((id) => set(id, false)))}>
              {t('apps:access.noneBtn')}
            </button>
          </div>
        )}
      </div>
      {agents.length === 0 && <div className="mt-3 text-[12px] text-zinc-500">{t('apps:access.none')}</div>}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-[12.5px] text-zinc-200" data-testid={`app-access-${a.name}`}>
            <Toggle size="sm" checked={app.agentIds.includes(a.id)} onChange={(v) => void set(a.id, v)} />
            <span className="truncate">{a.name}</span>
            <span className="ml-auto truncate text-[11px] text-zinc-500">{a.role}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

/* ---------- form ---------- */

interface Row {
  key: string
  value: string
  /** Stored on the main side; an empty value keeps it. */
  stored: boolean
}

interface FormState {
  name: string
  description: string
  transport: AppTransport
  command: string
  args: string
  cwd: string
  env: Row[]
  url: string
  headers: Row[]
  oauth: boolean
}

function initialForm(app: AppServer | null, transport: AppTransport, c?: AppImportCandidate): FormState {
  if (c) {
    return {
      name: c.name,
      description: '',
      transport: c.transport,
      command: c.command,
      args: c.args.join('\n'),
      cwd: '',
      env: c.env.map((p) => ({ ...p, stored: false })),
      url: c.url,
      headers: c.headers.map((p) => ({ ...p, stored: false })),
      oauth: false
    }
  }
  return {
    name: app?.name ?? '',
    description: app?.description ?? '',
    transport: app?.transport ?? transport,
    command: app?.command ?? '',
    args: (app?.args ?? []).join('\n'),
    cwd: app?.cwd ?? '',
    env: (app?.envKeys ?? []).map((key) => ({ key, value: '', stored: true })),
    url: app?.url ?? '',
    headers: (app?.headerKeys ?? []).map((key) => ({ key, value: '', stored: true })),
    oauth: app?.oauth ?? false
  }
}

function toInput(f: FormState): AppServerInput {
  const pairs = (rows: Row[]): AppServerInput['env'] =>
    rows.filter((r) => r.key.trim()).map((r) => (r.stored && !r.value ? { key: r.key.trim() } : { key: r.key.trim(), value: r.value }))
  return {
    name: f.name,
    description: f.description,
    transport: f.transport,
    command: f.command,
    args: f.args
      .split('\n')
      .map((a) => a.trim())
      .filter(Boolean),
    cwd: f.cwd,
    env: pairs(f.env),
    url: f.url,
    headers: pairs(f.headers),
    oauth: f.oauth
  }
}

function FormFields({ f, set }: { f: FormState; set: (p: Partial<FormState>) => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t('apps:form.name')}</span>
          <input className="input" value={f.name} placeholder={t('apps:form.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} data-testid="app-form-name" />
        </label>
        <div>
          <span className="label">{t('apps:form.transport')}</span>
          <Segmented
            value={f.transport}
            onChange={(v) => set({ transport: v })}
            options={[
              { value: 'stdio', label: t('apps:kind.stdioLong') },
              { value: 'http', label: t('apps:kind.httpLong') }
            ]}
          />
        </div>
      </div>
      <label className="block">
        <span className="label">{t('apps:form.description')}</span>
        <input className="input" value={f.description} placeholder={t('apps:form.descriptionPlaceholder')} onChange={(e) => set({ description: e.target.value })} data-testid="app-form-description" />
      </label>
      {f.transport === 'stdio' ? (
        <>
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] leading-snug text-amber-100">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" /> {t('apps:form.stdioWarning')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('apps:form.command')}</span>
              <input className="input font-mono" value={f.command} placeholder={t('apps:form.commandPlaceholder')} onChange={(e) => set({ command: e.target.value })} data-testid="app-form-command" />
            </label>
            <label className="block">
              <span className="label">{t('apps:form.cwd')}</span>
              <input className="input font-mono" value={f.cwd} onChange={(e) => set({ cwd: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="label">{t('apps:form.args')}</span>
            <textarea className="input h-20 resize-none font-mono text-[12px]" value={f.args} placeholder={t('apps:form.argsPlaceholder')} onChange={(e) => set({ args: e.target.value })} data-testid="app-form-args" />
          </label>
          <SecretRows title={t('apps:form.env')} hint={t('apps:form.envHint')} rows={f.env} onChange={(env) => set({ env })} testId="app-form-env" />
        </>
      ) : (
        <>
          <label className="block">
            <span className="label">{t('apps:form.url')}</span>
            <input className="input font-mono" value={f.url} placeholder={t('apps:form.urlPlaceholder')} onChange={(e) => set({ url: e.target.value })} data-testid="app-form-url" />
          </label>
          <label className="flex items-start gap-2.5">
            <Toggle checked={f.oauth} onChange={(oauth) => set({ oauth })} />
            <span>
              <span className="block text-[12.5px] text-zinc-200">{t('apps:form.oauth')}</span>
              <span className="block text-[11.5px] text-zinc-500">{t('apps:form.oauthHint')}</span>
            </span>
          </label>
          <SecretRows title={t('apps:form.headers')} hint={t('apps:form.headersHint')} rows={f.headers} onChange={(headers) => set({ headers })} testId="app-form-headers" />
        </>
      )}
    </div>
  )
}

function SecretRows({ title, hint, rows, onChange, testId }: { title: string; hint: string; rows: Row[]; onChange: (r: Row[]) => void; testId: string }) {
  const { t } = useTranslation()
  const update = (i: number, p: Partial<Row>): void => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="label mb-0 flex-1">{title}</span>
        <button className="btn-ghost h-6 text-[11.5px]" onClick={() => onChange([...rows, { key: '', value: '', stored: false }])}>
          <Plus size={11} /> {t('apps:form.addRow')}
        </button>
      </div>
      <p className="mb-1.5 text-[11px] text-zinc-500">{hint}</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-1.5">
            <input className="input w-[38%] font-mono text-[12px]" placeholder={t('apps:form.key')} value={r.key} disabled={r.stored} onChange={(e) => update(i, { key: e.target.value })} />
            <input
              className="input flex-1 font-mono text-[12px]"
              type="password"
              autoComplete="off"
              placeholder={r.stored ? t('apps:form.keep') : t('apps:form.value')}
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <button className="icon-btn h-8 w-8 shrink-0" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Settings tab of an existing app. */
function AppForm({ app }: { app: AppServer }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [f, setF] = useState(() => initialForm(app, app.transport))
  const [saving, setSaving] = useState(false)
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await call('apps:save', toInput(f), app.id)
      toast('success', t('apps:form.saved'))
      setF(initialForm(saved, saved.transport))
      if (!(saved.transport === 'http' && saved.oauth && !saved.signedIn)) {
        const r = await call('apps:test', app.id)
        if (!r.ok) toast('error', r.message)
      }
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div data-testid="app-settings">
      <FormFields f={f} set={(p) => setF((o) => ({ ...o, ...p }))} />
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={() => void save()} disabled={saving} data-testid="app-form-save">
          {t('apps:form.save')}
        </button>
      </div>
    </div>
  )
}

function CreateModal({ transport, onClose, onCreated }: { transport: AppTransport; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [f, setF] = useState(() => initialForm(null, transport))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const create = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const saved = await call('apps:save', toInput(f))
      onCreated(saved.id)
      // Connect right away so the tool list is there; sign-in servers wait for the button.
      if (!(saved.transport === 'http' && saved.oauth)) {
        const r = await call('apps:test', saved.id)
        toast(r.ok ? 'success' : 'error', r.message)
      }
    } catch (e) {
      setError(apiError(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title={t(f.transport === 'stdio' ? 'apps:form.newTitleLocal' : 'apps:form.newTitleRemote')}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" onClick={() => void create()} disabled={saving || !f.name.trim()} data-testid="app-create">
            {t('apps:form.create')}
          </button>
        </>
      }
    >
      <FormFields f={f} set={(p) => setF((o) => ({ ...o, ...p }))} />
      {error && <div className="mt-3 whitespace-pre-wrap text-[12px] text-rose-300">{error}</div>}
    </Modal>
  )
}

function ImportModal({ source, onClose, onDone }: { source: 'json' | 'claude-desktop'; onClose: () => void; onDone: (firstId: string | null) => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [text, setText] = useState('')
  const [found, setFound] = useState<AppImportCandidate[] | null>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const read = async (): Promise<void> => {
    setError(null)
    try {
      const r = await call('apps:import', source === 'json' ? { type: 'json', text } : { type: 'claude-desktop' })
      setFound(r)
      setPick(new Set(r.filter((c) => !c.exists).map((c) => c.name)))
    } catch (e) {
      setError(apiError(e))
      setFound(null)
    }
  }
  useEffect(() => {
    if (source === 'claude-desktop') void read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const chosen = useMemo(() => (found ?? []).filter((c) => !c.exists && pick.has(c.name)), [found, pick])
  const add = async (): Promise<void> => {
    setBusy(true)
    const ids: string[] = []
    try {
      for (const c of chosen) ids.push((await call('apps:save', toInput(initialForm(null, c.transport, c)))).id)
      toast('success', t('apps:import.added', { count: ids.length }))
      onDone(ids[0] ?? null)
      for (const id of ids) void call('apps:test', id).catch(() => undefined)
    } catch (e) {
      setError(apiError(e))
      if (ids.length) onDone(ids[0])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title={t(source === 'json' ? 'apps:import.titleJson' : 'apps:import.titleClaude')}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          {source === 'json' && !found && (
            <button className="btn-primary" onClick={() => void read()} disabled={!text.trim()} data-testid="apps-import-read">
              {t('apps:import.read')}
            </button>
          )}
          {found && (
            <button className="btn-primary" onClick={() => void add()} disabled={busy || chosen.length === 0} data-testid="apps-import-add">
              {t('apps:import.add', { count: chosen.length })}
            </button>
          )}
        </>
      }
    >
      {source === 'json' && !found && (
        <>
          <p className="mb-2 text-[12px] text-zinc-400">{t('apps:import.jsonHint')}</p>
          <textarea className="input h-[240px] w-full resize-none font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="apps-import-text" />
        </>
      )}
      {found && (
        <div data-testid="apps-import-list">
          <div className="mb-2 text-[12px] text-zinc-400">{t('apps:import.found', { count: found.length })}</div>
          <ul className="space-y-1.5">
            {found.map((c) => (
              <li key={c.name} className={cn('flex items-start gap-2.5 rounded-md border border-line px-3 py-2', c.exists && 'opacity-60')}>
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={c.exists}
                  checked={!c.exists && pick.has(c.name)}
                  onChange={(e) =>
                    setPick((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(c.name)
                      else n.delete(c.name)
                      return n
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12.5px] text-zinc-100">
                    {c.transport === 'stdio' ? <Terminal size={12} className="text-zinc-400" /> : <Globe size={12} className="text-zinc-400" />}
                    {c.name}
                    {c.exists && <span className="text-[11px] text-zinc-500">— {t('apps:import.exists')}</span>}
                  </div>
                  <div className="truncate font-mono text-[11px] text-zinc-500">{c.transport === 'stdio' ? [c.command, ...c.args].join(' ') : c.url}</div>
                  {(c.env.length > 0 || c.headers.length > 0) && <div className="font-mono text-[10.5px] text-zinc-500">{[...c.env, ...c.headers].map((p) => p.key).join(', ')}</div>}
                </div>
              </li>
            ))}
          </ul>
          {found.some((c) => c.env.length || c.headers.length) && <p className="mt-2 text-[11px] text-zinc-500">{t('apps:import.secretsNote')}</p>}
        </div>
      )}
      {error && <div className="mt-3 whitespace-pre-wrap text-[12px] text-rose-300" data-testid="apps-import-error">{error}</div>}
    </Modal>
  )
}
