import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProviderKind } from '@shared/types'
import type { I18nKey } from '@shared/i18n'
import { LIVE_MODEL_KINDS, MODEL_CATALOG, type ModelOption } from '@shared/models'
import { call } from '@/lib/api'
import { cn } from '@/lib/format'
import { isLocalUrl } from '@shared/endpoints'

const INHERIT = '__inherit__'
const CUSTOM = '__custom__'

/**
 * Model dropdown for a provider kind: the curated catalog (with a short note per model), the account's live list for API
 * providers (fetched in main with the saved or just-typed key), and "Custom model name…" for anything newer.
 * `inheritLabel` adds a first option meaning "use the provider's model" (agent editor; value '' / null).
 */
export function ModelSelect({
  kind,
  value,
  onChange,
  providerId,
  apiKey,
  inheritLabel,
  disabled,
  testId,
  baseUrl
}: {
  kind: ProviderKind
  value: string
  onChange: (model: string) => void
  providerId?: string
  apiKey?: string
  /** OpenAI-compatible endpoint: its own /models list instead of the OpenAI catalog; a local server needs no key. */
  baseUrl?: string
  inheritLabel?: string
  disabled?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  // In the agent editor '' means "inherit"; the catalog's '' (CLI default) only makes sense for a provider.
  const catalog = useMemo(() => (baseUrl ? [] : MODEL_CATALOG[kind].filter((m) => !(inheritLabel && m.id === ''))), [kind, inheritLabel, baseUrl])
  const canLive = LIVE_MODEL_KINDS.includes(kind) && !!(providerId || apiKey?.trim() || (baseUrl && isLocalUrl(baseUrl)))
  const [live, setLive] = useState<{ id: string; label: string }[] | null>(null)
  const [liveState, setLiveState] = useState<{ loading: boolean; error?: string }>({ loading: false })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setLive(null)
    setLiveState({ loading: false })
    if (!canLive) return
    let cancelled = false
    // Debounced while a key is being typed.
    const timer = setTimeout(() => {
      setLiveState({ loading: true })
      call('providers:models', { kind, providerId, apiKey: apiKey?.trim() || undefined, baseUrl })
        .then((r) => {
          if (cancelled) return
          setLive(r.live)
          setLiveState({ loading: false, error: r.error })
        })
        .catch((e) => !cancelled && setLiveState({ loading: false, error: (e as Error).message }))
    }, apiKey ? 700 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [kind, providerId, apiKey, baseUrl, canLive, reload])

  const liveIds = useMemo(() => new Set(live?.map((m) => m.id) ?? []), [live])
  const extras = useMemo(() => (live ?? []).filter((m) => !catalog.some((c) => c.id === m.id)), [live, catalog])
  const known = (id: string): boolean => catalog.some((c) => c.id === id) || liveIds.has(id)

  const isInherit = !!inheritLabel && !value
  const [customMode, setCustomMode] = useState(() => !isInherit && !known(value))
  // A saved value that isn't in the lists (an older or newer model) is shown in the custom field, not lost.
  // Follow value changes from outside (form reset on kind change, live list arriving); picking "Custom…" itself
  // doesn't change the value, so it stays open.
  useEffect(() => {
    if (liveState.loading) return
    setCustomMode(!isInherit && !!value && !known(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, live])
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const selected = customMode ? CUSTOM : isInherit ? INHERIT : value

  const optionText = (m: ModelOption): string => {
    if (m.id === '') return t('settings:models.cliDefaultOption', { name: m.label })
    const note = m.note ? t(`settings:models.notes.${m.note}` as I18nKey) : ''
    const missing = live && !liveIds.has(m.id) ? ` · ${t('settings:models.notOnAccount')}` : ''
    return `${m.label}${note ? ' — ' + note : ''}${missing}`
  }

  const pick = (v: string): void => {
    if (v === CUSTOM) {
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    onChange(v === INHERIT ? '' : v)
  }

  return (
    <div className="space-y-1.5">
      <select className="input" value={selected} disabled={disabled} onChange={(e) => pick(e.target.value)} data-testid={testId}>
        {inheritLabel && <option value={INHERIT}>{inheritLabel}</option>}
        <optgroup label={t('settings:models.groups.recommended')}>
          {catalog.map((m) => (
            <option key={m.id || 'default'} value={m.id}>
              {optionText(m)}
            </option>
          ))}
        </optgroup>
        {extras.length > 0 && (
          <optgroup label={t('settings:models.groups.account')}>
            {extras.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label === m.id ? m.id : `${m.label} (${m.id})`}
              </option>
            ))}
          </optgroup>
        )}
        {kind !== 'mock' && <option value={CUSTOM}>{t('settings:models.custom')}</option>}
      </select>

      {customMode && (
        <input
          className="input font-mono text-[12px]"
          value={draft}
          autoFocus={!value}
          placeholder={t(`settings:models.customPlaceholder.${kind === 'mock' ? 'anthropic' : kind}` as I18nKey)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() !== value && onChange(draft.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid={testId ? `${testId}-custom` : undefined}
        />
      )}

      <div className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-400">
        <span className="min-w-0 flex-1">
          {customMode
            ? t('settings:models.customHint')
            : LIVE_MODEL_KINDS.includes(kind)
              ? !canLive
                ? t('settings:models.needKey')
                : liveState.loading
                  ? t('settings:models.loading')
                  : liveState.error
                    ? t('settings:models.liveError', { error: liveState.error })
                    : live
                      ? t('settings:models.liveOk', { count: live.length })
                      : null
              : kind === 'claude-cli' || kind === 'codex-cli'
                ? t('settings:models.cliAliases')
                : null}
          {kind === 'openai' && !customMode && <span className="block text-zinc-500">{t('settings:models.openaiNoGpt6')}</span>}
        </span>
        {canLive && (
          <button
            type="button"
            className="icon-btn h-5 w-5 shrink-0"
            title={t('settings:models.refresh')}
            aria-label={t('settings:models.refresh')}
            onClick={() => setReload((n) => n + 1)}
            disabled={liveState.loading}
          >
            {liveState.loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} className={cn(liveState.error && 'text-amber-300')} />}
          </button>
        )}
      </div>
    </div>
  )
}
