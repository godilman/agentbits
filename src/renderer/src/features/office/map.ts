/**
 * Office layout (tile grid) and furniture painters. Everything is drawn with
 * fillRect at 1:1 on low-res canvases and later scaled up with smoothing off.
 */

export const TILE = 16
export const COLS = 34
export const ROWS = 22
export const WIDTH = COLS * TILE
export const HEIGHT = ROWS * TILE

export interface Desk {
  x: number // tile of left half of a 2-wide desk
  y: number // tile row of the desk
  lead?: boolean
}

export interface Prop {
  kind: 'plant' | 'couch' | 'coffeeTable' | 'coffeeBar' | 'cooler' | 'server' | 'bookshelf' | 'meetingTable' | 'printer'
  x: number
  y: number
  w: number
  h: number
  /** tiles that block walking, relative to x,y (defaults to full footprint) */
  block?: boolean
}

export const WORKER_DESKS: Desk[] = [
  { x: 3, y: 5 },
  { x: 7, y: 5 },
  { x: 11, y: 5 },
  { x: 15, y: 5 },
  { x: 19, y: 5 },
  { x: 3, y: 10 },
  { x: 7, y: 10 },
  { x: 11, y: 10 },
  { x: 15, y: 10 },
  { x: 19, y: 10 }
]
export const LEAD_DESK: Desk = { x: 27, y: 6, lead: true }

export const PROPS: Prop[] = [
  { kind: 'server', x: 1, y: 2, w: 1, h: 2 },
  { kind: 'server', x: 2, y: 2, w: 1, h: 2 },
  { kind: 'plant', x: 22, y: 2, w: 1, h: 1 },
  { kind: 'bookshelf', x: 30, y: 2, w: 2, h: 1 },
  { kind: 'plant', x: 32, y: 2, w: 1, h: 1 },
  { kind: 'plant', x: 24, y: 2, w: 1, h: 1 },
  { kind: 'printer', x: 22, y: 9, w: 1, h: 1 },
  // meeting corner
  { kind: 'meetingTable', x: 5, y: 16, w: 6, h: 2 },
  { kind: 'plant', x: 1, y: 19, w: 1, h: 1 },
  { kind: 'plant', x: 14, y: 19, w: 1, h: 1 },
  { kind: 'cooler', x: 17, y: 14, w: 1, h: 1 },
  // lounge
  { kind: 'coffeeBar', x: 29, y: 12, w: 4, h: 1 },
  { kind: 'couch', x: 24, y: 15, w: 3, h: 1 },
  { kind: 'couch', x: 29, y: 15, w: 3, h: 1 },
  { kind: 'coffeeTable', x: 25, y: 17, w: 2, h: 1 },
  { kind: 'coffeeTable', x: 30, y: 17, w: 2, h: 1 },
  { kind: 'plant', x: 23, y: 20, w: 1, h: 1 },
  { kind: 'plant', x: 32, y: 20, w: 1, h: 1 }
]

/** Couch seats (tile coords) used by agents on a break, plus standing spots at the coffee bar. */
export const LOUNGE_SPOTS: { x: number; y: number; seated: boolean }[] = [
  { x: 24, y: 15, seated: true },
  { x: 26, y: 15, seated: true },
  { x: 29, y: 15, seated: true },
  { x: 31, y: 15, seated: true },
  { x: 30, y: 13, seated: false },
  { x: 32, y: 13, seated: false },
  { x: 25, y: 15, seated: true },
  { x: 30, y: 15, seated: true },
  { x: 27, y: 13, seated: false },
  { x: 28, y: 18, seated: false },
  { x: 24, y: 18, seated: false }
]

/* ───────────────────────────── walkability ───────────────────────────── */

