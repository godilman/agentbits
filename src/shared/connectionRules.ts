/**
 * Connection rules without any UI text: types, access levels, default ports and the
 * SQL / SSH command classification that permission checks rely on. Pure and free of
 * imports so the unit tests can load it directly (`tests/connections.classify.test.ts`).
 * Translated labels live in `./connections`, which re-exports everything here.
 */

export type ConnectionKind = 'ssh' | 'postgres' | 'mysql' | 'mssql'
export type ConnectionEnv = 'development' | 'staging' | 'production'
/** Ordered: none < read < write < execute < admin. */
export type AccessLevel = 'none' | 'read' | 'write' | 'execute' | 'admin'
export type SshAuth = 'key-file' | 'key' | 'password' | 'agent'

export const LEVEL_ORDER: AccessLevel[] = ['none', 'read', 'write', 'execute', 'admin']
export const levelRank = (l: AccessLevel): number => LEVEL_ORDER.indexOf(l)
export const atLeast = (have: AccessLevel, need: AccessLevel): boolean => levelRank(have) >= levelRank(need)

export const DEFAULT_PORT: Record<ConnectionKind, number> = { ssh: 22, postgres: 5432, mysql: 3306, mssql: 1433 }
export const ENV_LABEL: Record<ConnectionEnv, string> = { development: 'Development', staging: 'Staging', production: 'Production' }
export const isDb = (k: ConnectionKind): boolean => k !== 'ssh'
/** The database runs on this computer: nothing crosses a network, so no TLS is needed. */
export const isLocalHost = (host: string): boolean => /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/.test(host.trim().toLowerCase())

/** A literal private / local network address: 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT, Tailscale), 169.254/16, fc00::/7, fe80::/10. */
export function isPrivateIp(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (m.slice(1).some((x) => Number(x) > 255)) return false
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
  }
  return h.includes(':') && /^(f[cd][0-9a-f]{0,2}|fe[89ab][0-9a-f]?):/.test(h)
}

/**
 * A Production database goes over TLS, or never leaves the machine it is reached from: this computer, or — through
 * an SSH tunnel — the SSH server itself (host 127.0.0.1 / localhost there). A tunnel to another machine is encrypted
 * only up to the SSH server, so without TLS that last hop needs the yes too. Otherwise only with the user's explicit
 * yes (`allowPlaintext`, audited, bound to its target: `plaintextTarget`). Address classes can't decide this on their
 * own: company networks use public blocks internally (e.g. 192.1.x.x), so the editor only words its warning by `isPrivateIp`.
 */
export function transportCheck(c: { kind: ConnectionKind; env: ConnectionEnv; host: string; ssl: boolean; allowPlaintext: boolean }): 'ok' | 'needsTls' {
  return c.kind === 'ssh' || c.env !== 'production' || c.ssl || c.allowPlaintext || isLocalHost(c.host) ? 'ok' : 'needsTls'
}

/** What an unencrypted yes was given for: the route, host and port. Another target needs a new yes. */
export const plaintextTarget = (c: { viaSshId: string | null; host: string; port: number }): string => `${c.viaSshId ?? ''}|${c.host.trim().toLowerCase()}:${c.port}`

/**
 * Read-only commands an SSH connection allows by default (`*` = any arguments). Programs that can run other
 * programs or write files (awk, sed scripts, interpreters, `sort -o`, `find -exec`…) are refused at read level by
 * `readUnsafe()` even when a list allows them — the list alone is not a security boundary.
 */
export const DEFAULT_SSH_READ = [
  'ls *',
  'pwd',
  'cat *',
  'head *',
  'tail *',
  'grep *',
  'wc *',
  'df *',
  'du *',
  'free *',
  'uptime',
  'whoami',
  'hostname',
  'uname *',
  'id',
  'date',
  'ps *',
  'top -b -n 1*',
  'systemctl status *',
  'systemctl list-units*',
  'journalctl *',
  'docker ps*',
  'docker logs *',
  'docker stats --no-stream*',
  'ss *',
  'netstat *',
  'ip a*',
  'ip r*',
  'find *',
  'stat *',
  'sort *',
  'uniq *',
  'sed -n *'
]

/**
 * Programs that can run other programs or are general-purpose languages: never "read", whatever a list says.
 * (They may still be granted explicitly in the write / execute lists.)
 */
