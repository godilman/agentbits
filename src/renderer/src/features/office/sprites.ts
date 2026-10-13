/**
 * Pixel-art character sprites, defined as character grids so no image assets
 * are needed. Colours are resolved per agent (hair / skin / shirt).
 *
 * Legend: . transparent  H hair  h hair shade  S skin  s skin shade  E eye
 *         C shirt  c shirt shade  P pants  B shoes  W white (eye glint)
 */

export const SPRITE_W = 12
export const SPRITE_H = 16

const FRONT_BASE = [
  '....HHHH....',
  '..HHHHHHHH..',
  '.HHHHHHHHHH.',
  '.HHSSSSSSHH.',
  '.HSSSSSSSSH.',
  '.SSESSSSESS.',
  '..SSSSSSSS..',
  '..sSSssSSs..',
  '....cSSc....',
  '..CCCCCCCC..',
  '.CCCCCCCCCC.',
  '.SCCCCCCCCS.',
  '.S.CCCCCC.S.'
]

const LEGS_STAND = ['...PPPPPP...', '...PP..PP...', '...BB..BB...']
const LEGS_WALK_A = ['...PPPPPP...', '..PP....PP..', '..BB.....BB.'].map((r) => r.slice(0, 12))
const LEGS_WALK_B = ['...PPPPPP...', '....PPPP....', '....BBBB....']

export const FRAMES = {
  stand: [...FRONT_BASE, ...LEGS_STAND],
  walkA: [...FRONT_BASE, ...LEGS_WALK_A],
  walkB: [...FRONT_BASE, ...LEGS_WALK_B],
  // Typing: forearms raised onto the desk, alternating hands.
  typeA: [
    ...FRONT_BASE.slice(0, 11),
    '.CCCCCCCCCC.',
    'SS.CCCCCC.S.',
    '...PPPPPP...',
    '...PP..PP...',
    '...BB..BB...'
  ],
  typeB: [
    ...FRONT_BASE.slice(0, 11),
    '.CCCCCCCCCC.',
    '.S.CCCCCC.SS',
    '...PPPPPP...',
    '...PP..PP...',
    '...BB..BB...'
  ],
  blink: [
    ...FRONT_BASE.slice(0, 5),
    '.SSsSSSSsSS.',
    ...FRONT_BASE.slice(6),
    ...LEGS_STAND
  ]
} satisfies Record<string, string[]>

export type FrameName = keyof typeof FRAMES

export interface CharacterColors {
  hair: string
  skin: string
  shirt: string
}

/** Darken / lighten a hex colour by `amt` (-1..1). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  const f = (c: number): number => Math.round(Math.max(0, Math.min(255, amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)))
  r = f(r)
  g = f(g)
  b = f(b)
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

export function palette(c: CharacterColors): Record<string, string> {
  return {
    H: c.hair,
    h: shade(c.hair, -0.35),
    S: c.skin,
    s: shade(c.skin, -0.18),
    E: '#1b1b24',
    W: '#ffffff',
    C: c.shirt,
    c: shade(c.shirt, -0.3),
    P: '#2b3046',
    B: '#16161d'
  }
}

/** Draws a frame at integer pixel coords on a 1:1 (low-res) context. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: string[],
  x: number,
  y: number,
  pal: Record<string, string>,
  opts: { maxRows?: number; alpha?: number } = {}
): void {
  const rows = Math.min(frame.length, opts.maxRows ?? frame.length)
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha
  for (let r = 0; r < rows; r++) {
    const row = frame[r]
    for (let col = 0; col < row.length; col++) {
      const ch = row[col]
      if (ch === '.') continue
      ctx.fillStyle = pal[ch] ?? '#ff00ff'
      ctx.fillRect(x + col, y + r, 1, 1)
    }
  }
  ctx.globalAlpha = 1
}

/** Head-and-shoulders SVG rects for avatars in the HTML UI. */
export function avatarRects(c: CharacterColors): { x: number; y: number; fill: string }[] {
  const pal = palette(c)
  const rects: { x: number; y: number; fill: string }[] = []
  FRAMES.stand.slice(0, 12).forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') rects.push({ x, y, fill: pal[row[x]] })
  })
  return rects
}
