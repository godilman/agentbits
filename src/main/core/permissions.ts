import type { AgentPermissions } from '@shared/types'
import { resolve, relative, isAbsolute } from 'path'

/** Maps the permission matrix onto Claude Code built-in tool names. */
export function toolsFor(p: AgentPermissions): string[] {
  const tools: string[] = []
  if (p.fsRead) tools.push('Read', 'Glob', 'Grep')
  if (p.fsWrite) tools.push('Edit', 'Write')
  if (p.terminal) tools.push('Bash')
  if (p.network) tools.push('WebFetch', 'WebSearch')
  return tools
}

/** Human readable capability list injected into prompts. */
export function describePermissions(p: AgentPermissions): string {
  const yes = (b: boolean): string => (b ? 'ALLOWED' : 'DENIED')
  return [
    `- File system read: ${yes(p.fsRead)}`,
    `- File system write: ${yes(p.fsWrite)}`,
    `- Terminal / shell: ${yes(p.terminal)}`,
    `- Network access: ${yes(p.network)}`,
    `- Browser: ${yes(p.browser)}`,
    p.allowedPaths.length ? `- Extra allowed paths: ${p.allowedPaths.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** True if `target` is inside the workspace or one of the allowed paths. */
export function isPathAllowed(p: AgentPermissions, workspaceRoot: string, target: string): boolean {
  const roots = [workspaceRoot, ...p.allowedPaths].filter(Boolean).map((r) => resolve(r))
  const abs = resolve(workspaceRoot || '.', target)
  return roots.some((root) => {
    const rel = relative(root, abs)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}
