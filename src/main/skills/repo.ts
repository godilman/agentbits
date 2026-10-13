import { randomUUID } from 'crypto'
import { getDb } from '../db'
import type { Skill, SkillAssignment, SkillFileInfo, SkillSource, SkillTargetType } from '@shared/skills'
import { isTextPath } from '@shared/skills'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function parse<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

const mapSkill = (r: Row, assignments: SkillAssignment[]): Skill => ({
  id: r.id,
  name: r.name,
  description: r.description,
  source: parse<SkillSource>(r.source, { type: 'created' }),
  enabled: !!r.enabled,
  modified: !!r.modified,
  hasScripts: !!r.has_scripts,
  fileCount: r.file_count,
  size: r.size,
  warnings: parse<string[]>(r.warnings, []),
  assignments,
  installedAt: r.installed_at,
  updatedAt: r.updated_at
})

export interface SkillWrite {
  name: string
  description: string
  source: SkillSource
  hasScripts: boolean
  warnings: string[]
  files: Map<string, Uint8Array>
  modified?: boolean
}

export const skillsRepo = {
  list(): Skill[] {
    const db = getDb()
    const assigns = db.prepare('SELECT skill_id, target_type, target_id FROM skill_assignments ORDER BY created_at').all() as Row[]
    const by = new Map<string, SkillAssignment[]>()
    for (const a of assigns) {
      if (!by.has(a.skill_id)) by.set(a.skill_id, [])
      by.get(a.skill_id)!.push({ type: a.target_type, id: a.target_id })
    }
    return (db.prepare('SELECT * FROM skills ORDER BY name COLLATE NOCASE').all() as Row[]).map((r) => mapSkill(r, by.get(r.id) ?? []))
  },

  get(id: string): Skill | null {
    return this.list().find((s) => s.id === id) ?? null
  },

  byName(name: string): Skill | null {
    const r = getDb().prepare('SELECT id FROM skills WHERE name = ? COLLATE NOCASE').get(name) as Row | undefined
    return r ? this.get(r.id) : null
  },

  /** Inserts a skill, or replaces the files of the one with `id` (assignments are kept). */
  write(input: SkillWrite, id?: string): Skill {
    const db = getDb()
    const sid = id ?? randomUUID()
    const size = [...input.files.values()].reduce((n, b) => n + b.length, 0)
    db.transaction(() => {
      if (id) {
        db.prepare(
          `UPDATE skills SET name = ?, description = ?, source = ?, has_scripts = ?, file_count = ?, size = ?, warnings = ?,
             modified = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
        ).run(input.name, input.description, JSON.stringify(input.source), input.hasScripts ? 1 : 0, input.files.size, size, JSON.stringify(input.warnings), input.modified ? 1 : 0, id)
        db.prepare('DELETE FROM skill_files WHERE skill_id = ?').run(id)
      } else {
        db.prepare(
          `INSERT INTO skills(id, name, description, source, has_scripts, file_count, size, warnings, modified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(sid, input.name, input.description, JSON.stringify(input.source), input.hasScripts ? 1 : 0, input.files.size, size, JSON.stringify(input.warnings), input.modified ? 1 : 0)
      }
      const ins = db.prepare('INSERT INTO skill_files(skill_id, path, data, size) VALUES (?, ?, ?, ?)')
      for (const [path, data] of input.files) ins.run(sid, path, Buffer.from(data), data.length)
    })()
    return this.get(sid)!
  },

  setEnabled(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE skills SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM skills WHERE id = ?').run(id)
  },

  files(id: string): SkillFileInfo[] {
    return (getDb().prepare('SELECT path, size FROM skill_files WHERE skill_id = ? ORDER BY path').all(id) as Row[]).map((r) => ({
      path: r.path,
      size: r.size,
      text: isTextPath(r.path)
    }))
  },

  file(id: string, path: string): Buffer | null {
    const r = getDb().prepare('SELECT data FROM skill_files WHERE skill_id = ? AND path = ?').get(id, path) as Row | undefined
    return r ? (r.data as Buffer) : null
  },

  allFiles(id: string): Map<string, Buffer> {
    const out = new Map<string, Buffer>()
    for (const r of getDb().prepare('SELECT path, data FROM skill_files WHERE skill_id = ?').all(id) as Row[]) out.set(r.path, r.data as Buffer)
    return out
  },

  assign(id: string, type: SkillTargetType, targetId: string, on: boolean): void {
    const db = getDb()
    if (on) db.prepare('INSERT OR IGNORE INTO skill_assignments(skill_id, target_type, target_id) VALUES (?, ?, ?)').run(id, type, targetId)
    else db.prepare('DELETE FROM skill_assignments WHERE skill_id = ? AND target_type = ? AND target_id = ?').run(id, type, targetId)
  },

  newId(): string {
    return randomUUID()
  }
}
