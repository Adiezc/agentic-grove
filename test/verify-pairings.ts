/**
 * The mushrooms' rule, checked case by case. Run with `npm run verify:pairings`.
 *
 * Each case is one sentence of `core/state/pairings.ts`. Change the case in the same commit as
 * the rule, so the two never disagree about which projects count as worked on together.
 */
import assert from 'node:assert/strict'
import type { Session } from '../core/harnesses/types.ts'
import { pairings, PAIRING_WINDOW_MS } from '../core/state/pairings.ts'

const HOUR = 60 * 60_000
const now = 1000 * HOUR + 30 * 60_000
const at = (createdAt: number, lastActivityAt = createdAt) => ({ createdAt, lastActivityAt }) as Session
const stone = (id: string, sessions: Session[], parent?: string) => ({ id, sessions, parent })

const cases: [string, () => void][] = [
  ['work on two stones in the same hour pairs them', () => {
    const found = pairings([stone('/b', [at(now - 5 * 60_000)]), stone('/a', [at(now - 20 * 60_000)])], now)
    assert.equal(found.length, 1)
    assert.deepEqual([found[0]!.a, found[0]!.b], ['/a', '/b'])
    assert.equal(found[0]!.hours, 1)
    assert.ok(found[0]!.freshness > 0.99)
  }],
  ['different hours do not pair', () => {
    assert.deepEqual(pairings([stone('/a', [at(now)]), stone('/b', [at(now - 2 * HOUR)])], now), [])
  }],
  ['a long open session does not count its whole span, only its start and its last move', () => {
    const open = at(now - 72 * HOUR, now)
    assert.deepEqual(pairings([stone('/a', [open]), stone('/b', [at(now - 30 * HOUR)])], now), [])
  }],
  ['each shared hour counts once', () => {
    const found = pairings([stone('/a', [at(now), at(now - 3 * HOUR)]), stone('/b', [at(now), at(now - 3 * HOUR), at(now - 5 * 60_000)])], now)
    assert.equal(found[0]!.hours, 2)
  }],
  ['a pairing fades over the week and is gone after it', () => {
    const halfway = pairings([stone('/a', [at(now - 3.5 * 24 * HOUR)]), stone('/b', [at(now - 3.5 * 24 * HOUR)])], now)
    assert.ok(Math.abs(halfway[0]!.freshness - 0.5) < 0.02)
    const old = now - PAIRING_WINDOW_MS - HOUR
    assert.deepEqual(pairings([stone('/a', [at(old)]), stone('/b', [at(old)])], now), [])
  }],
  ['a sub-stone never pairs with its parent', () => {
    assert.deepEqual(pairings([stone('/a', [at(now)]), stone('/a/part', [at(now)], '/a')], now), [])
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} pairing rules hold.`)
