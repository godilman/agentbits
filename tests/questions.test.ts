import assert from 'node:assert/strict'
import { addressedKeys, answerPart, MAX_QUESTION_CHARS, MAX_QUESTIONS, parseAnswered, parseQuestions } from '../src/shared/questions.ts'

const block = (tag: string, v: unknown): string => '```' + tag + '\n' + JSON.stringify(v) + '\n```'

// Questions: text required; a bad task key is dropped (the question stays); long text cut; at most MAX_QUESTIONS.
assert.deepEqual(parseQuestions('Sure.\n' + block('question', [{ text: 'Which domain?', task: 'ta-3' }, { text: '  ' }, { text: 'Logo?', task: 'not a key' }])), [
  { text: 'Which domain?', task: 'TA-3' },
  { text: 'Logo?', task: null }
])
assert.deepEqual(parseQuestions(block('question', { text: 'One?' })), [{ text: 'One?', task: null }])
assert.equal(parseQuestions(block('question', [{ text: 'x'.repeat(2000) }]))[0].text.length, MAX_QUESTION_CHARS)
assert.equal(parseQuestions(block('question', Array.from({ length: 9 }, (_, i) => ({ text: `q${i}` })))).length, MAX_QUESTIONS)
assert.deepEqual(parseQuestions('```question\nnot json\n```'), [])
assert.deepEqual(parseQuestions('no blocks'), [])

// Answered: only valid keys, upper-cased, once each.
assert.deepEqual(parseAnswered(block('answered', [{ question: 'q-2' }, { question: 'Q-2' }, { question: 'TA-1' }, { question: 7 }])), [{ question: 'Q-2' }])

// Direct answers: only a line that starts with the key.
assert.deepEqual(addressedKeys('Q-3: yes, the .com one'), ['Q-3'])
assert.deepEqual(addressedKeys('q3 - yes\nQ-4) no\n  Q-3: again'), ['Q-3', 'Q-4'])
assert.deepEqual(addressedKeys('as Q-3 said, yes'), [])
assert.deepEqual(addressedKeys('tamam'), [])
// The part that answers each key.
assert.equal(answerPart('Q-3: yes, the .com one\nand keep www', 'Q-3', false), 'yes, the .com one\nand keep www')
assert.equal(answerPart('Q-3: yes\nmore on 3\nQ-4: blue', 'Q-3', true), 'yes\nmore on 3')
assert.equal(answerPart('Q-3: yes\nmore on 3\nQ-4: blue', 'Q-4', true), 'blue')
console.log('questions: blocks and direct answers ok')
