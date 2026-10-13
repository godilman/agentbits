import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '@/i18n'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { Sidebar } from '@/components/layout/Sidebar'
import { StatusBar } from '@/components/layout/StatusBar'
import { Logo } from '@/components/common/Logo'
import { TABS, TopBar } from '@/components/layout/TopBar'
import { Toasts } from '@/components/layout/Toasts'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { BrowserView } from '@/features/browser/BrowserView'
import { ChatView } from '@/features/chat/ChatView'
import { DecisionsView } from '@/features/decisions/DecisionsView'
import { OfficeView } from '@/features/office/OfficeView'
import { OrgView } from '@/features/org/OrgView'
import { ProjectHome, ProjectLauncher } from '@/features/project/ProjectLauncher'
import { ProjectModal } from '@/features/project/ProjectModal'
import { ApprovalsDock } from '@/features/connections/ApprovalsDock'
import { FilePreviewModal } from '@/features/files/FilePreviewModal'
import { FilesView } from '@/features/files/FilesView'
import { GuideDrawer } from '@/features/guide/GuideDrawer'
import { ProjectTeamView } from '@/features/project/ProjectTeamView'
import { ReportsView } from '@/features/reports/ReportsView'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { NewTaskModal } from '@/features/tasks/NewTaskModal'
import { TasksView } from '@/features/tasks/TasksView'
import { TerminalView } from '@/features/terminal/TerminalView'
import { useAppStore } from '@/store/useAppStore'

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const onboarded = useAppStore((s) => s.settings.onboarded)
  const tab = useAppStore((s) => s.tab)
  const view = useAppStore((s) => s.view)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const init = useAppStore((s) => s.init)
  const initError = useAppStore((s) => s.initError)
  const language = useAppStore((s) => s.settings.language)
  // Subscribing here re-renders the whole tree when the language changes.
  const { t } = useTranslation()

  useEffect(() => {
    setLanguage(language)
  }, [language])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F1') {
        e.preventDefault()
        const st = useAppStore.getState()
        if (st.ready && st.settings.onboarded) st.toggleGuide()
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const st = useAppStore.getState()
      if ((e.key === 'p' || e.key === 'P') && !e.shiftKey) {
        // Ctrl+P belongs to the shell inside the terminal.
        if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return
        e.preventDefault()
        if (st.ready && st.settings.onboarded) st.openLauncher()
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        st.cycleProject(e.shiftKey ? -1 : 1)
        return
      }
      if (e.shiftKey) return
      const hit = TABS.find((x) => x.key === e.key)
      if (hit) {
        e.preventDefault()
        st.setTab(hit.id)
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        st.showOrg()
      } else if (e.key === ',') st.openSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="drag absolute inset-x-0 top-0 h-10" />
        <Logo size={40} />
        {initError ? (
          <>
            <div className="text-[13px] text-zinc-200">{t('layout:app.loadFailed')}</div>
            <div className="selectable max-w-md text-center text-[12px] text-rose-300">{initError}</div>
            <button className="btn-primary mt-1" onClick={() => void init()}>
              {t('layout:app.retry')}
            </button>
          </>
        ) : (
          <div className="text-[12px] text-zinc-400">{t('layout:app.opening')}</div>
        )}
      </div>
    )
  }
  if (!onboarded) return <Onboarding />

  const inProject = view === 'project' && !!activeProjectId

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {activeProjectId && <Sidebar />}
        <main className="relative min-w-0 flex-1 bg-canvas">
          <ErrorBoundary resetKey={`${view}:${activeProjectId}:${tab}`}>
            {view === 'org' && <OrgView />}
            {view === 'project' && !activeProjectId && <ProjectHome />}
            {/* Project sections. Office, terminal & browser stay mounted so canvas / shells / webview keep their state. */}
            <div className={inProject && tab === 'office' ? 'h-full' : 'hidden'}>
              <OfficeView active={inProject && tab === 'office'} />
            </div>
            <div className={inProject && tab === 'terminal' ? 'h-full' : 'hidden'}>
              <TerminalView active={inProject && tab === 'terminal'} />
            </div>
            <div className={inProject && tab === 'browser' ? 'h-full' : 'hidden'}>
              <BrowserView />
            </div>
            {inProject && tab === 'chat' && <ChatView />}
            {inProject && tab === 'team' && <ProjectTeamView />}
            {inProject && tab === 'tasks' && <TasksView />}
            {inProject && tab === 'reports' && <ReportsView />}
            {inProject && tab === 'decisions' && <DecisionsView />}
            {inProject && tab === 'files' && <FilesView />}
          </ErrorBoundary>
        </main>
        {/* Setup guide: a side panel that narrows the content instead of covering it. */}
        <GuideDrawer />
      </div>
      <StatusBar />
      <SettingsPanel />
      <NewTaskModal />
      <ProjectModal />
      <ProjectLauncher />
      <ApprovalsDock />
      <FilePreviewModal />
      <Toasts />
    </div>
  )
}
