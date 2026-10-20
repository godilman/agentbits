import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react'

interface WebviewEl extends HTMLElement {
  loadURL: (u: string) => Promise<void>
  goBack: () => void
  goForward: () => void
  reload: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
}

const HOME = 'https://code.claude.com/docs/en/overview'
const BOOKMARKS = [
  { label: 'Claude Code Docs', url: 'https://code.claude.com/docs/en/overview' },
  { label: 'Anthropic Docs', url: 'https://docs.claude.com' },
  { label: 'OpenAI Docs', url: 'https://platform.openai.com/docs' },
  { label: 'GitHub', url: 'https://github.com' }
]

export function BrowserView() {
  const ref = useRef<WebviewEl>(null)
  const [url, setUrl] = useState(HOME)
  const [input, setInput] = useState(HOME)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onNav = (): void => {
      const u = wv.getURL()
      setUrl(u)
      setInput(u)
    }
    const start = (): void => setLoading(true)
    const stop = (): void => setLoading(false)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-start-loading', start)
    wv.addEventListener('did-stop-loading', stop)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-start-loading', start)
      wv.removeEventListener('did-stop-loading', stop)
    }
  }, [])

  const go = (raw: string): void => {
    let u = raw.trim()
    if (!u) return
    if (!/^https?:\/\//.test(u)) u = u.includes('.') && !u.includes(' ') ? `https://${u}` : `https://duckduckgo.com/?q=${encodeURIComponent(u)}`
    setUrl(u)
    setInput(u)
    void ref.current?.loadURL(u).catch(() => undefined)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line bg-[#0c0c0e] px-3 py-2">
        <button className="icon-btn h-7 w-7" onClick={() => ref.current?.goBack()}>
          <ArrowLeft size={14} />
        </button>
        <button className="icon-btn h-7 w-7" onClick={() => ref.current?.goForward()}>
          <ArrowRight size={14} />
        </button>
        <button className="icon-btn h-7 w-7" onClick={() => ref.current?.reload()}>
          <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="relative flex-1">
          <Globe size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input className="input h-7 pl-8 font-mono text-[13px]" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(input)} />
        </div>
        <div className="flex gap-1">
          {BOOKMARKS.map((b) => (
            <button key={b.url} className="btn-ghost h-7 text-[12px]" onClick={() => go(b.url)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <webview ref={ref as React.Ref<HTMLElement>} src={HOME} data-url={url} partition="persist:agentbits-browser" className="min-h-0 flex-1 bg-white" />
    </div>
  )
}
