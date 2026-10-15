import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'
import { Heading, Row } from './parts'

type NumKey = 'runMaxMinutes' | 'runMaxTokens' | 'runMaxCostUsd'

/** A number setting saved when the field loses focus; empty or 0 = no limit. */
function LimitInput({ k, step, suffix }: { k: NumKey; step: number; suffix: string }) {
  const { t } = useTranslation()
  const value = useAppStore((s) => s.settings[k])
  const toast = useAppStore((s) => s.toast)
  const [draft, setDraft] = useState(value ? String(value) : '')
  useEffect(() => setDraft(value ? String(value) : ''), [value])
  const save = (): void => {
    const n = draft.trim() === '' ? 0 : Number(draft.replace(',', '.'))
    if (n === value) return
    call('settings:update', { [k]: n } as Partial<AppSettings>).catch((e) => {
      toast('error', apiError(e))
      setDraft(value ? String(value) : '')
    })
  }
  return (
    <div className="flex items-center gap-2">
      <input
        data-testid={`limit-${k}`}
        className="input h-7 w-28 text-right text-[12px]"
        inputMode="decimal"
        min={0}
        step={step}
        type="number"
        placeholder={t('settings:limits.none')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="w-12 text-[11.5px] text-zinc-400">{suffix}</span>
    </div>
  )
}

const AUDIT_DAYS = [30, 90, 180, 365, 0]

export function LimitsSection() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const toast = useAppStore((s) => s.toast)
  const [env, setEnv] = useState(settings.cliEnvPassthrough.join(', '))
  useEffect(() => setEnv(settings.cliEnvPassthrough.join(', ')), [settings.cliEnvPassthrough])
  const update = (patch: Partial<AppSettings>): Promise<void> =>
    call('settings:update', patch).then(
      () => undefined,
      (e) => toast('error', apiError(e))
    )
  const envNames = env
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean)
  const envDirty = envNames.join(',') !== settings.cliEnvPassthrough.join(',')

  return (
    <>
      <Heading title={t('settings:limits.title')} desc={t('settings:limits.desc')} />
      <div className="panel-title mb-2">{t('settings:limits.run.title')}</div>
      <div className="card mb-6 divide-y divide-line">
        <Row title={t('settings:limits.run.minutes')} desc={t('settings:limits.run.minutesDesc')}>
          <LimitInput k="runMaxMinutes" step={5} suffix={t('settings:limits.unit.minutes')} />
        </Row>
        <Row title={t('settings:limits.run.tokens')} desc={t('settings:limits.run.tokensDesc')}>
          <LimitInput k="runMaxTokens" step={10000} suffix={t('settings:limits.unit.tokens')} />
        </Row>
        <Row title={t('settings:limits.run.cost')} desc={t('settings:limits.run.costDesc')}>
          <LimitInput k="runMaxCostUsd" step={0.5} suffix="USD" />
        </Row>
      </div>

      <div className="panel-title mb-2">{t('settings:limits.privacy.title')}</div>
      <div className="card mb-6 divide-y divide-line">
        <Row title={t('settings:limits.privacy.audit')} desc={t('settings:limits.privacy.auditDesc')}>
          <select
            data-testid="limit-audit-retention"
            className="input h-7 w-32 text-[12px]"
            value={settings.auditRetentionDays}
            onChange={(e) => void update({ auditRetentionDays: Number(e.target.value) })}
          >
            {AUDIT_DAYS.map((d) => (
              <option key={d} value={d}>
                {d ? t('settings:data.retention.days', { count: d }) : t('settings:data.retention.forever')}
              </option>
            ))}
          </select>
        </Row>
        <Row title={t('settings:limits.privacy.redact')} desc={t('settings:limits.privacy.redactDesc')}>
          <span className="text-[11.5px] text-emerald-300">{t('settings:limits.privacy.always')}</span>
        </Row>
      </div>

      <div className="panel-title mb-2">{t('settings:limits.env.title')}</div>
      <div className="card px-5 py-4">
        <p className="text-[12px] text-zinc-400">{t('settings:limits.env.desc')}</p>
        <div className="mt-3 flex items-start gap-2">
          <textarea
            data-testid="limit-env"
            className="textarea min-h-[34px] flex-1 font-mono text-[12px]"
            rows={2}
            placeholder={t('settings:limits.env.placeholder')}
            value={env}
            onChange={(e) => setEnv(e.target.value)}
          />
          <button className="btn-primary h-8" disabled={!envDirty} onClick={() => void update({ cliEnvPassthrough: envNames })}>
            {t('actions.save')}
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-zinc-400">{t('settings:limits.env.never')}</p>
      </div>
    </>
  )
}
