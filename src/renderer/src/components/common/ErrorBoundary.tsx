import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface State {
  error: Error | null
}

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Agentbits] view crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle size={22} className="text-rose-400" />
      <div className="text-[13px] font-medium text-zinc-200">{t('layout:errorBoundary.title')}</div>
      <pre className="selectable max-w-xl whitespace-pre-wrap rounded-md border border-line bg-surface p-3 text-left font-mono text-[12px] text-rose-200">
        {error.message}
      </pre>
      <button className="btn-outline" onClick={onRetry}>
        {t('layout:errorBoundary.retry')}
      </button>
    </div>
  )
}
