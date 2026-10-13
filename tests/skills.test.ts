/** SKILL.md / GitHub address parsing (src/shared/skills.ts). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { buildSkillMd, isTextPath, parseFrontmatter, parseGithubUrl, skillIdentity, slugifySkillName } from '../src/shared/skills.ts'

// front matter
const md = `---
name: frontend-design
description: >
  Create distinctive frontend
  interfaces.
license: MIT
allowed-tools: "Read, Write"
---

# Frontend design

Body text.`
const fm = parseFrontmatter(md)
assert.equal(fm.meta.name, 'frontend-design')
assert.equal(fm.meta.description, 'Create distinctive frontend interfaces.')
assert.equal(fm.meta['allowed-tools'], 'Read, Write')
assert.ok(fm.body.startsWith('\n# Frontend design') || fm.body.startsWith('# Frontend design'))

const quoted = parseFrontmatter('---\r\nname: "x"\r\ndescription: "He said \\"hi\\""\r\n---\r\nbody')
assert.equal(quoted.meta.description, 'He said "hi"')
assert.equal(parseFrontmatter('no front matter').body, 'no front matter')
assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: |\n  line one\n  line two\n---\n').meta.description, 'line one\nline two')

// identity fallbacks
assert.deepEqual(skillIdentity(md, 'x'), { name: 'frontend-design', description: 'Create distinctive frontend interfaces.', hasFrontmatter: true })
const loose = skillIdentity('# Finans Raporu\n\nAylık finans raporlarını hazırlar.\n\n## Adımlar', 'dosya')
assert.equal(loose.name, 'finans-raporu')
assert.equal(loose.description, 'Aylık finans raporlarını hazırlar.')
assert.equal(loose.hasFrontmatter, false)
assert.equal(skillIdentity("plain text only", "My File").name, "my-file")

// names
assert.equal(slugifySkillName('Ürün Açıklaması Yazımı!'), 'urun-aciklamasi-yazimi')
assert.equal(slugifySkillName('---'), 'skill')
assert.ok(slugifySkillName('a'.repeat(100)).length <= 64)

// build
const built = buildSkillMd('Yeni Skill', 'Ne zaman: "rapor" isteğinde.', 'Gövde')
assert.equal(skillIdentity(built, 'x').name, 'yeni-skill')
assert.equal(skillIdentity(built, 'x').description, 'Ne zaman: "rapor" isteğinde.')

// GitHub addresses
assert.deepEqual(parseGithubUrl('anthropics/skills'), { owner: 'anthropics', repo: 'skills', ref: null, path: '', raw: false })
assert.deepEqual(parseGithubUrl('https://github.com/anthropics/skills/tree/main/skills/frontend-design'), {
  owner: 'anthropics', repo: 'skills', ref: 'main', path: 'skills/frontend-design', raw: false
})
assert.deepEqual(parseGithubUrl('https://github.com/o/r/blob/v1/a/SKILL.md'), { owner: 'o', repo: 'r', ref: 'v1', path: 'a/SKILL.md', raw: false })
assert.deepEqual(parseGithubUrl('https://raw.githubusercontent.com/o/r/main/x/y.md'), { owner: 'o', repo: 'r', ref: 'main', path: 'x/y.md', raw: true })
assert.equal(parseGithubUrl('https://gitlab.com/o/r'), null)
assert.equal(parseGithubUrl('https://github.com/o/r/issues/3'), null)
assert.deepEqual(parseGithubUrl('https://github.com/o/r.git'), { owner: 'o', repo: 'r', ref: null, path: '', raw: false })

// text files
assert.ok(isTextPath('SKILL.md') && isTextPath('scripts/run.py') && isTextPath('LICENSE') && isTextPath('reference/api.json'))
assert.ok(!isTextPath('assets/logo.png') && !isTextPath('bin/tool.exe'))

console.log('all skills cases pass')