export function buildWalkGrid(): boolean[][] {
  const g: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(true))
  const block = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) g[y][x] = false
  }
  // outer walls
  for (let x = 0; x < COLS; x++) {
    block(x, 0)
    block(x, 1)
    block(x, ROWS - 1)
  }
  for (let y = 0; y < ROWS; y++) {
    block(0, y)
    block(COLS - 1, y)
  }
  // lead office glass walls (door at y=8 on the west wall, x=27..28 on the south wall)
  for (let y = 2; y <= 10; y++) if (y !== 8) block(23, y)
  for (let x = 23; x <= 32; x++) if (x !== 27 && x !== 28) block(x, 11)
  for (const d of [...WORKER_DESKS, LEAD_DESK]) {
    block(d.x, d.y)
    block(d.x + 1, d.y)
  }
  for (const p of PROPS) {
    if (p.block === false) continue
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) block(p.x + dx, p.y + dy)
  }
  // couches: seats are reachable (agents sit on them)
  for (const s of LOUNGE_SPOTS) g[s.y][s.x] = true
  return g
}

/** BFS shortest path between tiles (4-neighbour). Returns tiles excluding start. */
export function findPath(grid: boolean[][], from: [number, number], to: [number, number]): [number, number][] {
  const [sx, sy] = from
  const [tx, ty] = to
  if (sx === tx && sy === ty) return []
  const key = (x: number, y: number): number => y * COLS + x
  const prev = new Map<number, number>()
  const q: [number, number][] = [[sx, sy]]
  prev.set(key(sx, sy), -1)
  while (q.length) {
    const [x, y] = q.shift()!
    if (x === tx && y === ty) break
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      const k = key(nx, ny)
      if (prev.has(k)) continue
      if (!grid[ny][nx] && !(nx === tx && ny === ty)) continue
      prev.set(k, key(x, y))
      q.push([nx, ny])
    }
  }
  if (!prev.has(key(tx, ty))) return [[tx, ty]]
  const path: [number, number][] = []
  let k = key(tx, ty)
  while (k !== key(sx, sy) && k !== -1) {
    path.push([k % COLS, Math.floor(k / COLS)])
    k = prev.get(k)!
  }
  return path.reverse()
}

/* ───────────────────────────── painters ───────────────────────────── */

type Ctx = CanvasRenderingContext2D
const R = (c: Ctx, x: number, y: number, w: number, h: number, color: string): void => {
  c.fillStyle = color
  c.fillRect(x, y, w, h)
}

// deterministic noise so the floor looks the same every frame
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export const COLORS = {
  floorA: '#25232f',
  floorB: '#2a2835',
  floorLine: '#1c1b24',
  carpetLead: '#18202e',
  carpetLeadDot: '#1c2536',
  lounge: '#22182b',
  loungeDot: '#2a1d35',
  meeting: '#1a2324',
  wallFace: '#2c2a40',
  wallTop: '#3b3956',
  wallDark: '#1a1928',
  glass: 'rgba(125, 211, 252, 0.18)',
  glassEdge: 'rgba(125, 211, 252, 0.45)',
  wood: '#7a5a3f',
  woodLight: '#93704f',
  woodDark: '#563e2b',
  woodShadow: '#3b2a1d'
}

