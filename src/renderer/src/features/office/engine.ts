import type { Agent, AgentStatus } from '@shared/types'
import {
  buildWalkGrid,
  findPath,
  HEIGHT,
  LEAD_DESK,
  LOUNGE_SPOTS,
  paintChair,
  paintDesk,
  paintFloor,
  paintProp,
  paintWalls,
  PROPS,
  TILE,
  WIDTH,
  WORKER_DESKS,
  type Desk
} from './map'
import { drawFrame, FRAMES, palette, SPRITE_H, SPRITE_W, type FrameName } from './sprites'
import { t } from '@/i18n'

/** What the office needs to know about each agent. */
export interface OfficeAgent {
  agent: Agent
  paused: boolean
  awaitingApproval: boolean
  taskKey: string | null
  /** Sits at the lead desk (project lead). Defaults to `agent.isLead`. */
  lead?: boolean
  /** Busy with another project's task: drawn dimmed with an "in another project" tag. */
  away?: boolean
}

const isLeadSeat = (a: OfficeAgent): boolean => a.lead ?? a.agent.isLead

interface Actor {
  id: string
  data: OfficeAgent
  pal: Record<string, string>
  x: number // feet position in low-res px
  y: number
  path: [number, number][]
  dest: 'desk' | 'lounge' | 'none'
  desk: Desk
  loungeIdx: number
  facingLeft: boolean
  walkPhase: number
  blinkAt: number
  seed: number
}

const STATUS_GLOW: Record<AgentStatus, string> = {
  working: '#34d399',
  idle: '#a1a1aa',
  break: '#fbbf24',
  error: '#fb7185',
  offline: '#3f3f46'
}

const SPEED = 64 // px / second (low-res)
const PAD = 8 // top padding for prop canvases (things that stick up)

function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return [c, ctx]
}

