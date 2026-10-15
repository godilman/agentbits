/**
 * Skills: instruction packages (a folder with SKILL.md + optional reference files / scripts), in the format used by
 * Claude's Agent Skills and many GitHub collections. Installed into Agentbits' database (files stored as blobs, so
 * backups and resets include them), assigned to agents or units, and read by agents on demand (`skill_read`).
 * Pure helpers here are shared by main, renderer and the unit tests.
 */

export type SkillSourceType = 'github' | 'zip' | 'folder' | 'markdown' | 'created' | 'package'

export interface SkillSource {
  type: SkillSourceType
  /** GitHub page / raw URL, or the local path it was installed from. */
  location?: string
  /** Folder of this skill inside the source (GitHub repo or archive), '' for the root. */
  subpath?: string
  /** Git ref (branch / tag / commit) when known. */
  ref?: string
}

export type SkillTargetType = 'agent' | 'unit'

export interface SkillAssignment {
  type: SkillTargetType
  id: string
}

export interface Skill {
  id: string
  name: string
  description: string
  source: SkillSource
  enabled: boolean
  /** Edited in Agentbits after install (an update from the source would overwrite it). */
  modified: boolean
  hasScripts: boolean
  fileCount: number
  size: number
  warnings: string[]
  assignments: SkillAssignment[]
  installedAt: string
  updatedAt: string
}

export interface SkillFileInfo {
  path: string
  size: number
  /** Readable as text (Markdown, code, JSON…). */
  text: boolean
}

export interface SkillDetail {
  skill: Skill
  files: SkillFileInfo[]
  skillMd: string
}

/** A skill found in a source, before installing. `key` identifies it inside the preview. */
export interface SkillCandidate {
  key: string
  name: string
  description: string
  subpath: string
  fileCount: number
  size: number
  hasScripts: boolean
  hasBinaries: boolean
  /** Lines in the instructions that look like prompt injection (shown, not blocked). */
  suspicious: string[]
  /** Problems found while reading (skipped files, missing description…), already translated. */
  notes: string[]
  /** An installed skill with the same name exists (installing updates it, assignments are kept). */
  existingId: string | null
  skillMdPreview: string
}

export interface SkillPreview {
  stagingId: string
  sourceLabel: string
  candidates: SkillCandidate[]
}

export type SkillSourceInput = { type: 'github'; url: string } | { type: 'path'; path: string }

/** Effective skill of an agent and where it comes from (direct or through a unit). */
export interface AgentSkill {
  skill: Skill
  via: { type: SkillTargetType; id: string; name: string }[]
}

export const SKILL_LIMITS = {
  /** Download / archive size. */
  maxArchiveBytes: 50 * 1024 * 1024,
  /** Unpacked size of one skill. */
  maxSkillBytes: 10 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 300,
  /** What `skill_read` returns at most per call. */
  maxReadChars: 200_000,
  /** Skills listed in an agent's prompt. */
  maxListed: 40
} as const

export const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|psm1|bat|cmd|rb|pl|php|lua|r)$/i
export const BINARY_EXT = /\.(exe|dll|so|dylib|bin|jar|msi|app|com|scr|deb|rpm|pkg|dmg)$/i
export const TEXT_EXT =
  /\.(md|markdown|txt|text|json|jsonc|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|html?|css|scss|sql|sh|bash|zsh|py|js|mjs|cjs|ts|tsx|jsx|ps1|psm1|bat|cmd|rb|pl|php|lua|r|go|rs|java|kt|swift|c|h|cpp|hpp|cs|env\.example|gitignore|license)$/i
/** Folders / files never taken from a source. */
export const SKIP_PATH = /(^|\/)(\.git|node_modules|__MACOSX|\.DS_Store|Thumbs\.db|\.venv|__pycache__)(\/|$)/

export function isTextPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return TEXT_EXT.test(base) || !/\.[^./]+$/.test(base) || /^(license|readme|notice|changelog)$/i.test(base)
}

/** Agent Skills naming: lowercase letters, digits and hyphens, at most 64 characters. */
export function slugifySkillName(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ı/g, 'i') // i18n-ignore (Turkish dotless i in names)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'skill'
  )
}

/**
 * Minimal YAML front matter reader for SKILL.md (`---` block at the top): `key: value`, quoted values and
 * `|` / `>` block scalars. Unknown keys are kept as text. Returns the body without the block.
 */
export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const text = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    const key = kv[1].toLowerCase()
    let value = kv[2].trim()
    if (/^[|>][+-]?$/.test(value)) {
      const folded = value.startsWith('>')
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim())
      value = folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
    } else {
      // Plain multi-line value: indented continuation lines.
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*[A-Za-z0-9_-]+:\s/.test(lines[i + 1])) value += ' ' + lines[++i].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
        if (kv[2].trim().startsWith('"')) value = value.replace(/\\"/g, '"').replace(/\\n/g, '\n')
      }
    }
    meta[key] = value
  }
  return { meta, body: text.slice(m[0].length) }
}

/** Name + description of a SKILL.md, falling back to the folder / file name and the first paragraph. */
export function skillIdentity(md: string, fallbackName: string): { name: string; description: string; hasFrontmatter: boolean } {
  const { meta, body } = parseFrontmatter(md)
  const hasFrontmatter = Object.keys(meta).length > 0
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  const name = slugifySkillName(meta.name || heading || fallbackName)
  let description = (meta.description ?? '').trim()
  if (!description) {
    const para = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#') && !p.startsWith('```'))
    description = (para ?? '').replace(/\s+/g, ' ').slice(0, 300)
  }
  return { name, description: description.slice(0, 1024), hasFrontmatter }
}

/** SKILL.md text for a skill written in Agentbits (or a single .md without front matter). */
export function buildSkillMd(name: string, description: string, body: string): string {
  const desc = description.replace(/\r?\n/g, ' ').trim()
  return `---\nname: ${slugifySkillName(name)}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.trim()}\n`
}

/**
 * GitHub locations: `owner/repo`, https://github.com/owner/repo[/tree|blob/<ref>/<path>], or a raw.githubusercontent.com
 * file URL. Returns null for anything else.
 */
export function parseGithubUrl(input: string): { owner: string; repo: string; ref: string | null; path: string; raw: boolean } | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const short = /^([A-Za-z0-9][\w.-]*)\/([\w.-]+)$/.exec(s)
  if (short) return { owner: short[1], repo: short[2], ref: null, path: '', raw: false }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (u.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    return { owner: parts[0], repo: parts[1], ref: parts[2], path: parts.slice(3).join('/'), raw: true }
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null
  if (parts.length < 2) return null
  const [owner, repo, kind, ref, ...rest] = parts
  if (!kind) return { owner, repo, ref: null, path: '', raw: false }
  if ((kind === 'tree' || kind === 'blob') && ref) return { owner, repo, ref, path: rest.join('/'), raw: false }
  return null
}
