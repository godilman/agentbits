import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, FolderOpen, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, languageName, resolveLanguage } from '@shared/i18n'
import type { Provider } from '@shared/types'
import { i18n } from '@/i18n'
import { Logo } from '@/components/common/Logo'
import { OfficeEngine } from '@/features/office/engine'
import { ProviderForm } from '@/features/settings/ProviderForm'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/** True for the name main gives the default project (in any language), i.e. the user hasn't named it yet. */
const isDefaultProjectName = (name: string): boolean => LANGUAGES.some((l) => i18n.t('main:defaults.project', { lng: l.code }) === name)

export function Onboarding() {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const providers = useAppStore((s) => s.providers)
  const settings = useAppStore((s) => s.settings)
  const [step, setStep] = useState<1 | 2>(providers.length ? 2 : 1)
  const [provider, setProvider] = useState<Provider | null>(providers.find((p) => p.isDefault) ?? null)
  const [workspace, setWorkspace] = useState(
    () => useAppStore.getState().projects.find((p) => p.isDefault)?.rootPath || settings.workspaceRoot
  )
  const [projectName, setProjectName] = useState(() => {
    const n = useAppStore.getState().projects.find((p) => p.isDefault)?.name
    return n && !isDefaultProjectName(n) ? n : ''
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // live office preview in the background
  const officeAgents = useMemo(
    () => agents.map((agent, i) => ({ agent: { ...agent, status: (['working', 'working', 'break', 'idle', 'working'] as const)[i % 5] }, paused: false, awaitingApproval: false, taskKey: null })),
    [agents]
  )
  useEffect(() => {
    const engine = new OfficeEngine(canvasRef.current!)
    engine.setAgents(officeAgents)
    engine.start()
    const ro = new ResizeObserver(([e]) => engine.resize(e.contentRect.width, e.contentRect.height))
    ro.observe(wrapRef.current!)
    return () => {
      ro.disconnect()
      engine.destroy()
    }
  }, [officeAgents])

  const finish = async (): Promise<void> => {
    // Folders are per project now: the chosen folder belongs to the default project.
    const def = useAppStore.getState().projects.find((p) => p.isDefault) ?? useAppStore.getState().projects[0]
    setBusy(true)
    setError(null)
    try {
      const name = projectName.trim() || t('onboarding:project.defaultName')
      if (def) await call('projects:save', { name, ...(workspace !== def.rootPath ? { rootPath: workspace } : {}) }, def.id)
      await call('settings:update', { onboarded: true, workspaceRoot: workspace })
      // Start in the project that was just set up, with the setup guide open.
      if (def) useAppStore.getState().openProject(def.id)
      useAppStore.getState().openGuide()
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex h-full">
      <div className="drag absolute inset-x-0 top-0 z-10 h-10" />
      <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="pixelated pointer-events-none absolute inset-0 opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-canvas" />
        <div className="absolute bottom-8 left-8 max-w-md">
          <div className="mb-2 flex items-center gap-2">
            <Logo size={26} />
            <span className="text-[20px] font-semibold tracking-tight text-zinc-100">Agentbits</span>
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-400">
            {t('onboarding:intro')}
          </p>
        </div>
      </div>

      <div className="flex w-[520px] shrink-0 flex-col justify-center border-l border-line bg-canvas/95 px-10">
        <div className="mb-6 flex items-center gap-3 text-[12px]">
          <StepDot n={1} active={step === 1} done={step > 1} label={t('onboarding:steps.provider')} />
          <span className="h-px w-8 bg-line" />
          <StepDot n={2} active={step === 2} done={false} label={t('onboarding:steps.project')} />
        </div>

        {step === 1 && (
          <div className="animate-fade-in">
            <LanguagePicker value={settings.language} onError={setError} />
            <h1 className="text-[20px] font-semibold text-zinc-100">{t('onboarding:provider.title')}</h1>
            <p className="mb-5 mt-1 text-[12.5px] text-zinc-400">{t('onboarding:provider.hint')}</p>
            {error && <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">{error}</div>}
            <ProviderForm
              compactCards
              onSaved={(p) => {
                setProvider(p)
                setStep(2)
              }}
            />
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <h1 className="text-[20px] font-semibold text-zinc-100">{t('onboarding:project.title')}</h1>
            <p className="mb-5 mt-1 text-[12.5px] text-zinc-400">{t('onboarding:project.hint')}</p>
            <label className="label">{t('onboarding:project.nameLabel')}</label>
            <input
              className="input mb-3"
              value={projectName}
              placeholder={t('onboarding:project.namePlaceholder')}
              onChange={(e) => setProjectName(e.target.value)}
              data-testid="onboarding-project-name"
            />
            <label className="label">{t('onboarding:project.folderLabel')}</label>
            <div className="card mb-4 flex items-center gap-3 p-3">
              <FolderOpen size={18} className="text-zinc-400" />
              <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-300">{workspace || t('onboarding:project.notSelected')}</div>
              <button
                className="btn-outline"
                onClick={async () => {
                  setError(null)
                  try {
                    const dir = await call('app:pickFolder')
                    if (!dir) return
                    const f = await call('projects:inspectFolder', dir)
                    if (f.isAppFolder) setError(t('onboarding:project.appFolderError'))
                    else if (f.tooBroad) setError(t('project:folderTooBroad'))
                    else setWorkspace(f.path)
                  } catch (e) {
                    setError(apiError(e))
                  }
                }}
              >
                {t('actions.chooseFolder')}
              </button>
            </div>
            {error && <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-200">{error}</div>}
            {provider && (
              <div className="mb-6 flex items-center gap-2 text-[12px] text-zinc-400">
                <Check size={14} className="text-emerald-400" /> {t('onboarding:project.provider')} <span className="text-zinc-300">{provider.label}</span>
                <button className="ml-auto text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline" onClick={() => setStep(1)}>
                  {t('onboarding:project.change')}
                </button>
              </div>
            )}
            <button
              className="btn-primary h-9 w-full text-[13px]"
              disabled={busy || (!workspace && !!provider && (provider.kind === 'claude-cli' || provider.kind === 'codex-cli'))}
              onClick={() => void finish()}
            >
              {t('onboarding:project.start')} <ArrowRight size={15} />
            </button>
            <p className="mt-3 text-center text-[11px] text-zinc-400">
              {agents.length ? t('onboarding:project.agentsReady', { count: agents.length }) : t('onboarding:project.noAgents')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Interface language; saved right away (main relabels its default names, the UI switches via settings). */
function LanguagePicker({ value, onError }: { value: string; onError: (msg: string | null) => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const change = async (language: string): Promise<void> => {
    setBusy(true)
    onError(null)
    try {
      const settings = await call('settings:update', { language })
      useAppStore.setState({ settings })
    } catch (e) {
      onError(apiError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-5 flex items-center gap-2">
      <Languages size={14} className="shrink-0 text-zinc-400" />
      <label className="text-[12px] text-zinc-400" htmlFor="onboarding-language">
        {t('language.label')}
      </label>
      <select
        id="onboarding-language"
        className="input h-7 w-auto text-[12px]"
        value={value || 'auto'}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        data-testid="onboarding-language"
      >
        <option value="auto">{t('language.auto', { name: languageName(resolveLanguage('auto', navigator.language)) })}</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <span className={cn('flex items-center gap-2', active ? 'text-zinc-200' : 'text-zinc-400')}>
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold',
          done ? 'bg-emerald-500/20 text-emerald-300' : active ? 'bg-indigo-500 text-white' : 'bg-white/5'
        )}
      >
        {done ? <Check size={11} /> : n}
      </span>
      {label}
    </span>
  )
}
