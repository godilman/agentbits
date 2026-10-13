import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  Database,
  FileKey,
  History,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Table2,
  Trash2,
  XCircle
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { AccessLevel, Connection, ConnectionEnv, ConnectionInput, ConnectionKind, ConnectionTestResult, SchemaInfo, SshAuth } from '@shared/types'
import { DEFAULT_PORT, DEFAULT_SSH_READ, ENV_LABEL, isDb, KIND_LABEL, LEVEL_HINT, LEVEL_LABEL, LEVEL_ORDER } from '@shared/connections'
import { locale } from '@/i18n'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Empty, Segmented, Toggle } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, timeAgo } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { AuditList } from './AuditList'

/** Organization → Connections: servers and databases the agents may use, per-agent access, schema, audit. */

export const ENV_CLS: Record<ConnectionEnv, string> = {
  development: 'bg-emerald-500/10 text-emerald-300',
  staging: 'bg-amber-500/10 text-amber-300',
  production: 'bg-rose-500/15 text-rose-300'
}

const AUDIT = '__audit'
type Pane = 'settings' | 'access' | 'schema' | 'audit'

export function KindIcon({ kind, size = 14, className }: { kind: ConnectionKind; size?: number; className?: string }) {
  return kind === 'ssh' ? <Server size={size} className={className} /> : <Database size={size} className={className} />
}

