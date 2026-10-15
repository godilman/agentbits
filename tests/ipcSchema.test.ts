/** IPC argument shapes (security review #13). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { argsMatch, IPC_SCHEMA } from '../src/shared/ipcSchema.ts'

// Every method of the Api interface has an entry, and nothing else (the type check enforces it too).
const ipc = readFileSync(join(import.meta.dirname, '../src/shared/ipc.ts'), 'utf8')
const api = /export interface Api \{([\s\S]*?)\n\}/.exec(ipc)![1]
const methods = [...api.matchAll(/^\s+'([a-zA-Z]+:[a-zA-Z]+)':/gm)].map((m) => m[1]).sort()
assert.deepEqual(Object.keys(IPC_SCHEMA).sort(), methods)

const ok = (m: string, ...a: unknown[]): void => assert.equal(argsMatch(m, a), true, `${m} ${JSON.stringify(a)}`)
const no = (m: string, ...a: unknown[]): void => assert.equal(argsMatch(m, a), false, `${m} ${JSON.stringify(a)}`)

ok('settings:get')
no('settings:get', 'extra')
no('nope:method')
no('__proto__')
no('constructor')
ok('files:add', 'p1', ['C:\\a.pdf'])
no('files:add', 'p1', 'C:\\a.pdf')
no('files:add', 'p1', [1])
no('files:add', 'p1')
ok('files:addData', 'p1', 'a.png', new Uint8Array([1]))
no('files:addData', 'p1', 'a.png', [1, 2])
ok('terminal:resize', 't', 80, 24)
no('terminal:resize', 't', '80', 24)
no('terminal:resize', 't', Number.NaN, 24)
ok('messages:list')
ok('messages:list', 'general', 50, 'p1')
ok('messages:list', 'general', undefined, null) // optional also takes null
no('messages:list', 'general', '50')
ok('apps:setPolicy', 'a', 'tool', null)
no('apps:setPolicy', 'a', 'tool')
ok('memory:add', 'text', 'fact', null, null)
ok('settings:update', { autopilot: true })
no('settings:update', ['autopilot'])
no('settings:update', null)
no('runs:approve', 'r1', 'true')
no('data:factoryReset', { mode: 'all' })
console.log(`ipcSchema: ${methods.length} methods covered, shapes checked`)
