import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MemoryGraph, MemoryKind, MemoryNodeType } from '@shared/types'
import { call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { KindBadge, MemoryEditor, TopicChips } from './parts'

type GNode = MemoryGraph['nodes'][number] & { x: number; y: number; vx: number; vy: number; deg: number }

const TYPE_COLOR: Record<MemoryNodeType, string> = {
  you: '#f472b6',
  memory: '#a1a1aa',
  topic: '#fbbf24',
  task: '#60a5fa',
  decision: '#34d399',
  agent: '#a78bfa',
  chat: '#94a3b8'
}
const KIND_COLOR: Record<MemoryKind, string> = {
  preference: '#f9a8d4',
  fact: '#7dd3fc',
  decision: '#6ee7b7',
  context: '#d4d4d8',
  summary: '#c4b5fd'
}
const TYPES: MemoryNodeType[] = ['you', 'memory', 'topic', 'task', 'decision', 'agent', 'chat']

const color = (n: GNode): string => (n.type === 'memory' && n.kind ? KIND_COLOR[n.kind] : TYPE_COLOR[n.type])
const radius = (n: GNode): number => (n.type === 'memory' ? 4.5 + Math.min(n.deg, 6) * 0.5 : n.type === 'you' ? 11 : 6.5 + Math.min(n.deg, 12) * 0.5)

/**
 * The memory graph: memories and what they link to (topics, tasks, decisions, agents, where they were learned, you).
 * ponytail: O(n²) force layout on a canvas, fine for the GRAPH_MAX (300) memories main sends; a quadtree if it grows.
 */
export function MemoryGraphView() {
  const { t } = useTranslation()
  const version = useAppStore((s) => s.memoryVersion)
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<MemoryNodeType>>(new Set())
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const nodes = useRef<GNode[]>([])
  const edgesRef = useRef<MemoryGraph['edges']>([])
  const view = useRef({ x: 0, y: 0, k: 1 })
  const alpha = useRef(1)
  // Until the user pans or zooms, the view follows the layout so the whole graph stays in sight.
  const autoFit = useRef(true)
  const frame = useRef(0)
  const drawRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    void call('memory:graph').then(setGraph)
  }, [version])

  // (Re)build the simulation; nodes that were already there keep their place.
  useEffect(() => {
    if (!graph) return
    const old = new Map(nodes.current.map((n) => [n.id, n]))
    edgesRef.current = graph.edges
    const deg = new Map<string, number>()
    for (const e of graph.edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1)
    nodes.current = graph.nodes.map((n, i) => {
      const o = old.get(n.id)
      const a = i * 2.399963 // golden angle: an even first spread
      const r = 30 * Math.sqrt(i + 1)
      return { ...n, x: o?.x ?? Math.cos(a) * r, y: o?.y ?? Math.sin(a) * r, vx: 0, vy: 0, deg: deg.get(n.id) ?? 0 }
    })
    alpha.current = old.size ? 0.4 : 1
    if (!old.size) autoFit.current = true
    if (selected && !graph.nodes.some((n) => n.id === selected)) setSelected(null)
    kick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const q = query.trim().toLocaleLowerCase('tr')
  const matches = useCallback((n: { label: string; text?: string }) => !q || `${n.label} ${n.text ?? ''}`.toLocaleLowerCase('tr').includes(q), [q])
  const visible = useCallback((id: string) => !hidden.has((byId.get(id)?.type ?? 'memory') as MemoryNodeType), [hidden, byId])

  const step = (): void => {
    const ns = nodes.current
    const edges = edgesRef.current
    const idx = new Map(ns.map((n, i) => [n.id, i]))
    const a = alpha.current
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i]
      for (let j = i + 1; j < ns.length; j++) {
        const o = ns[j]
        let dx = p.x - o.x
        let dy = p.y - o.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) (dx = Math.random() - 0.5), (dy = Math.random() - 0.5), (d2 = 0.25)
        if (d2 > 160_000) continue
        const f = (1600 * a) / d2
        p.vx += dx * f
        p.vy += dy * f
        o.vx -= dx * f
        o.vy -= dy * f
      }
    }
    for (const e of edges) {
      const s = ns[idx.get(e.from) ?? -1]
      const d = ns[idx.get(e.to) ?? -1]
      if (!s || !d) continue
      const dx = d.x - s.x
      const dy = d.y - s.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const f = ((dist - (e.kind === 'supersedes' ? 55 : 95)) / dist) * 0.06 * a
      s.vx += dx * f
      s.vy += dy * f
      d.vx -= dx * f
      d.vy -= dy * f
    }
    for (const n of ns) {
      // Loose dots (no links) would drift off: pull them in harder.
      const pull = n.deg ? 0.004 : 0.02
      n.vx -= n.x * pull * a
      n.vy -= n.y * pull * a
      n.vx *= 0.6
      n.vy *= 0.6
      n.x += Math.max(-20, Math.min(20, n.vx))
      n.y += Math.max(-20, Math.min(20, n.vy))
    }
    alpha.current *= 0.985
  }

  drawRef.current = () => {
    const c = canvas.current
    const box = wrap.current
    if (!c || !box) return
    const dpr = window.devicePixelRatio || 1
    const w = box.clientWidth
    const h = box.clientHeight
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    }
    const g = c.getContext('2d')
    if (!g) return
    const v = view.current
    if (autoFit.current && nodes.current.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of nodes.current) (x0 = Math.min(x0, n.x)), (y0 = Math.min(y0, n.y)), (x1 = Math.max(x1, n.x + 16 + Math.min(n.label.length, 42) * 7.2)), (y1 = Math.max(y1, n.y))
      v.k = Math.max(0.25, Math.min(1.8, (w - 80) / (x1 - x0 || 1), (h - 140) / (y1 - y0 || 1)))
      v.x = -((x0 + x1) / 2) * v.k
      v.y = -((y0 + y1) / 2) * v.k + 20
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.translate(w / 2 + v.x, h / 2 + v.y)
    g.scale(v.k, v.k)
    const ns = nodes.current
    const at = new Map(ns.map((n) => [n.id, n]))
    const focus = selected ?? hover
    const near = new Set<string>()
    if (focus) for (const e of graph?.edges ?? []) if (e.from === focus || e.to === focus) near.add(e.from).add(e.to)
    const dim = (n: GNode): boolean => (!!q && !matches(n)) || (!!focus && near.size > 0 && !near.has(n.id))
    for (const e of graph?.edges ?? []) {
      const s = at.get(e.from)
      const d = at.get(e.to)
      if (!s || !d || !visible(s.id) || !visible(d.id)) continue
      const lit = focus && (e.from === focus || e.to === focus)
      g.globalAlpha = lit ? 0.9 : dim(s) || dim(d) ? 0.06 : 0.28
      g.strokeStyle = e.kind === 'supersedes' ? '#f87171' : lit ? '#e4e4e7' : '#71717a'
      g.lineWidth = (lit ? 1.4 : 0.8) / v.k
      g.setLineDash(e.kind === 'supersedes' ? [4 / v.k, 3 / v.k] : [])
      g.beginPath()
      g.moveTo(s.x, s.y)
      g.lineTo(d.x, d.y)
      g.stroke()
    }
    g.setLineDash([])
    for (const n of ns) {
      if (!visible(n.id)) continue
      const r = radius(n)
      g.globalAlpha = dim(n) ? 0.15 : n.faded ? 0.4 : 1
      g.fillStyle = color(n)
      g.beginPath()
      g.arc(n.x, n.y, r, 0, Math.PI * 2)
      g.fill()
      if (n.id === selected || n.id === hover) {
        g.strokeStyle = '#fafafa'
        g.lineWidth = 2 / v.k
        g.stroke()
      }
      const label = n.type !== 'memory' || v.k > 1.3 || n.id === focus || near.has(n.id) || (!!q && matches(n))
      if (label) {
        const text = n.type === 'you' ? t('org:memory.you') : n.label.length > 42 ? n.label.slice(0, 41) + '…' : n.label
        g.font = `${(n.type === 'memory' ? 10.5 : 11.5) / v.k}px system-ui, sans-serif`
        g.fillStyle = n.type === 'memory' ? '#d4d4d8' : '#f4f4f5'
        g.globalAlpha = dim(n) ? 0.2 : 0.95
        g.fillText(text, n.x + r + 3 / v.k, n.y + 3.5 / v.k)
      }
    }
    g.globalAlpha = 1
  }

  const kick = (): void => {
    if (frame.current) return
    const loop = (): void => {
      if (alpha.current > 0.02) step()
      drawRef.current()
      frame.current = alpha.current > 0.02 ? requestAnimationFrame(loop) : 0
    }
    frame.current = requestAnimationFrame(loop)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  useEffect(() => drawRef.current(), [selected, hover, hidden, q])
  useEffect(() => {
    const box = wrap.current
    if (!box) return
    const ro = new ResizeObserver(() => drawRef.current())
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // Pointer → world coordinates; pan by dragging the background, zoom with the wheel.
  const toWorld = (cx: number, cy: number): { x: number; y: number } => {
    const box = wrap.current!.getBoundingClientRect()
    const v = view.current
    return { x: (cx - box.left - box.width / 2 - v.x) / v.k, y: (cy - box.top - box.height / 2 - v.y) / v.k }
  }
  const hit = (cx: number, cy: number): string | null => {
    const p = toWorld(cx, cy)
    let best: string | null = null
    let bestD = Infinity
    for (const n of nodes.current) {
      if (!visible(n.id)) continue
      const d = Math.hypot(n.x - p.x, n.y - p.y)
      if (d < radius(n) + 4 / view.current.k && d < bestD) (best = n.id), (bestD = d)
    }
    return best
  }
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const sel = selected ? byId.get(selected) : null
  const links = useMemo(() => {
    if (!sel || !graph) return []
    return graph.edges
      .filter((e) => e.from === sel.id || e.to === sel.id)
      .map((e) => ({ kind: e.kind, other: byId.get(e.from === sel.id ? e.to : e.from), out: e.from === sel.id }))
      .filter((x): x is { kind: typeof x.kind; other: NonNullable<typeof x.other>; out: boolean } => !!x.other)
  }, [sel, graph, byId])

  const present = useMemo(() => TYPES.filter((ty) => graph?.nodes.some((n) => n.type === ty)), [graph])

  return (
    <div className="relative h-full overflow-hidden" ref={wrap}>
      <canvas
        ref={canvas}
        data-testid="memory-graph"
        className={cn('absolute inset-0', hover ? 'cursor-pointer' : 'cursor-grab')}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) {
            const dx = e.clientX - d.x
            const dy = e.clientY - d.y
            if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
            if (d.moved) {
              autoFit.current = false
              view.current.x += dx
              view.current.y += dy
              d.x = e.clientX
              d.y = e.clientY
              drawRef.current()
            }
            return
          }
          const h = hit(e.clientX, e.clientY)
          if (h !== hover) setHover(h)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved) {
            setSelected(hit(e.clientX, e.clientY))
            setEditing(false)
          }
        }}
        onPointerLeave={() => setHover(null)}
        onWheel={(e) => {
          autoFit.current = false
          const v = view.current
          const box = wrap.current!.getBoundingClientRect()
          const k = Math.max(0.25, Math.min(4, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
          // Zoom around the pointer.
          const mx = e.clientX - box.left - box.width / 2
          const my = e.clientY - box.top - box.height / 2
          v.x = mx - ((mx - v.x) * k) / v.k
          v.y = my - ((my - v.y) * k) / v.k
          v.k = k
          drawRef.current()
        }}
      />

      <div className={cn('absolute left-3 top-3 flex flex-wrap items-center gap-1.5', sel ? 'max-w-[calc(100%-360px)]' : 'max-w-[calc(100%-24px)]')}>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            className="input h-7 w-52 pl-7 text-[13px]"
            placeholder={t('org:memory.graphSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {present.map((ty) => (
          <button
            key={ty}
            onClick={() => setHidden((h) => (h.has(ty) ? new Set([...h].filter((x) => x !== ty)) : new Set([...h, ty])))}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px]',
              hidden.has(ty) ? 'border-line text-zinc-500 line-through' : 'border-line bg-surface-2 text-zinc-200'
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[ty] }} />
            {t(`org:memory.nodeTypes.${ty}`)}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-zinc-500">
        {graph && t('org:memory.graphCount', { nodes: graph.nodes.length, edges: graph.edges.length })}
        {graph?.truncated && ` · ${t('org:memory.graphTruncated')}`}
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="inline-block w-4 border-t border-dashed border-rose-400" /> {t('org:memory.legendSupersedes')}
        </span>
      </div>

      {graph && graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-8 pt-16 text-center text-[13px] text-zinc-400">{t('org:memory.graphEmpty')}</div>
      )}

      {sel && (
        <aside className="card shadow-pop absolute bottom-3 right-3 top-3 flex w-[320px] flex-col overflow-hidden" data-testid="memory-node">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: sel.type === 'memory' && sel.kind ? KIND_COLOR[sel.kind] : TYPE_COLOR[sel.type] }} />
            <span className="text-[12px] font-medium text-zinc-300">{t(`org:memory.nodeTypes.${sel.type}`)}</span>
            {sel.kind && <KindBadge kind={sel.kind} />}
            <button className="icon-btn ml-auto h-6 w-6" onClick={() => setSelected(null)} title={t('actions.close')}>
              <X size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-[13px]">
            {editing && sel.type === 'memory' ? (
              <MemoryEditor memory={{ id: sel.id.slice(7), content: sel.text ?? sel.label, topics: sel.topics ?? [] }} onDone={() => setEditing(false)} />
            ) : (
              <div className="selectable leading-relaxed text-zinc-100">{sel.type === 'you' ? t('org:memory.youDesc') : sel.text ?? sel.label}</div>
            )}
            {sel.faded && <div className="rounded bg-rose-500/10 px-2 py-1 text-[12px] text-rose-300">{t('org:memory.supersededDesc')}</div>}
            {sel.topics && sel.topics.length > 0 && <TopicChips topics={sel.topics} />}
            {sel.type === 'memory' && !editing && (
              <div className="flex gap-1.5">
                <button className="btn-outline h-7" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> {t('actions.edit')}
                </button>
                <button
                  className="btn-ghost h-7 hover:text-rose-400"
                  onClick={() => {
                    void call('memory:delete', sel.id.slice(7))
                    setSelected(null)
                  }}
                >
                  <Trash2 size={12} /> {t('org:memory.forget')}
                </button>
              </div>
            )}
            <div>
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-zinc-500">{t('org:memory.links', { count: links.length })}</div>
              <ul className="space-y-0.5">
                {links.map((l, i) => (
                  <li key={i}>
                    <button className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/[0.05]" onClick={() => setSelected(l.other.id)}>
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[l.other.type] }} />
                      <span className="shrink-0 text-[12px] text-zinc-500">{t(`org:memory.edge.${l.kind}${l.out ? '' : 'In'}`)}</span>
                      <span className="min-w-0 truncate text-zinc-300">{l.other.type === 'you' ? t('org:memory.you') : l.other.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