const NEVER_READ = new Set([
  'awk', 'gawk', 'mawk', 'nawk', 'perl', 'python', 'python2', 'python3', 'ruby', 'node', 'nodejs', 'deno', 'bun', 'php', 'lua',
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'busybox', 'env', 'xargs', 'nice', 'nohup', 'timeout', 'watch',
  'sudo', 'su', 'doas', 'pkexec', 'eval', 'exec', 'command', 'builtin', 'source', '.', 'ssh', 'scp', 'sftp', 'rsync', 'curl', 'wget',
  'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ftp', 'tee', 'dd', 'vi', 'vim', 'nvim', 'nano', 'emacs', 'less', 'more', 'man',
  'git', 'make', 'docker-compose', 'kubectl', 'crontab', 'at', 'batch', 'script', 'expect', 'tclsh', 'gdb', 'strace', 'ltrace',
  'openssl', 'sqlite3', 'mysql', 'psql', 'sqlcmd', 'mongo', 'mongosh', 'redis-cli', 'systemd-run', 'flock', 'chroot', 'unshare', 'nsenter', 'setsid', 'stdbuf'
])

/** Splits a command segment into words (quotes kept together, quotes removed). */
function words(seg: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/**
 * True when a segment that a read list matched can still run programs or change something: interpreters, sed
 * scripts other than "print lines", `sort -o / --compress-program`, `uniq` with an output file, `ss -K`, `ip` changes,
 * `journalctl` maintenance, `find` actions, `docker` / `systemctl` changes, `date -s`, `tail -f` loops, redirect-like
 * arguments. Fails closed: anything it can't reason about in a known program is unsafe.
 */
export function readUnsafe(seg: string): boolean {
  const w = words(seg.trim())
  if (!w.length) return true
  const prog = w[0].replace(/^.*\//, '')
  const args = w.slice(1)
  if (NEVER_READ.has(prog)) return true
  const has = (re: RegExp): boolean => args.some((a) => re.test(a))
  switch (prog) {
    case 'sed': {
      // Only `sed -n '<range>p' [files]` (line numbers, $ or /regex/). EVERY script counts — each `-e` / `--expression`,
      // or the first operand when there is none — so a second script can't add e / w / r commands; no in-place editing.
      const PRINT = /^(\d+|\$|\/[^/\\]*\/)(,(\d+|\$|\/[^/\\]*\/))?p$/
      const scripts: string[] = []
      let hasExpr = false
      let quiet = false
      const operands: string[] = []
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '-n' || a === '--quiet' || a === '--silent') quiet = true
        else if (a === '-e' || a === '--expression') {
          hasExpr = true
          scripts.push(args[++i] ?? '')
        } else if (a.startsWith('--expression=')) {
          hasExpr = true
          scripts.push(a.slice('--expression='.length))
        } else if (a === '--') {
          operands.push(...args.slice(i + 1))
          break
        } else if (a.startsWith('-')) return true // -i, -f, -s, -z, -E, combined flags like -ne…: not a plain print
        else operands.push(a)
      }
      if (!hasExpr) scripts.push(operands.shift() ?? '')
      return !quiet || !scripts.length || !scripts.every((x) => PRINT.test(x))
    }
    case 'sort':
      return has(/^(-o|--output|--compress-program|-T|--temporary-directory)/) || has(/^-[a-zA-Z]*o/)
    case 'uniq':
      return args.filter((a) => !a.startsWith('-')).length > 1
    case 'ss':
      return has(/^(-K|--kill|-[a-zA-Z]*K)/)
    case 'ip':
      return has(/^(add|del|delete|change|chg|replace|flush|set|append|prepend|restore|save|exec|monitor|up|down|attach|detach)$/) || has(/^-(batch|b|force)$/)
    case 'journalctl':
      return has(/^--(vacuum|rotate|flush|sync|relinquish-var|smart-relinquish-var|setup-keys|update-catalog|follow)/) || has(/^-[a-zA-Z]*f/)
    case 'find':
      return has(/^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/)
    case 'tail':
      return has(/^(-f|-F|--follow|--retry|-[a-zA-Z]*[fF])/)
    case 'date':
      return has(/^(-s|--set)/)
    case 'top':
      return !has(/^-b/)
    case 'docker':
      return !/^(ps|logs|stats|images|version|info|top|port|diff)$/.test(args.find((a) => !a.startsWith('-')) ?? '')
    case 'systemctl':
      return !/^(status|list-units|list-unit-files|list-timers|show|is-active|is-enabled|is-failed|cat)$/.test(args.find((a) => !a.startsWith('-')) ?? '')
    default:
      return false
  }
}

/* ───────────────────────────── SQL classification ───────────────────────────── */

export type SqlClass = 'read' | 'write' | 'execute' | 'admin'

/** Marker left where a PostgreSQL `U&"…"` identifier (escapes that can spell any name) was: fails closed to admin. */
const UNICODE_IDENT = ' __unicode_identifier__ '

