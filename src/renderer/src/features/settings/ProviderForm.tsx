import { useEffect, useState } from 'react'
import { Bot, KeyRound, Loader2, Sparkles, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Provider, ProviderKind } from '@shared/types'
import { t } from '@/i18n'
import { call } from '@/lib/api'
import { cn } from '@/lib/format'
import { DEFAULT_MODEL } from '@shared/models'
import { ModelSelect } from './ModelSelect'
import { checkBaseUrl, ENDPOINTS, type EndpointPreset } from '@shared/endpoints'

export const PROVIDER_KINDS: { kind: ProviderKind; title: string; desc: string; model: string; needsKey: boolean; cli: boolean }[] = [
  { kind: 'claude-cli', title: 'Claude Code CLI', get desc() { return t('settings:providers.kinds.claudeCli') }, model: DEFAULT_MODEL['claude-cli'], needsKey: false, cli: true },
  { kind: 'anthropic', title: 'Anthropic API', get desc() { return t('settings:providers.kinds.anthropic') }, model: DEFAULT_MODEL.anthropic, needsKey: true, cli: false },
  { kind: 'openai', title: 'OpenAI API', get desc() { return t('settings:providers.kinds.openai') }, model: DEFAULT_MODEL.openai, needsKey: true, cli: false },
  { kind: 'codex-cli', title: 'Codex CLI', get desc() { return t('settings:providers.kinds.codexCli') }, model: DEFAULT_MODEL['codex-cli'], needsKey: false, cli: true },
  {
    kind: 'mock',
    get title() { return t('settings:providers.kinds.mockTitle') },
    get desc() { return t('settings:providers.kinds.mock') },
    model: DEFAULT_MODEL.mock,
    needsKey: false,
    cli: false
  }
]

// Returns a user-facing message for an invalid API key, or null when it looks valid.
function validateApiKey(_kind: ProviderKind, value: string): string | null {
  const v = value.trim()
  if (!v) return t('settings:providers.form.apiKeyRequired')
  if (/\s/.test(v)) return t('settings:providers.form.apiKeyNoSpaces')
  return null
}

export function KindIcon({ kind, size = 16 }: { kind: ProviderKind; size?: number }) {
  if (kind === 'mock') return <Sparkles size={size} className="text-amber-300" />
  if (kind.endsWith('cli')) return <SquareTerminal size={size} className="text-emerald-300" />
  if (kind === 'anthropic') return <Bot size={size} className="text-orange-300" />
  return <KeyRound size={size} className="text-sky-300" />
}

