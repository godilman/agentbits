/** Semantic memory helpers. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { dot, fromBlob, normalize, parseEmbeddings, semanticRelevance, toBlob } from '../src/shared/vectors.ts'

const a = normalize([3, 4])!
assert.ok(Math.abs(a[0] - 0.6) < 1e-6 && Math.abs(a[1] - 0.8) < 1e-6)
assert.equal(normalize([0, 0]), null)
assert.equal(normalize([]), null)
assert.ok(Math.abs(dot(a, a) - 1) < 1e-6)
assert.equal(dot(a, normalize([1, 2, 3])!), 0, 'different sizes (another model) never match')
assert.deepEqual([...fromBlob(toBlob(a))], [...a])
// A blob read from SQLite can sit at an odd offset inside a larger buffer.
const big = new Uint8Array(3 + 8)
big.set(toBlob(a), 3)
assert.deepEqual([...fromBlob(big.subarray(3))], [...a])

assert.equal(semanticRelevance(0.1), 0)
assert.equal(semanticRelevance(0.9), 1)
assert.ok(semanticRelevance(0.5) > 0.4 && semanticRelevance(0.5) < 0.6)

// Out-of-order answers are put back in input order; malformed ones are refused.
const v = parseEmbeddings({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [5, 0] }] }, 2)
assert.deepEqual([...v[0]], [1, 0])
assert.deepEqual([...v[1]], [0, 1])
assert.throws(() => parseEmbeddings({ data: [{ embedding: [1] }] }, 2))
assert.throws(() => parseEmbeddings({ data: [{ embedding: ['x'] }] }, 1))
assert.throws(() => parseEmbeddings({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [1] }] }, 2))
assert.throws(() => parseEmbeddings({ error: 'nope' }, 1))

console.log('vectors: normalize, blobs, relevance and response parsing ok')