export class OfficeEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private low: HTMLCanvasElement
  private lctx: CanvasRenderingContext2D
  private floor: HTMLCanvasElement
  private deskSprite: HTMLCanvasElement
  private leadDeskSprite: HTMLCanvasElement
  private chairSprite: HTMLCanvasElement
  private propSprites = new Map<number, HTMLCanvasElement>()
  private grid = buildWalkGrid()
  private actors = new Map<string, Actor>()
  private raf = 0
  private last = 0
  private scale = 2
  private offsetX = 0
  private offsetY = 0
  private hoverId: string | null = null
  selectedId: string | null = null
  onSelect: (id: string | null) => void = () => undefined

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    ;[this.low, this.lctx] = offscreen(WIDTH, HEIGHT)
    let fctx: CanvasRenderingContext2D
    ;[this.floor, fctx] = offscreen(WIDTH, HEIGHT)
    paintFloor(fctx)
    let c: CanvasRenderingContext2D
    ;[this.deskSprite, c] = offscreen(2 * TILE, TILE)
    paintDesk(c)
    ;[this.leadDeskSprite, c] = offscreen(2 * TILE, TILE)
    paintDesk(c, true)
    ;[this.chairSprite, c] = offscreen(TILE, TILE)
    paintChair(c)
    PROPS.forEach((p, i) => {
      const [pc, pctx] = offscreen(p.w * TILE, p.h * TILE + PAD)
      pctx.translate(0, PAD)
      paintProp(pctx, p)
      this.propSprites.set(i, pc)
    })
    canvas.addEventListener('mousemove', this.onMove)
    canvas.addEventListener('click', this.onClick)
    canvas.addEventListener('mouseleave', () => (this.hoverId = null))
  }

  /* ───────────────────────── public API ───────────────────────── */

  start(): void {
    const loop = (t: number): void => {
      const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0
      this.last = t
      this.update(dt, t)
      this.render(t)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('mousemove', this.onMove)
    this.canvas.removeEventListener('click', this.onClick)
  }

  resize(cssW: number, cssH: number): void {
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.floor(cssW * dpr)
    this.canvas.height = Math.floor(cssH * dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    const fit = Math.min(cssW / WIDTH, cssH / HEIGHT)
    // integer scaling keeps pixels crisp when there is room for it
    this.scale = (fit >= 3 ? Math.floor(fit) : Math.floor(fit * 4) / 4 || fit) * dpr
    this.offsetX = Math.floor((this.canvas.width - WIDTH * this.scale) / 2)
    this.offsetY = Math.floor((this.canvas.height - HEIGHT * this.scale) / 2)
  }

  setAgents(list: OfficeAgent[]): void {
    const workers = list.filter((a) => !isLeadSeat(a)).sort((a, b) => a.agent.deskIndex - b.agent.deskIndex)
    const deskFor = new Map<string, Desk>()
    workers.forEach((w, i) => deskFor.set(w.agent.id, WORKER_DESKS[i % WORKER_DESKS.length]))
    list.filter(isLeadSeat).forEach((l) => deskFor.set(l.agent.id, LEAD_DESK))

    const seen = new Set<string>()
    list.forEach((d, idx) => {
      seen.add(d.agent.id)
      const desk = deskFor.get(d.agent.id)!
      let a = this.actors.get(d.agent.id)
      const seat = this.seatOf(desk)
      if (!a) {
        a = {
          id: d.agent.id,
          data: d,
          pal: palette({ hair: d.agent.hair, skin: d.agent.skin, shirt: d.agent.color }),
          x: seat.x,
          y: seat.y,
          path: [],
          dest: 'desk',
          desk,
          loungeIdx: idx % LOUNGE_SPOTS.length,
          facingLeft: false,
          walkPhase: 0,
          blinkAt: performance.now() + Math.random() * 4000,
          seed: Math.random() * 1000
        }
        if (d.agent.status === 'break') {
          const s = this.loungePx(a.loungeIdx)
          a.x = s.x
          a.y = s.y
          a.dest = 'lounge'
        }
        this.actors.set(a.id, a)
      }
      a.data = d
      a.pal = palette({ hair: d.agent.hair, skin: d.agent.skin, shirt: d.agent.color })
      if (a.desk !== desk) {
        a.desk = desk
        a.dest = 'none'
      }
      a.loungeIdx = idx % LOUNGE_SPOTS.length
      const want = d.agent.status === 'break' ? 'lounge' : 'desk'
      if (a.dest !== want) this.walkTo(a, want)
    })
    for (const id of [...this.actors.keys()]) if (!seen.has(id)) this.actors.delete(id)
  }

  /* ───────────────────────── movement ───────────────────────── */

  private seatOf(desk: Desk): { x: number; y: number; tx: number; ty: number } {
    return { x: desk.x * TILE + TILE, y: desk.y * TILE + 2, tx: desk.x, ty: desk.y - 1 }
  }

  private loungePx(i: number): { x: number; y: number; tx: number; ty: number } {
    const s = LOUNGE_SPOTS[i]
    return { x: s.x * TILE + TILE / 2, y: s.y * TILE + (s.seated ? 12 : 14), tx: s.x, ty: s.y }
  }

  private walkTo(a: Actor, where: 'desk' | 'lounge'): void {
    const target = where === 'desk' ? this.seatOf(a.desk) : this.loungePx(a.loungeIdx)
    const from: [number, number] = [Math.floor(a.x / TILE), Math.min(20, Math.floor((a.y - 1) / TILE))]
    const tiles = findPath(this.grid, from, [target.tx, target.ty])
    a.path = tiles.map(([tx, ty]) => [tx * TILE + TILE / 2, ty * TILE + 12] as [number, number])
    a.path.push([target.x, target.y])
    a.dest = where
  }

  private update(dt: number, t: number): void {
    for (const a of this.actors.values()) {
      if (!a.path.length) continue
      const [tx, ty] = a.path[0]
      const dx = tx - a.x
      const dy = ty - a.y
      const dist = Math.hypot(dx, dy)
      const step = SPEED * dt
      if (dist <= step) {
        a.x = tx
        a.y = ty
        a.path.shift()
      } else {
        a.x += (dx / dist) * step
        a.y += (dy / dist) * step
        if (Math.abs(dx) > 0.5) a.facingLeft = dx < 0
      }
      a.walkPhase += dt * 8
    }
    for (const a of this.actors.values()) if (t > a.blinkAt + 160) a.blinkAt = t + 2500 + Math.random() * 3500
  }

  private isSeatedAtDesk(a: Actor): boolean {
    return !a.path.length && a.dest === 'desk'
  }

  /* ───────────────────────── rendering ───────────────────────── */

  private render(t: number): void {
    const c = this.lctx
    c.drawImage(this.floor, 0, 0)
    paintWalls(c, t)

    type Drawable = { y: number; draw: () => void }
    const list: Drawable[] = []

    // desks (+ chair behind when the seat is empty)
    const occupied = new Map<Desk, Actor>()
    for (const a of this.actors.values()) occupied.set(a.desk, a)
    for (const desk of [...WORKER_DESKS, LEAD_DESK]) {
      const actor = occupied.get(desk)
      const x = desk.x * TILE
      const y = desk.y * TILE
      list.push({ y: y - 1, draw: () => c.drawImage(this.chairSprite, x + 8, y - TILE + 2) })
      list.push({ y: y + TILE, draw: () => this.drawDesk(desk, actor, t) })
    }
    PROPS.forEach((p, i) => {
      const spr = this.propSprites.get(i)!
      const baseY = p.kind === 'couch' ? p.y * TILE + 4 : (p.y + p.h) * TILE
      list.push({ y: baseY, draw: () => c.drawImage(spr, p.x * TILE, p.y * TILE - PAD) })
      if (p.kind === 'couch') {
        // front cushion drawn over seated agents
        list.push({
          y: (p.y + 1) * TILE - 1,
          draw: () => c.drawImage(spr, 0, PAD + 10, p.w * TILE, 6, p.x * TILE, p.y * TILE + 10, p.w * TILE, 6)
        })
      }
      if (p.kind === 'server') {
        list.push({
          y: baseY + 0.1,
          draw: () => {
            for (let k = 0; k < 6; k++) {
              const on = Math.sin(t / (180 + k * 37) + k * 2.1 + p.x) > 0.1
              c.fillStyle = on ? (k % 3 === 0 ? '#34d399' : '#38bdf8') : '#0f172a'
              c.fillRect(p.x * TILE + 4 + (k % 2) * 5, p.y * TILE + 4 + Math.floor(k / 2) * 4, 2, 1)
            }
          }
        })
      }
    })

    for (const a of this.actors.values()) {
      if (a.data.agent.status === 'offline') continue
      list.push({ y: a.y, draw: () => this.drawActor(a, t) })
    }

    list.sort((p, q) => p.y - q.y)
    for (const d of list) d.draw()

    // ambient vignette for the night-office mood
    c.fillStyle = 'rgba(8, 8, 14, 0.12)'
    c.fillRect(0, 0, WIDTH, HEIGHT)

    // blit low-res → screen
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.low, this.offsetX, this.offsetY, WIDTH * this.scale, HEIGHT * this.scale)

    // hi-res overlay: name tags
    for (const a of this.actors.values()) if (a.data.agent.status !== 'offline') this.drawTag(a)
  }

  private drawDesk(desk: Desk, actor: Actor | undefined, t: number): void {
    const c = this.lctx
    const x = desk.x * TILE
    const y = desk.y * TILE
    c.drawImage(desk.lead ? this.leadDeskSprite : this.deskSprite, x, y)
    // laptop (back side faces the viewer)
    const status = actor?.data.agent.status ?? 'offline'
    const seated = actor ? this.isSeatedAtDesk(actor) : false
    const lx = x + 12
    const ly = y - 3
    c.fillStyle = '#3f3f50'
    c.fillRect(lx, ly, 8, 6)
    c.fillStyle = '#52526a'
    c.fillRect(lx, ly, 8, 1)
    c.fillStyle = '#26263a'
    c.fillRect(lx - 1, ly + 6, 10, 2)
    const glow = seated && status !== 'offline' ? STATUS_GLOW[status] : '#27272a'
    const pulse = status === 'working' ? 0.55 + 0.45 * Math.abs(Math.sin(t / 300)) : status === 'error' ? (Math.sin(t / 150) > 0 ? 1 : 0.3) : 0.6
    c.globalAlpha = pulse
    c.fillStyle = glow
    c.fillRect(lx + 3, ly + 2, 2, 2) // logo
    c.globalAlpha = seated && status === 'working' ? 0.18 : status === 'error' && seated ? 0.22 : 0
    c.fillRect(lx - 5, ly - 8, 18, 8) // screen light spilling upward
    c.globalAlpha = 1
  }

  private drawActor(a: Actor, t: number): void {
    const c = this.lctx
    const status = a.data.agent.status
    const walking = a.path.length > 0
    const seatedDesk = this.isSeatedAtDesk(a)
    const loungeSpot = LOUNGE_SPOTS[a.loungeIdx]
    let frame: FrameName = 'stand'
    let bob = 0
    if (walking) frame = Math.floor(a.walkPhase) % 2 ? 'walkA' : 'walkB'
    else if (seatedDesk && status === 'working' && !a.data.paused) frame = Math.floor(t / 140 + a.seed) % 2 ? 'typeA' : 'typeB'
    else if (t > a.blinkAt && t < a.blinkAt + 160) frame = 'blink'
    if (!walking && status === 'idle') bob = Math.sin(t / 600 + a.seed) > 0.85 ? -1 : 0

    const x = Math.round(a.x - SPRITE_W / 2)
    const y = Math.round(a.y - SPRITE_H + bob)

    // selection / hover ring
    if (this.selectedId === a.id || this.hoverId === a.id) {
      c.fillStyle = this.selectedId === a.id ? 'rgba(129, 140, 248, 0.55)' : 'rgba(255,255,255,0.25)'
      c.fillRect(x + 1, Math.round(a.y) - 1, SPRITE_W - 2, 2)
      c.fillRect(x, Math.round(a.y), SPRITE_W, 1)
    } else if (!seatedDesk) {
      c.fillStyle = 'rgba(0,0,0,0.3)'
      c.fillRect(x + 2, Math.round(a.y) - 1, SPRITE_W - 4, 2)
    }

    const sitting = (seatedDesk || (!walking && a.dest === 'lounge' && loungeSpot?.seated)) ?? false
    const away = !!a.data.away
    drawFrame(c, FRAMES[frame], x, y, a.pal, {
      maxRows: sitting ? 13 : SPRITE_H,
      alpha: away ? 0.45 : status === 'error' && Math.sin(t / 150) > 0.7 ? 0.85 : 1
    })

    // status bubbles (an agent busy in another project shows none here)
    const bx = x + SPRITE_W - 2
    const by = y - 9
    if (away) return
    if (a.data.awaitingApproval) this.bubble(bx, by, '#facc15', '?', t)
    else if (status === 'error') this.bubble(bx, by, '#f43f5e', '!', t)
    else if (a.data.paused) this.bubble(bx, by, '#a1a1aa', '=', t)
    else if (status === 'break' && !walking) this.coffee(bx, by, t)
    else if (status === 'working' && seatedDesk && Math.floor(t / 1800 + a.seed) % 3 === 0) this.bubble(bx, by, '#34d399', '<>', t)
    else if (status === 'idle' && !walking && Math.floor(t / 2500 + a.seed) % 4 === 0) this.bubble(bx, by, '#71717a', '..', t)
  }

  private bubble(x: number, y: number, color: string, glyph: string, t: number): void {
    const c = this.lctx
    const fy = y + (Math.sin(t / 300) > 0 ? 0 : 1)
    c.fillStyle = '#0b0b10'
    c.fillRect(x - 1, fy - 1, 9, 8)
    c.fillStyle = '#f4f4f5'
    c.fillRect(x, fy, 7, 6)
    c.fillRect(x + 1, fy + 6, 2, 1)
    c.fillStyle = color
    const G: Record<string, string[]> = {
      '?': ['.###.', '...#.', '..#..', '.....', '..#..'],
      '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
      '=': ['.#.#.', '.#.#.', '.#.#.', '.#.#.', '.....'],
      '<>': ['.#.#.', '#...#', '.#.#.', '.....', '.....'],
      '..': ['.....', '.....', '#.#.#', '.....', '.....']
    }
    const rows = G[glyph]
    rows.forEach((r, ry) => {
      for (let rx = 0; rx < r.length; rx++) if (r[rx] === '#') c.fillRect(x + 1 + rx, fy + ry + (glyph === '<>' ? 1 : 0), 1, 1)
    })
  }

  private coffee(x: number, y: number, t: number): void {
    const c = this.lctx
    const fy = y + 2
    c.fillStyle = '#f4f4f5'
    c.fillRect(x, fy + 2, 5, 4)
    c.fillRect(x + 5, fy + 3, 1, 2)
    c.fillStyle = '#92400e'
    c.fillRect(x + 1, fy + 2, 3, 1)
    const s = Math.floor(t / 250) % 2
    c.fillStyle = 'rgba(255,255,255,0.6)'
    c.fillRect(x + 1 + s, fy - 1, 1, 2)
    c.fillRect(x + 3 - s, fy - 2, 1, 2)
  }

  private drawTag(a: Actor): void {
    const ctx = this.ctx
    const s = this.scale
    const dpr = window.devicePixelRatio || 1
    const sx = this.offsetX + a.x * s
    const sy = this.offsetY + (a.y - SPRITE_H - 11) * s
    const status = a.data.agent.status
    const away = !!a.data.away
    const label = a.data.agent.name + (away ? ` · ${t('office:canvas.away')}` : a.data.taskKey && status === 'working' ? ` · ${a.data.taskKey}` : '')
    ctx.font = `600 ${11 * dpr}px Inter, "Segoe UI", system-ui, sans-serif`
    const tw = ctx.measureText(label).width
    const padX = 6 * dpr
    const dot = 6 * dpr
    const w = tw + padX * 2 + dot + 4 * dpr
    const h = 18 * dpr
    const x = Math.round(sx - w / 2)
    const y = Math.round(sy - h)
    ctx.globalAlpha = away ? 0.5 : this.selectedId && this.selectedId !== a.id ? 0.55 : 0.95
    ctx.fillStyle = 'rgba(12,12,16,0.88)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 5 * dpr)
    ctx.fill()
    ctx.strokeStyle = this.selectedId === a.id ? 'rgba(129,140,248,0.9)' : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = dpr
    ctx.stroke()
    ctx.fillStyle = away ? '#71717a' : a.data.awaitingApproval ? '#facc15' : STATUS_GLOW[status]
    ctx.beginPath()
    ctx.arc(x + padX + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e4e4e7'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + padX + dot + 4 * dpr, y + h / 2 + 0.5 * dpr)
    ctx.globalAlpha = 1
  }

  /* ───────────────────────── input ───────────────────────── */

  private hit(e: MouseEvent): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const px = ((e.clientX - rect.left) * dpr - this.offsetX) / this.scale
    const py = ((e.clientY - rect.top) * dpr - this.offsetY) / this.scale
    let best: string | null = null
    for (const a of this.actors.values()) {
      if (a.data.agent.status === 'offline') continue
      if (px >= a.x - 8 && px <= a.x + 8 && py >= a.y - SPRITE_H - 14 && py <= a.y + 2) best = a.id
    }
    return best
  }

  private onMove = (e: MouseEvent): void => {
    this.hoverId = this.hit(e)
    this.canvas.style.cursor = this.hoverId ? 'pointer' : 'default'
  }

  private onClick = (e: MouseEvent): void => {
    const id = this.hit(e)
    this.selectedId = id
    this.onSelect(id)
  }
}