export function paintFloor(c: Ctx): void {
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const x = tx * TILE
      const y = ty * TILE
      const inLead = tx >= 24 && ty >= 2 && ty <= 10
      const inLounge = tx >= 23 && ty >= 12
      const inMeeting = tx >= 2 && tx <= 14 && ty >= 14 && ty <= 19
      if (inLead) {
        R(c, x, y, TILE, TILE, COLORS.carpetLead)
        if ((tx + ty) % 2 === 0) R(c, x + 7, y + 7, 2, 2, COLORS.carpetLeadDot)
      } else if (inLounge) {
        R(c, x, y, TILE, TILE, COLORS.lounge)
        if (hash(tx, ty) > 0.5) R(c, x + 3, y + 11, 1, 1, COLORS.loungeDot)
        if (hash(ty, tx) > 0.5) R(c, x + 11, y + 4, 1, 1, COLORS.loungeDot)
      } else if (inMeeting) {
        R(c, x, y, TILE, TILE, COLORS.meeting)
        R(c, x, y + 15, TILE, 1, '#172021')
        R(c, x + 15, y, 1, TILE, '#172021')
      } else {
        // wooden planks: 4px tall, staggered joints
        for (let p = 0; p < 4; p++) {
          const py = y + p * 4
          R(c, x, py, TILE, 4, (ty * 4 + p) % 2 ? COLORS.floorA : COLORS.floorB)
          R(c, x, py + 3, TILE, 1, COLORS.floorLine)
          const joint = Math.floor(hash(tx + p, ty) * 12) + 2
          if ((tx + p) % 3 === 0) R(c, x + joint, py, 1, 3, COLORS.floorLine)
        }
      }
    }
  }
  // rugs
  rug(c, 24 * TILE + 4, 14 * TILE + 4, 3 * TILE - 8 + 16, 5 * TILE - 8, '#3b2457', '#4c2e6e')
  rug(c, 29 * TILE + 4 - 16, 14 * TILE + 4, 4 * TILE - 8 + 16, 5 * TILE - 8, '#203a4a', '#2a4b5e')
  rug(c, 3 * TILE + 8, 15 * TILE, 10 * TILE - 16, 4 * TILE, '#22343a', '#2b434a')
}

function rug(c: Ctx, x: number, y: number, w: number, h: number, base: string, border: string): void {
  R(c, x, y, w, h, border)
  R(c, x + 2, y + 2, w - 4, h - 4, base)
  for (let i = x + 4; i < x + w - 4; i += 4) R(c, i, y + h - 4, 2, 1, border)
}

export function paintWalls(c: Ctx, t: number): void {
  // top wall face (2 tiles)
  R(c, 0, 0, WIDTH, 2 * TILE, COLORS.wallFace)
  R(c, 0, 0, WIDTH, 3, COLORS.wallTop)
  R(c, 0, 2 * TILE - 3, WIDTH, 3, COLORS.wallDark)
  for (let x = 0; x < WIDTH; x += 32) R(c, x, 3, 1, 2 * TILE - 6, '#29273b')
  // windows with a night skyline
  for (const wx of [5, 9, 13, 17, 25, 28]) window_(c, wx * TILE, 4, t)
  // whiteboard
  R(c, 20 * TILE - 2, 6, 2 * TILE + 4, 18, '#4b4a5e')
  R(c, 20 * TILE, 8, 2 * TILE, 14, '#e7e5ee')
  R(c, 20 * TILE + 3, 11, 12, 1, '#6366f1')
  R(c, 20 * TILE + 3, 14, 18, 1, '#10b981')
  R(c, 20 * TILE + 3, 17, 9, 1, '#f43f5e')
  R(c, 20 * TILE + 20, 10, 8, 8, 'rgba(250, 204, 21, 0.85)')
  // side + bottom walls (top-down)
  R(c, 0, 2 * TILE, TILE, HEIGHT, COLORS.wallTop)
  R(c, TILE - 3, 2 * TILE, 3, HEIGHT, COLORS.wallDark)
  R(c, WIDTH - TILE, 2 * TILE, TILE, HEIGHT, COLORS.wallTop)
  R(c, WIDTH - TILE, 2 * TILE, 3, HEIGHT, COLORS.wallDark)
  R(c, 0, HEIGHT - TILE, WIDTH, TILE, COLORS.wallTop)
  R(c, 0, HEIGHT - TILE, WIDTH, 3, COLORS.wallDark)
  // lead office glass partition
  const gx = 23 * TILE
  for (let y = 2; y <= 10; y++) {
    if (y === 8) continue
    R(c, gx + 6, y * TILE, 4, TILE, COLORS.glass)
    R(c, gx + 6, y * TILE, 1, TILE, COLORS.glassEdge)
  }
  for (let x = 23; x <= 32; x++) {
    if (x === 27 || x === 28) continue
    R(c, x * TILE, 11 * TILE + 6, TILE, 4, COLORS.glass)
    R(c, x * TILE, 11 * TILE + 6, TILE, 1, COLORS.glassEdge)
  }
  // lead office sign
  R(c, 25 * TILE, 2 * TILE + 2, 2 * TILE, 5, '#312e81')
  R(c, 25 * TILE + 2, 2 * TILE + 4, 2 * TILE - 4, 1, '#a5b4fc')
}