/**
 * Removes comments and string literals so keywords inside them don't count. Quoted identifiers (`"name"`, `` `name` ``,
 * `[name]`) keep their text — `"pg_read_file"(…)` is still that function — with anything that isn't a word character
 * turned into `_`, so a quoted name can't create keywords or statement breaks.
 * `backslashEscapes`: whether `\'` escapes a quote (MySQL, PostgreSQL `E''`) or not (standard SQL strings);
 * classifySql tries both readings and keeps the stricter result, so neither can hide code inside a "string".
 */
function stripSql(sql: string, backslashEscapes = true): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
    } else if (c === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === '\\' && backslashEscapes) i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out += ' x '
    } else if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      if (c === '"' && /U&\s*$/i.test(out)) out = out.replace(/U&\s*$/i, '') + UNICODE_IDENT
      let text = ''
      i++
      while (i < sql.length) {
        if (sql[i] === close && sql[i + 1] === close && c !== '[') {
          text += close
          i += 2
        } else if (sql[i] === '\\' && backslashEscapes && c === '"') {
          text += sql[i + 1] ?? ''
          i += 2
        } else if (sql[i] === close) break
        else text += sql[i++]
      }
      i++
      out += ' ' + (text.replace(/\W/g, '_') || 'x') + ' '
    } else if (c === '$' && /[A-Za-z_$]/.test(n ?? '')) {
      // PostgreSQL dollar quoting: $tag$ ... $tag$
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        i = end < 0 ? sql.length : end + tag.length
        out += ' x '
      } else {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Splits on `;` outside literals; empty statements are dropped. */
export function splitStatements(sql: string, backslashEscapes = true): string[] {
  return stripSql(sql, backslashEscapes)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|MERGE|REPLACE|UPSERT)\b/i
const ADMIN_WORDS = /\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|RENAME)\b/i
/** Functions that change state even inside a SELECT (sequences, advisory locks). */
const WRITE_FUNCS = /\b(nextval|setval|pg_advisory_lock|pg_advisory_xact_lock|pg_try_advisory_lock|pg_try_advisory_xact_lock)\s*\(|\bNEXT\s+VALUE\s+FOR\b/i
/**
 * Functions that read / write server files, run other queries or reach other servers, end sessions or change
 * settings — admin only, wherever they appear (PostgreSQL, MySQL, SQL Server).
 */
const ADMIN_FUNCS =
  /\b(lo_import|lo_export|lo_unlink|lo_from_bytea|lo_put|lo_create|pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|pg_file_\w+|pg_logdir_ls|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_create_\w+|pg_drop_\w+|pg_replication_\w+|set_config|dblink\w*|query_to_xml\w*|cursor_to_xml\w*|table_to_xml\w*|query_to_json\w*|load_file|get_lock|release_lock|release_all_locks|sys_exec|sys_eval|openrowset|opendatasource|openquery|openxml|xp_\w+|sp_\w+|fn_xe_\w+|fn_get_audit_file|fn_trace_\w+)\s*\(/i
/** INTO that isn't the target of INSERT / MERGE / REPLACE: `SELECT … INTO table` / `INTO OUTFILE` / `INTO @var`. */
const selectInto = (s: string): boolean => /\bINTO\b/i.test(s.replace(/\b(INSERT|MERGE|REPLACE)\s+(IGNORE\s+|LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+)*INTO\b/gi, ' '))

/** Classifies one statement (already stripped of literals). Unknown → admin. */
function classifyOne(s: string): SqlClass {
  const first = /^\s*\(?\s*([A-Za-z]+)/.exec(s)?.[1]?.toUpperCase() ?? ''
  const rest = s.slice(s.toUpperCase().indexOf(first) + first.length)
  switch (first) {
    case 'SELECT':
    case 'WITH':
    case 'VALUES':
    case 'TABLE':
      // SELECT ... INTO creates a table (PG / MSSQL) or a file (MySQL), also after a WITH; FOR UPDATE takes write locks.
      if (selectInto(rest)) return 'admin'
      if (ADMIN_WORDS.test(rest) || ADMIN_FUNCS.test(rest)) return 'admin'
      if (WRITE_WORDS.test(rest) || WRITE_FUNCS.test(rest) || /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(rest)) return 'write'
      return 'read'
    case 'SHOW':
    case 'DESCRIBE':
    case 'DESC':
      return ADMIN_FUNCS.test(rest) ? 'admin' : 'read'
    case 'EXPLAIN':
      // EXPLAIN ANALYZE executes the statement.
      if (/\bANALYZE\b/i.test(rest)) return classifyOne(rest.replace(/^\s*(\(.*?\)|ANALYZE|VERBOSE|\s)*/i, ''))
      return 'read'
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
    case 'REPLACE':
    case 'UPSERT':
      return ADMIN_WORDS.test(rest) || ADMIN_FUNCS.test(rest) ? 'admin' : 'write'
    case 'CALL':
    case 'EXEC':
    case 'EXECUTE':
      return 'execute'
    default:
      // DDL, transaction control, SET, USE, COPY, DO, VACUUM, LOCK… and anything unknown.
      return 'admin'
  }
}

export interface SqlCheck {
  statements: number
  cls: SqlClass
  /** The level an agent needs to run this. */
  needs: AccessLevel
}

export function classifySql(sql: string): SqlCheck {
  const rank: SqlClass[] = ['read', 'write', 'execute', 'admin']
  // Both readings of backslashes in strings; the stricter wins (a "string" can't hide code under either dialect).
  const a = classifyWith(sql, true)
  const b = classifyWith(sql, false)
  const cls = rank[Math.max(rank.indexOf(a.cls), rank.indexOf(b.cls))]
  return { statements: Math.max(a.statements, b.statements), cls, needs: cls }
}

function classifyWith(sql: string, backslashEscapes: boolean): SqlCheck {
  const parts = splitStatements(sql, backslashEscapes)
  if (!parts.length) return { statements: 0, cls: 'read', needs: 'read' }
  // MySQL runs the text of `/*! … */` (and `/*M! … */`) "comments"; the stripper would hide it, so fail closed.
  if (/\/\*[M]?!/.test(sql)) return { statements: parts.length, cls: 'admin', needs: 'admin' }
  if (parts.some((p) => p.includes(UNICODE_IDENT.trim()))) return { statements: parts.length, cls: 'admin', needs: 'admin' }
  const rank: SqlClass[] = ['read', 'write', 'execute', 'admin']
  let cls: SqlClass = 'read'
  for (const p of parts) {
    const c = classifyOne(p)
    if (rank.indexOf(c) > rank.indexOf(cls)) cls = c
  }
  // Several statements in one call only for admins (keeps the read-only path simple to reason about).
  if (parts.length > 1) cls = 'admin'
  return { statements: parts.length, cls, needs: cls }
}

/* ───────────────────────────── SSH command matching ───────────────────────────── */

/** Characters that chain or redirect commands; never allowed below admin. Pipes are checked per segment. */
const SHELL_META = /[;&><`\n\r]|\$\(|\|\|/

/** `pattern` with `*` wildcards (any characters) against a whitespace-normalised command. */
export function commandMatches(command: string, pattern: string): boolean {
  const c = command.trim().replace(/\s+/g, ' ')
  const p = pattern.trim().replace(/\s+/g, ' ')
  if (!p) return false
  const toRe = (x: string): string => x.split('*').map((y) => y.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  // "sort *" also matches a bare "sort" (no arguments).
  const re = p.endsWith(' *') ? new RegExp('^' + toRe(p.slice(0, -2)) + '( .*)?$') : new RegExp('^' + toRe(p) + '$')
  return re.test(c)
}

/** Why a command needs admin (translated by `sshReasonText` in `./connections`). */
export type SshReason = { code: 'empty' } | { code: 'chaining' } | { code: 'findExec' } | { code: 'notAllowed'; segment: string } | { code: 'unsafeRead'; segment: string }

export interface SshCheck {
  needs: AccessLevel
  reason: SshReason | null
}

/**
 * Decides the level a command needs. Pipelines are allowed below admin only when
 * every segment is allowed; other shell operators require admin.
 */
export function classifyCommand(command: string, lists: { read: string[]; write: string[]; execute: string[] }): SshCheck {
  const cmd = command.trim()
  if (!cmd) return { needs: 'admin', reason: { code: 'empty' } }
  if (SHELL_META.test(cmd)) return { needs: 'admin', reason: { code: 'chaining' } }
  if (/\bfind\b[^|]*\s-(exec|execdir|delete|ok|fprint)/.test(cmd)) return { needs: 'admin', reason: { code: 'findExec' } }
  const segments = cmd.split('|').map((s) => s.trim())
  let need: AccessLevel = 'read'
  for (const seg of segments) {
    let segNeed: AccessLevel | null = null
    const readListed = lists.read.some((p) => commandMatches(seg, p))
    if (readListed && !readUnsafe(seg)) segNeed = 'read'
    else if (lists.write.some((p) => commandMatches(seg, p))) segNeed = 'write'
    else if (lists.execute.some((p) => commandMatches(seg, p))) segNeed = 'execute'
    if (!segNeed) return { needs: 'admin', reason: readListed ? { code: 'unsafeRead', segment: seg } : { code: 'notAllowed', segment: seg } }
    if (levelRank(segNeed) > levelRank(need)) need = segNeed
  }
  return { needs: need, reason: null }
}
