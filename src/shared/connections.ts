/**
 * Connections (servers, databases): shared types and pure helpers used by both
 * the main process (enforcement) and the renderer (display). Enforcement only
 * ever happens in main; nothing here is trusted from the renderer.
 * The rules themselves (types, classification) are in `./connectionRules`; this
 * module adds the translated labels.
 */
import { ts } from './i18n'
import type { AccessLevel, ConnectionKind, SshReason } from './connectionRules'

export * from './connectionRules'

/** Display labels in the current UI language (getters: read at render time). */
export const KIND_LABEL: Record<ConnectionKind, string> = {
  get ssh() {
    return ts('main:connections.kind.ssh')
  },
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  mssql: 'Microsoft SQL Server'
}
/** Name of an access level; `lng` forces a language (e.g. 'en' for text shown to agents). */
export const levelLabel = (l: AccessLevel, lng?: string): string => ts(`main:connections.level.${l}`, lng ? { lng } : undefined)

export const LEVEL_LABEL: Record<AccessLevel, string> = {
  get none() {
    return levelLabel('none')
  },
  get read() {
    return levelLabel('read')
  },
  get write() {
    return levelLabel('write')
  },
  get execute() {
    return levelLabel('execute')
  },
  get admin() {
    return levelLabel('admin')
  }
}

const hints = (group: 'db' | 'ssh'): Record<AccessLevel, string> => ({
  get none() {
    return ts(`main:connections.hint.${group}.none`)
  },
  get read() {
    return ts(`main:connections.hint.${group}.read`)
  },
  get write() {
    return ts(`main:connections.hint.${group}.write`)
  },
  get execute() {
    return ts(`main:connections.hint.${group}.execute`)
  },
  get admin() {
    return ts(`main:connections.hint.${group}.admin`)
  }
})
export const LEVEL_HINT: Record<'db' | 'ssh', Record<AccessLevel, string>> = { db: hints('db'), ssh: hints('ssh') }

/** Text for a `classifyCommand` reason; `lng` forces a language (e.g. 'en' for text shown to agents). */
export function sshReasonText(reason: SshReason, lng?: string): string {
  const o = lng ? { lng } : undefined
  switch (reason.code) {
    case 'empty':
      return ts('main:connections.ssh.emptyCommand', o)
    case 'chaining':
      return ts('main:connections.ssh.chaining', o)
    case 'findExec':
      return ts('main:connections.ssh.findExec', o)
    case 'notAllowed':
      return ts('main:connections.ssh.notAllowed', { ...o, segment: reason.segment })
    case 'unsafeRead':
      return ts('main:connections.ssh.unsafeRead', { ...o, segment: reason.segment })
  }
}
