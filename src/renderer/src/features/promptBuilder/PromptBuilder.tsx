import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Loader2, RotateCcw, Wand2 } from 'lucide-react'
import { PROMPT_BUILDER_KINDS, PROMPT_BUILDER_MAX } from '@shared/promptBuilder'
import { Modal } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/** Top bar button; the dialog's content lives only while it is open (closing drops input, output and errors). */
export function PromptBuilderButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        data-testid="prompt-builder-button"
        className="icon-btn h-7 w-7"
        onClick={() => setOpen(true)}
        title={t('layout:promptBuilder.buttonTitle')}
        aria-label={t('layout:promptBuilder.button')}
      >
        <Wand2 size={15} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={620}
        title={
          <span className="flex items-center gap-2">
            <Wand2 size={15} className="text-indigo-300" /> {t('layout:promptBuilder.title')}
          </span>
        }
      >
        <PromptBuilderBody onOpenProviders={() => setOpen(false)} />
      </Modal>
    </>
  )
}

let seq = 0
const newRequestId = (): string => `pb-${Date.now().toString(36)}-${++seq}`

function PromptBuilderBody({ onOpenProviders }: { onOpenProviders: () => void }) {
  const { t } = useTranslation()
  const providers = useAppStore((s) => s.providers)
  const openSettings = useAppStore((s) => s.openSettings)
  const fallback = useMemo(() => providers.find((p) => p.isDefault) ?? providers[0] ?? null, [providers])
  const [providerId, setProviderId] = useState<string | null>(fallback?.id ?? null)
  const provider = providers.find((p) => p.id === providerId) ?? null
  const [text, setText] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // The request this dialog waits for; an answer for any other id (an earlier, cancelled one) is ignored.
  const current = useRef<string | null>(null)
  const outRef = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () => () => {
      if (current.current) void call('promptBuilder:cancel', current.current).catch(() => undefined)
      current.current = null
    },
    []
  )

  const canSend = !!text.trim() && !busy && !!provider
  const send = async (): Promise<void> => {
    if (!canSend) return
    const id = newRequestId()
    current.current = id
    setBusy(true)
    setError('')
    setOutput('')
    setCopied(false)
    try {
      const r = await call('promptBuilder:generate', id, text, provider?.id ?? null)
      if (current.current === id) setOutput(r.prompt)
    } catch (e) {
      if (current.current === id) setError(apiError(e))
    } finally {
      if (current.current === id) {
        current.current = null
        setBusy(false)
      }
    }
  }
  const copy = (): void => {
    navigator.clipboard.writeText(output).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => {
        outRef.current?.select()
        setError(t('layout:promptBuilder.copyFailed'))
      }
    )
  }

  if (!providers.length) {
    return (
      <div className="space-y-3 text-[13px] text-zinc-300">
        <p>{t('layout:promptBuilder.noProviders')}</p>
        <button
          className="btn-primary h-8"
          onClick={() => {
            onOpenProviders()
            openSettings('providers')
          }}
        >
          {t('layout:promptBuilder.openProviders')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="prompt-builder">
      <div className="text-[13px] leading-relaxed text-zinc-300">
        <p className="font-medium text-zinc-100">{t('layout:promptBuilder.welcome1')}</p>
        <p>{t('layout:promptBuilder.welcome2')}</p>
      </div>

      <label className="block text-[12px] text-zinc-400" htmlFor="prompt-builder-input">
        {t('layout:promptBuilder.inputLabel')}
      </label>
      <textarea
        id="prompt-builder-input"
        data-testid="prompt-builder-input"
        autoFocus
        className="input min-h-[110px] w-full resize-y py-2 text-[13px] leading-relaxed"
        value={text}
        maxLength={PROMPT_BUILDER_MAX}
        placeholder={t('layout:promptBuilder.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-zinc-400" htmlFor="prompt-builder-provider">
          {t('layout:promptBuilder.provider')}
        </label>
        <select
          id="prompt-builder-provider"
          data-testid="prompt-builder-provider"
          className="input h-8 min-w-0 max-w-[300px] flex-1 text-[13px]"
          value={providerId ?? ''}
          disabled={busy}
          onChange={(e) => setProviderId(e.target.value || null)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.model ? ` · ${p.model}` : ''}
              {p.isDefault ? ` (${t('layout:promptBuilder.defaultTag')})` : ''}
              {PROMPT_BUILDER_KINDS.includes(p.kind) ? '' : ` — ${t('layout:promptBuilder.notUsable')}`}
            </option>
          ))}
        </select>
        <button data-testid="prompt-builder-generate" className="btn-primary ml-auto h-8" disabled={!canSend} onClick={() => void send()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {busy ? t('layout:promptBuilder.generating') : t('layout:promptBuilder.generate')}
        </button>
      </div>

      {error && (
        <div data-testid="prompt-builder-error" role="alert" className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
          <span className="min-w-0 flex-1">{error}</span>
          {!busy && text.trim() && (
            <button data-testid="prompt-builder-retry" className="btn-ghost h-6 shrink-0 px-2 text-[12px]" onClick={() => void send()}>
              <RotateCcw size={11} /> {t('layout:promptBuilder.retry')}
            </button>
          )}
        </div>
      )}

      {output && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-y-1">
            <span className="min-w-0 text-[12px] text-zinc-400">{t('layout:promptBuilder.output')}</span>
            <button data-testid="prompt-builder-copy" className={cn('btn-ghost h-6 px-2 text-[12px]', copied && 'text-emerald-300')} onClick={copy}>
              {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? t('layout:promptBuilder.copied') : t('layout:promptBuilder.copy')}
            </button>
          </div>
          <textarea
            ref={outRef}
            readOnly
            data-testid="prompt-builder-output"
            className="selectable input min-h-[140px] w-full resize-y py-2 font-mono text-[12px] leading-relaxed"
            value={output}
          />
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-zinc-400">
        {t('layout:promptBuilder.privacy')}
        {provider?.kind === 'claude-cli' ? ` ${t('layout:promptBuilder.cliNote')}` : ''}
      </p>
    </div>
  )
}
