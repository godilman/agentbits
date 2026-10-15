/** Twins (same role and skills) can share queued work. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { isTwin } from '../src/shared/org.ts'

const dev = (id: string, role = 'Frontend Developer', skills = ['React', 'CSS']) => ({ id, role, skills })
assert.equal(isTwin(dev('a'), dev('b')), true)
assert.equal(isTwin(dev('a'), dev('b', ' frontend developer ', ['css', 'react', 'React'])), true)
assert.equal(isTwin(dev('a'), dev('a')), false) // not its own twin
assert.equal(isTwin(dev('a'), dev('b', 'Backend Developer')), false)
assert.equal(isTwin(dev('a'), dev('b', 'Frontend Developer', ['React'])), false)
assert.equal(isTwin(dev('a', ''), dev('b', '')), false) // no role, no twin
console.log('team: twins ok')
