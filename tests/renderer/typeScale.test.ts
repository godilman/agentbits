// The type scale: only these font sizes in the renderer (docs/ARCHITECTURE.md, "Tip ölçeği"). Pixel-font / drawn text
// is outside it. Which size a text gets is by its function (10 px = short number badges only) — that part is reviewed,
// not tested. Run from the repo root (npm run test:renderer).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED = new Set([10, 11, 12, 13, 15, 18, 22])
const root = join(process.cwd(), 'src/renderer/src')
const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.(tsx?|css)$/.test(f) ? [join(d, f)] : []))

const off: string[] = []
for (const f of files(root)) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('font-pixel')) return
      for (const m of line.matchAll(/text-\[([0-9.]+)px\]/g)) if (!ALLOWED.has(Number(m[1]))) off.push(`${f.slice(root.length + 1)}:${i + 1} ${m[1]}px`)
    })
}
assert.deepEqual(off, [], `font sizes outside the scale (10/11/12/13/15/18/22):\n${off.join('\n')}`)
console.log('  ✓ every text-[Npx] in the renderer is on the scale')
console.log('typeScale: 1 ok')