export function ProviderForm({ onSaved, compactCards = false, initialKind = 'claude-cli' }: { onSaved: (p: Provider) => void; compactCards?: boolean; initialKind?: ProviderKind }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<ProviderKind>(initialKind)
  const meta = PROVIDER_KINDS.find((k) => k.kind === kind)!
  const [model, setModel] = useState(meta.model)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyTouched, setApiKeyTouched] = useState(false)
  const [cliPath, setCliPath] = useState('')
  const [detected, setDetected] = useState<{ claude: string | null; codex: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  // OpenAI kind: OpenAI itself or an OpenAI-compatible endpoint (Gemini, Ollama, LM Studio, custom address).
  const [endpoint, setEndpoint] = useState<EndpointPreset>('openai')
  const [customUrl, setCustomUrl] = useState('')
  const preset = ENDPOINTS.find((e) => e.id === endpoint)!
  const compat = kind === 'openai' && endpoint !== 'openai'
  const baseUrl = kind !== 'openai' ? '' : endpoint === 'custom' ? customUrl.trim() : preset.url
  const urlCheck = checkBaseUrl(baseUrl)
  const needsKey = meta.needsKey && (kind !== 'openai' || preset.needsKey)

  useEffect(() => {
    setModel(compat ? preset.model : meta.model)
    setResult(null)
    setApiKeyTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, meta.model, endpoint])

  // An optional key is only checked when one was typed.
  const apiKeyError = needsKey || apiKey ? validateApiKey(kind, apiKey) : null
  const urlError = compat && !urlCheck.ok ? t(urlCheck.reason === 'insecure' ? 'settings:providers.endpoint.insecure' : 'settings:providers.endpoint.invalid') : null
  const blocked = (needsKey && apiKeyError !== null) || (!needsKey && !!apiKey && apiKeyError !== null) || !!urlError || (compat && (!baseUrl || !model.trim()))
  // Show the error once the user has typed or left the field; stay quiet on a pristine form.
  const showApiKeyError = apiKeyError !== null && (apiKeyTouched || apiKey.length > 0)

  useEffect(() => {
    void call('providers:detectCli').then(setDetected)
  }, [])

  const detectedPath = kind === 'claude-cli' ? detected?.claude : kind === 'codex-cli' ? detected?.codex : null

  const save = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const host = (() => {
        try {
          return new URL(baseUrl).host
        } catch {
          return baseUrl
        }
      })()
      const p = await call('providers:save', {
        kind,
        model,
        apiKey: meta.needsKey && apiKey ? apiKey : undefined,
        cliPath: meta.cli ? cliPath || null : null,
        ...(compat ? { baseUrl, label: endpoint === 'custom' ? host : t(`settings:providers.endpoint.presets.${endpoint}`) } : {}),
        isDefault: true
      })
      const test = await call('providers:test', p.id)
      setResult(test)
      if (test.ok) onSaved(p)
      else await call('providers:delete', p.id) // don't keep a broken default around
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-2', compactCards ? 'grid-cols-2' : 'grid-cols-2')}>
        {PROVIDER_KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => setKind(k.kind)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              kind === k.kind ? 'border-indigo-500/50 bg-indigo-500/[0.07] ring-1 ring-indigo-500/20' : 'border-line bg-surface hover:border-zinc-700'
            )}
          >
            <div className="flex items-center gap-2">
              <KindIcon kind={k.kind} />
              <span className="text-[12.5px] font-medium text-zinc-100">{k.title}</span>
            </div>
            {!compactCards && <div className="mt-1.5 text-[11.5px] leading-snug text-zinc-400">{k.desc}</div>}
            {(k.kind === 'claude-cli' || k.kind === 'codex-cli') && detected && (
              <div className={cn('mt-1.5 text-[10.5px]', (k.kind === 'claude-cli' ? detected.claude : detected.codex) ? 'text-emerald-400' : 'text-zinc-400')}>
                {(k.kind === 'claude-cli' ? detected.claude : detected.codex) ? t('settings:providers.form.installed') : t('settings:providers.form.notFound')}
              </div>
            )}
          </button>
        ))}
      </div>

      {compactCards && <div className="text-[12px] leading-relaxed text-zinc-400">{meta.desc}</div>}

      <div className="grid grid-cols-2 gap-3">
        {kind === 'openai' && (
          <div className="col-span-2">
            <label className="label" htmlFor="provider-endpoint">{t('settings:providers.endpoint.label')}</label>
            <select id="provider-endpoint" data-testid="provider-endpoint" className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value as EndpointPreset)}>
              {ENDPOINTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {t(`settings:providers.endpoint.presets.${e.id}`)}
                </option>
              ))}
            </select>
            {endpoint === 'custom' && (
              <input
                className={cn('input mt-1.5 font-mono text-[12px]', urlError && 'border-rose-500/50')}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://…/v1"
              />
            )}
            {urlError && endpoint === 'custom' && customUrl.trim() && <div className="mt-1 text-[11px] text-rose-300">{urlError}</div>}
            <div className="mt-1 text-[11px] text-zinc-400">{t(`settings:providers.endpoint.hints.${endpoint}`)}</div>
          </div>
        )}
        {meta.needsKey && (needsKey || compat) && (
          <div className="col-span-2">
            <label className="label" htmlFor="provider-api-key">{t('settings:providers.form.apiKey')}</label>
            <input
              id="provider-api-key"
              type="password"
              className={cn('input font-mono', showApiKeyError && 'border-rose-500/50 focus:border-rose-500/70')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => setApiKeyTouched(true)}
              placeholder={kind === 'anthropic' ? 'sk-ant-…' : compat ? (needsKey ? '' : t('settings:providers.endpoint.keyOptional')) : 'sk-…'}
              aria-invalid={showApiKeyError}
              aria-describedby={showApiKeyError ? 'provider-api-key-error' : undefined}
              autoFocus
            />
            {showApiKeyError && (
              <div id="provider-api-key-error" role="alert" className="mt-1 text-[11px] text-rose-300">
                {apiKeyError}
              </div>
            )}
            <div className="mt-1 text-[11px] text-zinc-400">{t('settings:providers.form.apiKeyHint')}</div>
          </div>
        )}
        {meta.cli && (
          <div className="col-span-2">
            <label className="label">{t('settings:providers.form.cliPath')}</label>
            <input className="input font-mono text-[12px]" value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder={detectedPath ?? (kind === 'claude-cli' ? 'claude' : 'codex')} />
            <div className="mt-1 text-[11px] text-zinc-400">
              {kind === 'claude-cli'
                ? t('settings:providers.form.claudeLogin')
                : t('settings:providers.form.codexLogin')}
            </div>
          </div>
        )}
        {kind !== 'mock' && (
          <div className="col-span-2">
            <label className="label">{t('settings:providers.form.model')}</label>
            <ModelSelect
              key={`${kind}:${endpoint}`}
              kind={kind}
              value={model}
              onChange={setModel}
              apiKey={meta.needsKey && apiKey && !apiKeyError ? apiKey : undefined}
              baseUrl={compat && urlCheck.ok ? baseUrl : undefined}
              testId="provider-model"
            />
          </div>
        )}
      </div>

      {result && (
        <div className={cn('rounded-md border px-3 py-2 text-[12px]', result.ok ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200' : 'border-rose-500/25 bg-rose-500/[0.06] text-rose-200')}>
          {result.message}
        </div>
      )}

      <div className="flex justify-end">
        <button className="btn-primary h-8 px-4" disabled={busy || blocked} onClick={() => void save()}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          {kind === 'mock' ? t('settings:providers.form.continueDemo') : t('settings:providers.form.saveTest')}
        </button>
      </div>
    </div>
  )
}
