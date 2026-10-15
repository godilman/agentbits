/** Twins (same role and skills) can share queued work. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { isTwin } from '../src/shared/org.ts'
import { describeTeam, runTeamTool, teamState } from '../src/main/core/team.ts'

const dev = (id: string, role = 'Frontend Developer', skills = ['React', 'CSS']) => ({ id, role, skills })
assert.equal(isTwin(dev('a'), dev('b')), true)
assert.equal(isTwin(dev('a'), dev('b', ' frontend developer ', ['css', 'react', 'React'])), true)
assert.equal(isTwin(dev('a'), dev('a')), false) // not its own twin
assert.equal(isTwin(dev('a'), dev('b', 'Backend Developer')), false)
assert.equal(isTwin(dev('a'), dev('b', 'Frontend Developer', ['React'])), false)
assert.equal(isTwin(dev('a', ''), dev('b', '')), false) // no role, no twin

// live team state: who works on what, which files; a second writer of the same file is a conflict
teamState.start({ runId: 'r1', agentId: 'a', agentName: 'Kaan', projectId: 'p1', taskKey: 'TA-1', title: 'Login form' })
teamState.start({ runId: 'r2', agentId: 'b', agentName: 'Kaan 2', projectId: 'p1', taskKey: 'TA-2', title: 'Signup form' })
teamState.start({ runId: 'r3', agentId: 'c', agentName: 'Ece', projectId: 'p2', taskKey: 'TA-9', title: 'Other project' })
assert.deepEqual(teamState.touch('r1', 'src/Form.tsx'), [])
assert.deepEqual(teamState.touch('r1', './src/Form.tsx'), []) // same file, same run: no conflict
assert.deepEqual(teamState.touch('r3', 'src/Form.tsx'), []) // other project
assert.deepEqual(teamState.touch('r2', 'src\\Form.tsx').map((o) => o.agentName), ['Kaan']) // Windows slashes
assert.match(describeTeam('p1', 'r2'), /Kaan: TA-1 Login form\n  files written so far: src\/Form\.tsx/)
assert.ok(!describeTeam('p1', 'r2').includes('Kaan 2')) // not yourself
assert.ok(!describeTeam('p1', 'r2').includes('Ece')) // not other projects
assert.equal(runTeamTool({ agentId: 'b', projectId: 'p1', runId: 'r2' }).isError, false)
teamState.end('r1')
assert.equal(runTeamTool({ agentId: 'b', projectId: 'p1', runId: 'r2' }).text, 'Nobody else in this project is working right now.')
assert.deepEqual(teamState.touch('gone', 'x'), []) // unknown run: nothing recorded
assert.equal(describeTeam('p1', null).includes(' x'), false)
console.log('team: twins and live team state ok')
