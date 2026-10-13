/** MCP app config parsing, tool names and default policies (src/shared/apps.ts). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { agentToolName, defaultPolicy, parseMcpConfig, policyOf, type AppTool } from '../src/shared/apps.ts'

// Claude Desktop shape: stdio + remote, env / headers kept as pairs
const desktop = parseMcpConfig(
  JSON.stringify({
    mcpServers: {
      gmail: { command: 'npx', args: ['-y', '@acme/gmail-mcp'], env: { GMAIL_TOKEN: 'x', PORT: 3 } },
      figma: { url: 'https://mcp.figma.test/mcp', headers: { Authorization: 'Bearer k' } },
      broken: { args: ['no command'] },
      list: ['not', 'an', 'object']
    }
  })
)
assert.deepEqual(desktop.map((c) => `${c.name}:${c.transport}`), ['gmail:stdio', 'figma:http'])
assert.deepEqual(desktop[0].args, ['-y', '@acme/gmail-mcp'])
assert.deepEqual(desktop[0].env, [{ key: 'GMAIL_TOKEN', value: 'x' }, { key: 'PORT', value: '3' }])
assert.deepEqual(desktop[1].headers, [{ key: 'Authorization', value: 'Bearer k' }])

// VS Code `servers`, `serverUrl`, the inner object alone and a bare README pair
assert.equal(parseMcpConfig('{"servers": {"a": {"command": "uvx", "args": ["a-mcp"]}}}')[0].command, 'uvx')
assert.equal(parseMcpConfig('{"notes": {"serverUrl": "https://n.test/sse"}}')[0].url, 'https://n.test/sse')
assert.equal(parseMcpConfig('"fs": { "command": "npx", "args": ["fs-mcp", "C:\\\\Users"] },')[0].args[1], 'C:\\Users')
assert.throws(() => parseMcpConfig('{ not json'))
assert.deepEqual(parseMcpConfig('{}'), [])

// tool names the agents see: provider-safe, ≤ 64 chars, stable
assert.equal(agentToolName('Gmail', 'send_email'), 'app_gmail__send_email')
assert.equal(agentToolName('Şirket Postası', 'list mail'), 'app_sirket_postasi__list_mail')
assert.equal(agentToolName('???', 'x.y'), 'app_app__x_y')
const long = agentToolName('A very long server name indeed', 'a_tool_with_an_extremely_long_name_that_goes_on_and_on_forever')
assert.ok(long.length <= 64 && /^[A-Za-z0-9_-]+$/.test(long), long)
assert.equal(long, agentToolName('A very long server name indeed', 'a_tool_with_an_extremely_long_name_that_goes_on_and_on_forever'))
assert.notEqual(long, agentToolName('A very long server name indeed', 'a_tool_with_an_extremely_long_name_that_goes_on_and_on_forever2'))

// default policy: only tools marked read-only (and not destructive) run without asking
const tool = (p: Partial<AppTool>): AppTool => ({ name: 't', description: '', inputSchema: {}, ...p })
assert.equal(defaultPolicy(tool({ readOnly: true })), 'auto')
assert.equal(defaultPolicy(tool({ readOnly: true, destructive: true })), 'approve')
assert.equal(defaultPolicy(tool({})), 'approve')
assert.equal(defaultPolicy(tool({ destructive: false })), 'approve')
assert.equal(policyOf({ policies: { t: 'block' } }, tool({ readOnly: true })), 'block')
assert.equal(policyOf({ policies: {} }, tool({ readOnly: true })), 'auto')

console.log('apps: config parsing, tool names and policies ok')