function window_(c: Ctx, x: number, y: number, t: number): void {
  const w = 2 * TILE + 8
  const h = 20
  R(c, x - 2, y - 2, w + 4, h + 4, '#43415e')
  R(c, x, y, w, h, '#0c1226')
  // stars
  for (let i = 0; i < 6; i++) {
    const sx = x + Math.floor(hash(x, i) * w)
    const sy = y + Math.floor(hash(i, x) * 8)
    const tw = Math.sin(t / 700 + i * 1.7 + x) > 0.6
    R(c, sx, sy, 1, 1, tw ? '#ffffff' : '#64748b')
  }
  // skyline
  let bx = x
  let i = 0
  while (bx < x + w) {
    const bw = 4 + Math.floor(hash(bx, 3) * 6)
    const bh = 6 + Math.floor(hash(bx, 7) * 10)
    R(c, bx, y + h - bh, Math.min(bw, x + w - bx), bh, '#161b33')
    for (let wy = y + h - bh + 2; wy < y + h - 1; wy += 3)
      for (let wx = bx + 1; wx < Math.min(bx + bw - 1, x + w - 1); wx += 2)
        if (hash(wx, wy + i) > 0.72) R(c, wx, wy, 1, 1, '#fbbf24')
    bx += bw
    i++
  }
  R(c, x + w / 2 - 1, y, 2, h, '#43415e')
}

/* furniture sprites (drawn into their own offscreen canvases) */

export function paintDesk(c: Ctx, lead = false): void {
  const w = 2 * TILE
  const top = lead ? '#4a3c6b' : COLORS.wood
  const topLight = lead ? '#5d4d85' : COLORS.woodLight
  const front = lead ? '#33294b' : COLORS.woodDark
  R(c, 0, 0, w, 10, top)
  R(c, 0, 0, w, 1, topLight)
  R(c, 0, 9, w, 1, COLORS.woodShadow)
  R(c, 0, 10, w, 6, front)
  R(c, 1, 10, 2, 6, COLORS.woodShadow)
  R(c, w - 3, 10, 2, 6, COLORS.woodShadow)
  R(c, 6, 12, w - 12, 1, lead ? '#43386a' : '#654a33')
  // papers + mug
  R(c, 2, 2, 5, 4, '#e4e4e7')
  R(c, 3, 3, 3, 1, '#a1a1aa')
  R(c, w - 6, 3, 3, 4, lead ? '#a5b4fc' : '#f4f4f5')
  R(c, w - 3, 4, 1, 2, lead ? '#a5b4fc' : '#f4f4f5')
}

export function paintChair(c: Ctx): void {
  R(c, 2, 0, 12, 9, '#2d2b3d')
  R(c, 2, 0, 12, 1, '#3e3b55')
  R(c, 3, 9, 10, 3, '#23212f')
  R(c, 7, 12, 2, 3, '#18171f')
}