export function ConnectionsView() {
  const { t } = useTranslation(['common', 'connections'])
  const connections = useAppStore((s) => s.connections)
  const perms = useAppStore((s) => s.connPerms)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState<ConnectionKind | null>(null)
  const [query, setQuery] = useState('')
  const conn = connections.find((c) => c.id === selected) ?? null

  useEffect(() => {
    if (!selected && !creating && connections[0]) setSelected(connections[0].id)
  }, [connections, selected, creating])

  const q = query.trim().toLocaleLowerCase(locale())
  const shown = useMemo(
    () => connections.filter((c) => !q || `${c.name} ${c.host} ${c.description}`.toLocaleLowerCase(locale()).includes(q)),
    [connections, q]
  )
  const accessCount = (id: string): number => perms.filter((p) => p.connectionId === id).length

  return (
    <div className="flex h-full">
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="panel-title">{t('connections:list.title')}</span>
          <NewMenu
            onPick={(k) => {
              setCreating(k)
              setSelected(null)
            }}
          />
        </div>
        {connections.length > 5 && (
          <div className="relative px-3 pb-2">
            <Search size={12} className="absolute left-5 top-1/2 -translate-y-[60%] text-zinc-500" />
            <input className="input h-7 pl-7 text-[12px]" placeholder={t('connections:list.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {shown.map((c) => (
            <button
              key={c.id}
              data-connection={c.name}
              onClick={() => {
                setSelected(c.id)
                setCreating(null)
              }}
              className={cn('flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left', selected === c.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]')}
            >
              <KindIcon kind={c.kind} className="mt-0.5 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] text-zinc-200">{c.name}</span>
                  <span className={cn('shrink-0 rounded px-1 text-[9.5px] font-medium', ENV_CLS[c.env])}>{ENV_LABEL[c.env]}</span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-zinc-500">
                  {c.host || '—'}
                  {c.port ? `:${c.port}` : ''}
                </div>
                <div className="flex items-center gap-2 text-[10.5px] text-zinc-500">
                  <span>{t('connections:list.agents', { count: accessCount(c.id) })}</span>
                  {c.lastTestOk !== null && (
                    <span className={c.lastTestOk ? 'text-emerald-400/80' : 'text-rose-400/80'}>{c.lastTestOk ? t('connections:list.testOk') : t('connections:list.testFailed')}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
          {connections.length === 0 && !creating && (
            <div className="px-2 py-3 text-[12px] text-zinc-500">{t('connections:list.empty')}</div>
          )}
        </div>
        <div className="border-t border-line p-2">
          <button
            onClick={() => {
              setSelected(AUDIT)
              setCreating(null)
            }}
            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]', selected === AUDIT ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03]')}
          >
            <History size={14} /> {t('connections:list.auditAll')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {creating ? (
          <ConnectionEditor
            key={`new-${creating}`}
            conn={null}
            kind={creating}
            onSaved={(c) => {
              setCreating(null)
              setSelected(c.id)
            }}
            onCancel={() => setCreating(null)}
          />
        ) : selected === AUDIT ? (
          <div className="px-6 py-5">
            <h2 className="mb-1 text-[16px] font-semibold text-zinc-100">{t('connections:audit.title')}</h2>
            <p className="mb-4 text-[12px] text-zinc-400">{t('connections:audit.intro')}</p>
            <AuditList />
          </div>
        ) : conn ? (
          <ConnectionDetail key={conn.id} conn={conn} onDeleted={() => setSelected(null)} />
        ) : (
          <Empty icon={<Plug size={18} />} title={t('connections:list.selectTitle')} hint={t('connections:list.selectHint')} />
        )}
      </div>
    </div>
  )
}

function NewMenu({ onPick }: { onPick: (k: ConnectionKind) => void }) {
  const { t } = useTranslation(['common', 'connections'])
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="icon-btn" title={t('connections:list.newConnection')} onClick={() => setOpen((v) => !v)}>
        <Plus size={15} />
      </button>
      {open && (
        <div className="card shadow-pop absolute right-0 top-8 z-30 w-56 p-1" onMouseLeave={() => setOpen(false)}>
          {(['postgres', 'mysql', 'mssql', 'ssh'] as ConnectionKind[]).map((k) => (
            <button
              key={k}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-white/[0.05]"
              onClick={() => {
                setOpen(false)
                onPick(k)
              }}
            >
              <KindIcon kind={k} className="text-zinc-400" /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── detail ───────────────────────────── */

function ConnectionDetail({ conn, onDeleted }: { conn: Connection; onDeleted: () => void }) {
  const { t } = useTranslation(['common', 'connections'])
  const [pane, setPane] = useState<Pane>('settings')
  const perms = useAppStore((s) => s.connPerms)
  const n = perms.filter((p) => p.connectionId === conn.id).length
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        <KindIcon kind={conn.kind} size={18} className="text-indigo-300" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-zinc-100">{conn.name}</span>
            <span className={cn('rounded px-1.5 text-[10.5px] font-medium', ENV_CLS[conn.env])}>{ENV_LABEL[conn.env]}</span>
          </div>
          <div className="text-[11.5px] text-zinc-500">
            {KIND_LABEL[conn.kind]} · {conn.host || t('connections:detail.noHost')}
            {conn.port ? `:${conn.port}` : ''}
            {conn.lastTestAt && ` · ${t('connections:detail.lastTest', { ago: timeAgo(conn.lastTestAt) })}`}
          </div>
        </div>
        <div className="ml-auto">
          <Segmented<Pane>
            value={pane}
            onChange={setPane}
            options={[
              { value: 'settings', label: t('connections:detail.tabs.settings') },
              { value: 'access', label: t('connections:detail.tabs.access', { n }) },
              ...(isDb(conn.kind) ? [{ value: 'schema' as const, label: t('connections:detail.tabs.schema') }] : []),
              { value: 'audit', label: t('connections:detail.tabs.audit') }
            ]}
          />
        </div>
      </div>
      <div className="flex-1">
        {pane === 'settings' && <ConnectionEditor conn={conn} kind={conn.kind} onDeleted={onDeleted} />}
        {pane === 'access' && <AccessPane conn={conn} />}
        {pane === 'schema' && <SchemaPane conn={conn} />}
        {pane === 'audit' && (
          <div className="px-6 py-5">
            <AuditList connectionId={conn.id} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────────── editor ───────────────────────────── */

interface Form {
  name: string
  env: ConnectionEnv
  description: string
  purpose: string
  notes: string
  host: string
  port: string
  username: string
  database: string
  ssl: boolean
  trustServerCertificate: boolean
  readOnlyUsername: string
  sshAuth: SshAuth
  keyPath: string
  sshRead: string
  sshWrite: string
  sshExecute: string
  /** undefined = unchanged */
  secret?: string
  readOnlySecret?: string
}

const toForm = (c: Connection | null, kind: ConnectionKind): Form => ({
  name: c?.name ?? '',
  env: c?.env ?? 'development',
  description: c?.description ?? '',
  purpose: c?.purpose ?? '',
  notes: c?.notes ?? '',
  host: c?.host ?? '',
  port: String(c?.port ?? DEFAULT_PORT[kind]),
  username: c?.username ?? '',
  database: c?.database ?? '',
  ssl: c?.ssl ?? false,
  trustServerCertificate: c?.trustServerCertificate ?? false,
  readOnlyUsername: c?.readOnlyUsername ?? '',
  sshAuth: c?.sshAuth ?? 'key-file',
  keyPath: c?.keyPath ?? '',
  sshRead: (c?.sshRead ?? (kind === 'ssh' ? DEFAULT_SSH_READ : [])).join('\n'),
  sshWrite: (c?.sshWrite ?? []).join('\n'),
  sshExecute: (c?.sshExecute ?? []).join('\n')
})

const lines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean)

function ConnectionEditor({
  conn,
  kind,
  onSaved,
  onCancel,
  onDeleted
}: {
  conn: Connection | null
  kind: ConnectionKind
  onSaved?: (c: Connection) => void
  onCancel?: () => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation(['common', 'connections'])
  const toast = useAppStore((s) => s.toast)
  const [form, setForm] = useState<Form>(() => toForm(conn, kind))
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<ConnectionTestResult | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const db = isDb(kind)
  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setForm((f) => ({ ...f, [k]: v }))
  const initial = useMemo(() => JSON.stringify(toForm(conn, kind)), [conn, kind])
  const dirty = JSON.stringify({ ...form, secret: undefined, readOnlySecret: undefined }) !== initial || form.secret !== undefined || form.readOnlySecret !== undefined

  const input = (): ConnectionInput => {
    const port = Number(form.port)
    return {
      name: form.name,
      ...(conn ? {} : { kind }),
      env: form.env,
      description: form.description,
      purpose: form.purpose,
      notes: form.notes,
      host: form.host,
      port: Number.isFinite(port) ? Math.round(port) : DEFAULT_PORT[kind],
      username: form.username,
      database: form.database,
      ssl: form.ssl,
      trustServerCertificate: form.trustServerCertificate,
      readOnlyUsername: form.readOnlyUsername,
      sshAuth: form.sshAuth,
      keyPath: form.keyPath,
      sshRead: lines(form.sshRead),
      sshWrite: lines(form.sshWrite),
      sshExecute: lines(form.sshExecute),
      ...(form.secret !== undefined ? { secret: form.secret } : {}),
      ...(form.readOnlySecret !== undefined ? { readOnlySecret: form.readOnlySecret } : {})
    }
  }

  const save = async (): Promise<Connection | null> => {
    if (!form.name.trim()) {
      setError(t('connections:editor.nameRequired'))
      return null
    }
    setBusy('save')
    setError(null)
    try {
      const c = await call('connections:save', input(), conn?.id)
      useAppStore.setState((s) => ({ connections: s.connections.some((x) => x.id === c.id) ? s.connections.map((x) => (x.id === c.id ? c : x)) : [...s.connections, c] }))
      setForm((f) => ({ ...f, secret: undefined, readOnlySecret: undefined }))
      if (!conn) onSaved?.(c)
      else toast('success', t('connections:editor.saved'))
      return c
    } catch (e) {
      setError(apiError(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  const runTest = async (): Promise<void> => {
    const c = dirty || !conn ? await save() : conn
    if (!c) return
    setBusy('test')
    setTest(null)
    try {
      setTest(await call('connections:test', c.id))
    } catch (e) {
      setTest({ ok: false, message: apiError(e), latencyMs: 0 })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!conn) return
    setBusy('delete')
    try {
      await call('connections:delete', conn.id)
      toast('success', t('connections:editor.deleted', { name: conn.name }))
      onDeleted?.()
    } catch (e) {
      setError(apiError(e))
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-5">
      {!conn && (
        <div className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100">
          <KindIcon kind={kind} size={17} className="text-indigo-300" /> {t('connections:editor.newTitle', { kind: KIND_LABEL[kind] })}
        </div>
      )}

      <Section title={t('connections:editor.definition.title')} hint={t('connections:editor.definition.hint')}>
        <div className="grid grid-cols-[1fr_200px] gap-3">
          <Field label={t('connections:editor.definition.name')}>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={db ? t('connections:editor.definition.namePlaceholderDb') : t('connections:editor.definition.namePlaceholderSsh')} autoFocus={!conn} />
          </Field>
          <Field label={t('connections:editor.definition.env')}>
            <select className="input" value={form.env} onChange={(e) => set('env', e.target.value as ConnectionEnv)}>
              {(['development', 'staging', 'production'] as ConnectionEnv[]).map((e) => (
                <option key={e} value={e}>
                  {ENV_LABEL[e]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {form.env === 'production' && (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[11.5px] text-rose-200">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            {t('connections:editor.definition.productionWarning')}
          </div>
        )}
        <Field label={t('connections:editor.definition.description')}>
          <textarea className="textarea" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={db ? t('connections:editor.definition.descriptionPlaceholderDb') : t('connections:editor.definition.descriptionPlaceholderSsh')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('connections:editor.definition.purpose')}>
            <textarea className="textarea" rows={2} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder={t('connections:editor.definition.purposePlaceholder')} />
          </Field>
          <Field label={db ? t('connections:editor.definition.notesDb') : t('connections:editor.definition.notesSsh')}>
            <textarea className="textarea" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder={db ? t('connections:editor.definition.notesPlaceholderDb') : t('connections:editor.definition.notesPlaceholderSsh')} />
          </Field>
        </div>
      </Section>

      <Section title={t('connections:editor.connection.title')}>
        <div className="grid grid-cols-[1fr_110px_1fr] gap-3">
          <Field label={t('connections:editor.connection.host')}>
            <input className="input font-mono" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="10.0.0.12" />
          </Field>
          <Field label={t('connections:editor.connection.port')}>
            <input className="input font-mono" value={form.port} onChange={(e) => set('port', e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          <Field label={t('connections:editor.connection.username')}>
            <input className="input font-mono" value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
        </div>
        {db && (
          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-4">
            <Field label={t('connections:editor.connection.database')}>
              <input className="input font-mono" value={form.database} onChange={(e) => set('database', e.target.value)} />
            </Field>
            <label className="flex h-8 items-center gap-2 text-[12px] text-zinc-300">
              <Toggle size="sm" checked={form.ssl} onChange={(v) => set('ssl', v)} /> {kind === 'mssql' ? t('connections:editor.connection.encrypt') : t('connections:editor.connection.ssl')}
            </label>
            <label className="flex h-8 items-center gap-2 text-[12px] text-zinc-300" title={t('connections:editor.connection.trustCertTitle')}>
              <Toggle size="sm" checked={form.trustServerCertificate} onChange={(v) => set('trustServerCertificate', v)} /> {t('connections:editor.connection.trustCert')}
            </label>
          </div>
        )}
      </Section>

      <Section title={t('connections:editor.auth.title')} hint={t('connections:editor.auth.hint')}>
        {db ? (
          <>
            <SecretField label={t('connections:editor.auth.password')} has={!!conn?.hasSecret} value={form.secret} onChange={(v) => set('secret', v)} />
            <div className="rounded-md border border-line bg-white/[0.02] p-3">
              <div className="mb-1 text-[12.5px] text-zinc-200">{t('connections:editor.auth.readOnlyTitle')}</div>
              <div className="mb-2 text-[11.5px] text-zinc-400">
                {t('connections:editor.auth.readOnlyHint')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('connections:editor.connection.username')}>
                  <input className="input font-mono" value={form.readOnlyUsername} onChange={(e) => set('readOnlyUsername', e.target.value)} placeholder="readonly_user" />
                </Field>
                <SecretField label={t('connections:editor.auth.password')} has={!!conn?.hasReadOnlySecret} value={form.readOnlySecret} onChange={(v) => set('readOnlySecret', v)} />
              </div>
            </div>
          </>
        ) : (
          <>
            <Field label={t('connections:editor.auth.method')}>
              <Segmented<SshAuth>
                value={form.sshAuth}
                onChange={(v) => set('sshAuth', v)}
                options={[
                  { value: 'key-file', label: t('connections:editor.auth.methodKeyFile') },
                  { value: 'key', label: t('connections:editor.auth.methodKey') },
                  { value: 'password', label: t('connections:editor.auth.methodPassword') },
                  { value: 'agent', label: t('connections:editor.auth.methodAgent') }
                ]}
              />
            </Field>
            {form.sshAuth === 'key-file' && (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label={t('connections:editor.auth.keyFile')}>
                  <input className="input font-mono" value={form.keyPath} onChange={(e) => set('keyPath', e.target.value)} placeholder={t('connections:editor.auth.keyFilePlaceholder')} />
                </Field>
                <button
                  className="btn-outline h-8"
                  onClick={async () => {
                    const f = await call('app:pickFile', t('connections:editor.auth.keyFile'))
                    if (f) set('keyPath', f)
                  }}
                >
                  <FileKey size={13} /> {t('connections:editor.auth.browse')}
                </button>
              </div>
            )}
            {form.sshAuth === 'key' && (
              <Field label={conn?.hasSecret ? t('connections:editor.auth.keyStored') : t('connections:editor.auth.keyNew')}>
                <textarea
                  className="textarea font-mono text-[11px]"
                  rows={4}
                  value={form.secret ?? ''}
                  onChange={(e) => set('secret', e.target.value || undefined)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
              </Field>
            )}
            {(form.sshAuth === 'password' || form.sshAuth === 'key-file') && (
              <SecretField label={form.sshAuth === 'password' ? t('connections:editor.auth.password') : t('connections:editor.auth.passphrase')} has={!!conn?.hasSecret} value={form.secret} onChange={(v) => set('secret', v)} />
            )}
            {form.sshAuth === 'agent' && <div className="text-[11.5px] text-zinc-400">{t('connections:editor.auth.agentHint')}</div>}
            {conn?.hostKey && (
              <div className="flex items-center gap-2 text-[11.5px] text-zinc-400">
                <KeyRound size={12} /> {t('connections:editor.auth.hostKey')} <span className="font-mono text-zinc-300">{conn.hostKey}</span>
                <button
                  className="ml-auto text-[11px] text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                  onClick={async () => {
                    try {
                      await call('connections:save', { resetHostKey: true }, conn.id)
                      toast('info', t('connections:editor.auth.hostKeyReset'))
                    } catch (e) {
                      toast('error', apiError(e))
                    }
                  }}
                >
                  {t('actions.reset')}
                </button>
              </div>
            )}
          </>
        )}
      </Section>

      {!db && (
        <Section
          title={t('connections:editor.commands.title')}
          hint={t('connections:editor.commands.hint')}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('connections:editor.commands.read')}>
              <textarea className="textarea font-mono text-[11px]" rows={8} value={form.sshRead} onChange={(e) => set('sshRead', e.target.value)} />
            </Field>
            <Field label={t('connections:editor.commands.write')}>
              <textarea className="textarea font-mono text-[11px]" rows={8} value={form.sshWrite} onChange={(e) => set('sshWrite', e.target.value)} placeholder="cp /opt/erp/config/*" />
            </Field>
            <Field label={t('connections:editor.commands.execute')}>
              <textarea className="textarea font-mono text-[11px]" rows={8} value={form.sshExecute} onChange={(e) => set('sshExecute', e.target.value)} placeholder={'systemctl restart erp-api\ndocker restart erp-*'} />
            </Field>
          </div>
        </Section>
      )}

      {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">{error}</div>}
      {test && (
        <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]', test.ok ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200' : 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200')}>
          {test.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <div>{test.message}</div>
            <div className="mt-0.5 text-[11px] opacity-70">
              {test.latencyMs} ms{test.serverVersion ? ` · ${test.serverVersion}` : ''}
            </div>
          </div>
        </div>
      )}
      {!test && conn?.lastTestAt && conn.lastTestOk === false && (
        <div className="text-[11.5px] text-rose-300/80">{t('connections:editor.lastTestFailed', { message: conn.lastTestMessage })}</div>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-4">
        {conn && !confirmDelete && (
          <button className="btn-ghost text-rose-300 hover:text-rose-200" onClick={() => setConfirmDelete(true)} disabled={!!busy}>
            <Trash2 size={13} /> {t('actions.delete')}
          </button>
        )}
        {conn && confirmDelete && (
          <span className="flex items-center gap-2 text-[12px] text-rose-200">
            {t('connections:editor.deleteConfirm')}
            <button className="btn h-7 bg-rose-600 text-white hover:bg-rose-500" onClick={() => void remove()} disabled={!!busy}>
              {t('actions.yesDelete')}
            </button>
            <button className="btn-ghost h-7" onClick={() => setConfirmDelete(false)}>
              {t('actions.cancel')}
            </button>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <button className="btn-ghost" onClick={onCancel}>
              {t('actions.cancel')}
            </button>
          )}
          <button className="btn-outline" onClick={() => void runTest()} disabled={!!busy || !form.host.trim()}>
            {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} {t('connections:editor.test')}
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={!!busy || (!!conn && !dirty)}>
            {busy === 'save' && <Loader2 size={13} className="animate-spin" />} {conn ? t('actions.save') : t('actions.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
        {hint && <div className="text-[11.5px] text-zinc-500">{hint}</div>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

/** Write-only secret input: shows whether one is stored, never its value. */
function SecretField({ label, has, value, onChange }: { label: string; has: boolean; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation(['common', 'connections'])
  const cleared = value === ''
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="new-password"
          className="input font-mono"
          value={value ?? ''}
          placeholder={has && !cleared ? t('connections:editor.auth.secretStored') : cleared ? t('connections:editor.auth.secretWillRemove') : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
        {has && (
          <button className="btn-ghost h-8 shrink-0 px-2 text-[11.5px]" title={t('connections:editor.auth.secretRemove')} onClick={() => onChange(cleared ? undefined : '')}>
            {cleared ? <RotateCcw size={12} /> : <Trash2 size={12} />}
          </button>
        )}
      </div>
    </Field>
  )
}

/* ───────────────────────────── access ───────────────────────────── */

function AccessPane({ conn }: { conn: Connection }) {
  const { t } = useTranslation(['common', 'connections'])
  const agents = useAppStore((s) => s.agents)
  const perms = useAppStore((s) => s.connPerms)
  const toast = useAppStore((s) => s.toast)
  const levelOf = (agentId: string): AccessLevel => perms.find((p) => p.connectionId === conn.id && p.agentId === agentId)?.level ?? 'none'
  const hints = LEVEL_HINT[isDb(conn.kind) ? 'db' : 'ssh']

  const setLevel = async (agentId: string, level: AccessLevel): Promise<void> => {
    try {
      await call('connections:setPermission', conn.id, agentId, level)
      await useAppStore.getState().refresh('connections')
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <p className="mb-3 text-[12px] text-zinc-400">
        <Trans t={t} i18nKey="connections:access.intro" components={{ b: <b className="text-zinc-200" /> }} />
      </p>
      <div className="card divide-y divide-line">
        {agents.map((a) => {
          const lvl = levelOf(a.id)
          return (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5" data-access-agent={a.name}>
              <PixelAvatar agent={a} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-zinc-200">{a.name}</div>
                <div className="truncate text-[11px] text-zinc-500">{lvl === 'none' ? a.role : hints[lvl]}</div>
              </div>
              <select
                className={cn('input h-7 w-40 text-[12px]', lvl !== 'none' && 'border-indigo-500/40 text-indigo-200')}
                value={lvl}
                onChange={(e) => void setLevel(a.id, e.target.value as AccessLevel)}
              >
                {LEVEL_ORDER.map((l) => (
                  <option key={l} value={l} title={hints[l]}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
      <div className="mt-4 space-y-1 text-[11.5px] text-zinc-500">
        {LEVEL_ORDER.filter((l) => l !== 'none').map((l) => (
          <div key={l}>
            <b className="text-zinc-400">{LEVEL_LABEL[l]}:</b> {hints[l]}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── schema ───────────────────────────── */

function SchemaPane({ conn }: { conn: Connection }) {
  const { t } = useTranslation(['common', 'connections'])
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    void call('connections:schema', conn.id)
      .then(setSchema)
      .catch((e) => setError(apiError(e)))
  }, [conn.id])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setSchema(await call('connections:schema', conn.id, true))
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const f = filter.trim().toLocaleLowerCase(locale())
  const tables = (schema?.tables ?? []).filter((x) => !f || `${x.schema}.${x.name} ${x.columns.map((c) => c.name).join(' ')}`.toLocaleLowerCase(locale()).includes(f))

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="text-[12px] text-zinc-400">
          {schema
            ? `${t('connections:schema.tables', { count: schema.tables.length })} · ${t('connections:schema.readAgo', { ago: timeAgo(schema.fetchedAt) })}${schema.truncated ? ` · ${t('connections:schema.truncated')}` : ''}`
            : t('connections:schema.notRead')}
        </div>
        <div className="relative ml-auto w-56">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input className="input h-7 pl-7 text-[12px]" placeholder={t('connections:schema.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn-outline h-7" disabled={busy} onClick={() => void refresh()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} {t('connections:schema.read')}
        </button>
      </div>
      {error && <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">{error}</div>}
      <p className="mb-3 text-[11.5px] text-zinc-500">{t('connections:schema.hint')}</p>
      <div className="card divide-y divide-line">
        {tables.map((tbl) => {
          const key = `${tbl.schema}.${tbl.name}`
          const isOpen = open.has(key)
          return (
            <div key={key}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02]"
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(key)) n.delete(key)
                    else n.add(key)
                    return n
                  })
                }
              >
                <ChevronRight size={12} className={cn('text-zinc-500 transition-transform', isOpen && 'rotate-90')} />
                <Table2 size={13} className="text-zinc-400" />
                <span className="font-mono text-[12px] text-zinc-200">{key}</span>
                {tbl.kind === 'view' && <span className="rounded bg-white/5 px-1 text-[10px] text-zinc-400">{t('connections:schema.view')}</span>}
                <span className="ml-auto text-[11px] text-zinc-500">{t('connections:schema.columns', { count: tbl.columns.length })}</span>
              </button>
              {isOpen && (
                <div className="bg-black/20 px-9 py-1.5">
                  {tbl.columns.map((c) => (
                    <div key={c.name} className="flex gap-3 py-0.5 font-mono text-[11.5px]">
                      <span className="text-zinc-300">{c.name}</span>
                      <span className="text-zinc-500">{c.type}</span>
                      {!c.nullable && <span className="text-[10px] text-amber-300/70">NOT NULL</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {schema && tables.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-zinc-500">{t('connections:schema.noMatch')}</div>}
      </div>
    </div>
  )
}
