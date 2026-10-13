// Regenerate THIRD_PARTY_NOTICES.md after dependency changes: npm run notices
// Third-party notices for everything that ships in the app: production deps (+ their deps)
// and the runtime libraries bundled into the renderer from devDependencies.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
const root = process.argv[2] ?? process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundled = ['react', 'react-dom', 'zustand', 'react-i18next', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit']
const seen = new Map()
function resolveDir(name, from) {
  let d = from
  while (true) {
    const p = join(d, 'node_modules', name)
    if (existsSync(join(p, 'package.json'))) return p
    if (d === root || d === dirname(d)) return null
    d = dirname(d); if (d.endsWith('node_modules')) d = dirname(d)
  }
}
function visit(name, from) {
  const dir = resolveDir(name, from); if (!dir) return
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const key = `${p.name}@${p.version}`; if (seen.has(key)) return
  seen.set(key, { name: p.name, version: p.version, license: typeof p.license === 'string' ? p.license : p.license?.type ?? JSON.stringify(p.licenses ?? 'UNKNOWN'), dir, repo: typeof p.repository === 'string' ? p.repository : p.repository?.url })
  for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) visit(dep, dir)
}
for (const d of [...Object.keys(pkg.dependencies), ...bundled]) visit(d, root)
const items = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
let out = `# Third-party notices\n\nAgentbits includes the open-source packages listed below. Each is used under its own license, reproduced here.\nThe Agentbits license (LICENSE) does not apply to these packages. Electron and Chromium notices ship with the app\n(LICENSE.electron.txt, LICENSES.chromium.html).\n\n| Package | Version | License |\n|---|---|---|\n`
for (const i of items) out += `| ${i.name} | ${i.version} | ${i.license} |\n`
out += '\n---\n'
for (const i of items) {
  const f = readdirSync(i.dir).find((x) => /^(licen[cs]e|copying)(\.|$|-)/i.test(x))
  const text = f ? readFileSync(join(i.dir, f), 'utf8').trim() : `(No license file in the package; declared license: ${i.license}${i.repo ? `, source: ${i.repo}` : ''})`
  out += `\n## ${i.name} ${i.version} — ${i.license}\n\n\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\`\n`
}
writeFileSync(process.argv[3] ?? join(root, 'THIRD_PARTY_NOTICES.md'), out)
console.log(items.length, 'packages;', items.filter((i) => !readdirSync(i.dir).some((x) => /^(licen[cs]e|copying)/i.test(x))).map((i) => i.name + ' ' + i.license).join(', '))