export function paintProp(c: Ctx, p: Prop): void {
  const w = p.w * TILE
  const h = p.h * TILE
  switch (p.kind) {
    case 'plant': {
      R(c, 4, 10, 8, 6, '#8b5a3c')
      R(c, 4, 10, 8, 1, '#a46c49')
      R(c, 5, 15, 6, 1, '#5c3b27')
      const leaves = ['#166534', '#15803d', '#22c55e']
      const pts = [
        [7, 1], [5, 3], [9, 3], [3, 5], [7, 5], [11, 5], [4, 7], [8, 7], [10, 8], [6, 8], [2, 8], [12, 7]
      ]
      pts.forEach(([x, y], i) => R(c, x, y, 3, 2, leaves[i % 3]))
      break
    }
    case 'server': {
      R(c, 1, 0, w - 2, h, '#1f2937')
      R(c, 1, 0, w - 2, 1, '#374151')
      for (let y = 3; y < h - 2; y += 4) R(c, 3, y, w - 6, 2, '#111827')
      break
    }
    case 'bookshelf': {
      R(c, 0, 0, w, h, '#4a3628')
      R(c, 0, 7, w, 1, '#2f2219')
      const books = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316', '#06b6d4']
      for (let x = 2, i = 0; x < w - 2; x += 3, i++) {
        R(c, x, 1, 2, 6, books[i % books.length])
        R(c, x, 9, 2, 6, books[(i + 3) % books.length])
      }
      break
    }
    case 'printer': {
      R(c, 1, 5, 14, 9, '#d4d4d8')
      R(c, 1, 5, 14, 1, '#f4f4f5')
      R(c, 3, 2, 10, 4, '#fafafa')
      R(c, 3, 9, 10, 1, '#52525b')
      R(c, 12, 7, 1, 1, '#22c55e')
      break
    }
    case 'cooler': {
      R(c, 4, 0, 8, 7, '#7dd3fc')
      R(c, 5, 1, 2, 5, '#bae6fd')
      R(c, 3, 7, 10, 9, '#e4e4e7')
      R(c, 3, 7, 10, 1, '#fafafa')
      R(c, 6, 10, 4, 2, '#3b82f6')
      break
    }
    case 'meetingTable': {
      R(c, 0, 2, w, h - 6, COLORS.wood)
      R(c, 0, 2, w, 1, COLORS.woodLight)
      R(c, 0, h - 5, w, 3, COLORS.woodDark)
      for (let x = 10; x < w - 8; x += 18) {
        R(c, x, 8, 8, 6, '#e4e4e7')
        R(c, x + 1, 9, 6, 1, '#a1a1aa')
      }
      R(c, w / 2 - 6, h / 2 - 4, 12, 7, '#18181b')
      R(c, w / 2 - 5, h / 2 - 3, 10, 5, '#312e81')
      break
    }
    case 'couch': {
      const base = '#4338ca'
      R(c, 0, 0, w, 8, shadeHex(base, -0.2))
      R(c, 0, 0, w, 1, shadeHex(base, 0.2))
      R(c, 0, 8, w, 8, base)
      for (let x = TILE; x < w; x += TILE) R(c, x, 9, 1, 5, shadeHex(base, -0.3))
      R(c, 0, 4, 3, 12, shadeHex(base, -0.35))
      R(c, w - 3, 4, 3, 12, shadeHex(base, -0.35))
      R(c, 0, 15, w, 1, '#1e1b4b')
      break
    }
    case 'coffeeTable': {
      R(c, 1, 3, w - 2, 9, COLORS.woodDark)
      R(c, 1, 3, w - 2, 1, COLORS.wood)
      R(c, 3, 12, 2, 3, COLORS.woodShadow)
      R(c, w - 5, 12, 2, 3, COLORS.woodShadow)
      R(c, 8, 5, 4, 3, '#f4f4f5')
      R(c, w - 12, 6, 6, 4, '#f59e0b')
      break
    }
    case 'coffeeBar': {
      R(c, 0, 2, w, 14, '#3f3f46')
      R(c, 0, 2, w, 2, '#71717a')
      R(c, 0, 14, w, 2, '#27272a')
      // espresso machine
      R(c, 4, -6, 12, 12, '#18181b')
      R(c, 5, -5, 10, 3, '#dc2626')
      R(c, 8, 1, 4, 3, '#52525b')
      // mugs
      R(c, 22, 6, 4, 4, '#f4f4f5')
      R(c, 28, 6, 4, 4, '#fde68a')
      R(c, 34, 6, 4, 4, '#a5b4fc')
      // fruit bowl
      R(c, 46, 6, 10, 4, '#e4e4e7')
      R(c, 47, 4, 3, 3, '#ef4444')
      R(c, 51, 4, 3, 3, '#facc15')
      break
    }
  }
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number): number => Math.round(Math.max(0, Math.min(255, amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
  return '#' + ((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)
}
