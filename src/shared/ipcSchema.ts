import type { ApiMethod } from './ipc'

/**
 * Argument shapes of every IPC method (security review #13): TypeScript types don't exist at run time, so main checks
 * each call against this table before the handler runs. `satisfies Record<ApiMethod, …>` makes a method without an entry
 * a type error. Deep object shapes are still checked by the handlers. `tests/ipcSchema.test.ts`.
 *
 * `s` string · `n` finite number · `b` boolean · `o` plain object · `S` string array · `A` array · `u` Uint8Array;
 * `|null` also accepts null; a trailing `?` makes the argument optional (undefined or null).
 */
export type ArgSpec = string

export const IPC_SCHEMA = {
  'settings:get': [],
  'notify:takePending': [],
  'settings:update': ['o'],
  'app:pickFolder': [],
  'app:info': [],
  'update:status': [],
  'update:check': [],
  'update:openPage': [],
  'app:openSupport': [],
  'app:feedbackMail': ['s', 'n?'],
  'providers:list': [],
  'providers:save': ['o', 's?'],
  'providers:delete': ['s'],
  'providers:test': ['s'],
  'providers:detectCli': [],
  'providers:models': ['o'],
  'agents:list': [],
  'agents:save': ['o', 's?', 'o?'],
  'agents:delete': ['s'],
  'agents:duplicate': ['s'],
  'agents:setStatus': ['s', 's'],
  'permissions:list': [],
  'permissions:update': ['s', 'o'],
  'units:list': [],
  'units:save': ['o', 's?'],
  'units:delete': ['s'],
  'units:addMember': ['s', 's', 's?'],
  'units:removeMember': ['s', 's'],
  'templates:list': [],
  'templates:instantiate': ['s', 'o?'],
  'memory:vectorStatus': [],
  'share:export': ['o'],
  'share:preview': ['o'],
  'share:import': ['s', 's|null'],
  'projects:list': [],
  'projects:save': ['o', 's?'],
  'projects:delete': ['s'],
  'projects:touch': ['S'],
  'projects:folderStatus': [],
  'projects:inspectFolder': ['s'],
  'tasks:list': ['o?'],
  'tasks:board': ['n'],
  'tasks:merge': ['s', 's'],
  'tasks:mergePending': ['s'],
  'tasks:result': ['s'],
  'tasks:changes': ['s'],
  'tasks:create': ['o'],
  'tasks:update': ['s', 'o'],
  'tasks:move': ['s', 's', 'n?', 'b?'],
  'tasks:delete': ['s'],
  'tasks:start': ['s', 'b?'],
  'tasks:retryReview': ['s'],
  'projects:startWork': ['s'],
  'tasks:waitingFor': ['s'],
  'promptBuilder:generate': ['s', 's', 's?'],
  'promptBuilder:cancel': ['s'],
  'runs:list': ['o?'],
  'runs:pause': ['s'],
  'runs:resume': ['s'],
  'runs:stop': ['s'],
  'runs:approve': ['s', 'b'],
  'logs:list': ['o'],
  'connections:list': [],
  'connections:save': ['o', 's?'],
  'connections:delete': ['s'],
  'connections:test': ['s'],
  'connections:schema': ['s', 'b?'],
  'connections:permissions': [],
  'connections:setPermission': ['s', 's', 's'],
  'approvals:list': [],
  'approvals:resolve': ['s', 'b'],
  'audit:list': ['o'],
  'app:pickFile': ['s?'],
  'skills:list': [],
  'skills:get': ['s'],
  'skills:file': ['s', 's'],
  'skills:preview': ['o'],
  'skills:install': ['s', 'S'],
  'skills:saveMd': ['s', 's?'],
  'skills:update': ['s'],
  'skills:setEnabled': ['s', 'b'],
  'skills:delete': ['s'],
  'skills:assign': ['s', 'o', 'b'],
  'skills:forAgent': ['s'],
  'skills:pickSource': ['s'],
  'skills:githubToken': [],
  'skills:setGithubToken': ['s'],
  'apps:list': [],
  'apps:save': ['o', 's?'],
  'apps:delete': ['s'],
  'apps:test': ['s'],
  'apps:signIn': ['s'],
  'apps:signOut': ['s'],
  'apps:setPolicy': ['s', 's', 's|null'],
  'apps:setPermission': ['s', 's', 'b'],
  'apps:import': ['o'],
  'agents:instruct': ['o'],
  'instructions:list': ['o'],
  'usage:summary': ['s|null?'],
  'usage:daily': ['n', 's|null?'],
  'messages:list': ['s?', 'n?', 's?'],
  'messages:send': ['s', 's', 's', 'o?'],
  'drafts:list': [],
  'drafts:save': ['o'],
  'files:list': ['o'],
  'files:byIds': ['S'],
  'files:get': ['s'],
  'files:pick': [],
  'files:add': ['s', 'S'],
  'files:addData': ['s', 's', 'u'],
  'files:delete': ['s'],
  'files:preview': ['s', 'n?', 'n?'],
  'files:search': ['s', 's'],
  'files:saveAs': ['s'],
  'files:open': ['s'],
  'files:reveal': ['s'],
  'files:setAccess': ['s', 's', 'b'],
  'files:setProjectShared': ['s', 'b'],
  'files:attachToTask': ['s', 'S'],
  'files:detachFromTask': ['s', 's'],
  'memory:list': ['o?'],
  'memory:add': ['s', 's', 's|null?', 's|null?'],
  'memory:delete': ['s'],
  'memory:update': ['s', 's', 'S'],
  'memory:graph': ['s|null?'],
  'memory:suggestions': [],
  'memory:accept': ['s', 's?'],
  'memory:dismiss': ['s'],
  'decisions:list': [],
  'decisions:save': ['o', 's?'],
  'decisions:delete': ['s'],
  'reports:list': ['n?'],
  'reports:generateDaily': ['s'],
  'reports:generateCustom': ['s', 's'],
  'reports:delete': ['s'],
  'stats:get': ['s?'],
  'terminal:list': [],
  'terminal:create': ['s?'],
  'terminal:write': ['s', 's'],
  'terminal:resize': ['s', 'n', 'n'],
  'terminal:kill': ['s'],
  'terminal:buffer': ['s'],
  'data:usage': [],
  'data:clearProject': ['s', 'S', 'o?'],
  'data:clearOrgMemory': ['o'],
  'data:pruneLogs': ['n'],
  'data:backup': [],
  'data:listBackups': [],
  'data:deleteBackup': ['s'],
  'data:restoreBackup': ['s'],
  'data:openFolder': [],
  'data:factoryReset': ['s'],
  'orchestrator:pauseAll': [],
  'orchestrator:resumeAll': [],
  'orchestrator:state': [],
} as const satisfies Record<ApiMethod, readonly ArgSpec[]>

function matches(v: unknown, spec: string): boolean {
  const optional = spec.endsWith('?')
  const base = optional ? spec.slice(0, -1) : spec
  const [kind, nullable] = base.split('|')
  if (v === undefined || v === null) return optional || (v === null && nullable === 'null')
  switch (kind) {
    case 's':
      return typeof v === 'string'
    case 'n':
      return typeof v === 'number' && Number.isFinite(v)
    case 'b':
      return typeof v === 'boolean'
    case 'o':
      return typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)
    case 'S':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
    case 'A':
      return Array.isArray(v)
    case 'u':
      return v instanceof Uint8Array
    default:
      return false
  }
}

/** True if `args` fit the method's declared arguments (no extra arguments, every one of the right kind). */
export function argsMatch(method: string, args: unknown[]): boolean {
  if (!Object.prototype.hasOwnProperty.call(IPC_SCHEMA, method)) return false
  const specs = IPC_SCHEMA[method as ApiMethod] as readonly string[]
  if (args.length > specs.length) return false
  return specs.every((spec, i) => matches(args[i], spec))
}
