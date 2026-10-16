import { toolExec, toolExport, toolList, toolQuery, toolSchema, type AgentCtx, type ToolOutput } from './service'

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
      'Run ONE SQL statement on a database connection. Prefer SELECT with LIMIT. Your access level decides what is allowed; production changes need the user’s approval. Returns at most 1000 rows (about 160 KB of text). To hand over data as a file or to get more rows, use db_export instead of paging and re-typing rows.',
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
    name: 'db_export',
    description:
      'Run ONE read (SELECT) on a database connection and save EVERY row (up to 100 000, whole cells) as a file the user downloads from Files: xlsx (Excel, default), csv, json, txt / tsv (tab-separated), md (Markdown table) or html (table). ' +
      'The rows go straight into the file, not to you: you get the row count, the columns and the first rows. CLI agents also get a copy in .agentbits-exports/ of their working folder to process with code. ' +
      'Use it whenever the user wants data as a file, and instead of paging through db_query. Format dates and columns in the SQL (aliases become the column headers).',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection name, exactly as listed' },
        sql: { type: 'string', description: 'One SELECT statement' },
        format: { type: 'string', enum: ['xlsx', 'csv', 'json', 'txt', 'tsv', 'md', 'html'], description: 'File format (default xlsx). Any other format: export csv / json and convert it with code; never retype rows.' },
        name: { type: 'string', description: 'File name without extension, e.g. "meal-reviews-2026-09"' }
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
      case 'db_export':
        return await toolExport(ctx, s('connection'), s('sql'), s('format'), s('name'))
      case 'ssh_exec':
        return await toolExec(ctx, s('connection'), s('command'))
      default:
        return { text: `Unknown tool: ${name}`, isError: true }
    }
  } catch (e) {
    return { text: `ERROR: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}
