import { toolExec, toolList, toolQuery, toolSchema, type AgentCtx, type ToolOutput } from './service'

/**
 * Connection tools offered to agents. The same definitions are served to Claude
 * Code over MCP and to API providers as native function calling; execution is
 * always `runTool` in the main process (permissions, approvals, audit).
 */
export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const CONNECTION_TOOLS: ToolSpec[] = [
  {
    name: 'connections_list',
    description:
      'List the servers and databases you are allowed to use, with their description, purpose, environment and your access level.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'db_schema',
    description: 'Show tables and columns of a database connection. Use `filter` (part of a schema or table name) to narrow it down.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection name, exactly as listed' },
        filter: { type: 'string', description: 'Optional part of a schema/table name' }
      },
      required: ['connection'],
      additionalProperties: false
    }
  },
  {
    name: 'db_query',
    description:
      'Run ONE SQL statement on a database connection. Prefer SELECT with LIMIT. Your access level decides what is allowed; production changes need the user’s approval. Returns at most 200 rows.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection name, exactly as listed' },
        sql: { type: 'string', description: 'A single SQL statement' }
      },
      required: ['connection', 'sql'],
      additionalProperties: false
    }
  },
  {
    name: 'ssh_exec',
    description:
      'Run a command on an SSH server connection. Only commands allowed for your access level are accepted (pipes between allowed commands are fine; ; && > < ` $() need admin). Output is capped at 64 KB, 60 s timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection name, exactly as listed' },
        command: { type: 'string', description: 'The command line' }
      },
      required: ['connection', 'command'],
      additionalProperties: false
    }
  }
]

export async function runTool(ctx: AgentCtx, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const s = (k: string): string => (typeof args?.[k] === 'string' ? (args[k] as string) : '')
  try {
    switch (name) {
      case 'connections_list':
        return toolList(ctx)
      case 'db_schema':
        return await toolSchema(ctx, s('connection'), s('filter') || undefined)
      case 'db_query':
        return await toolQuery(ctx, s('connection'), s('sql'))
      case 'ssh_exec':
        return await toolExec(ctx, s('connection'), s('command'))
      default:
        return { text: `Unknown tool: ${name}`, isError: true }
    }
  } catch (e) {
    return { text: `ERROR: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}
