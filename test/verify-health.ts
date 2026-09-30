/**
 * The health line, checked case by case. Run with `npm run verify:health`.
 *
 * Each case is one sentence of `core/health.ts`: a broken or stale grove must never read as fine.
 */
import assert from 'node:assert/strict'
import { healthOf, type HealthFacts } from '../core/health.ts'

const now = 1_000_000
const fine: HealthFacts = { at: now - 2000, scanIntervalMs: 5000, unreadable: [], groveProblems: 0, hooks: { state: 'on', listening: true } }

const cases: [string, () => void][] = [
  ['with hooks working it says Live', () => {
    assert.deepEqual([healthOf(fine, now).tone, healthOf(fine, now).text], ['fine', 'Live'])
  }],
  ['with the scan alone it says Watching', () => {
    assert.equal(healthOf({ ...fine, hooks: { state: 'off', listening: true } }, now).text, 'Watching')
  }],
  ['one slow scan is not stale; three missed ones are', () => {
    assert.equal(healthOf({ ...fine, at: now - 12_000 }, now).tone, 'fine')
    const stale = healthOf({ ...fine, at: now - 3 * 60_000 }, now)
    assert.deepEqual([stale.tone, stale.text], ['stale', 'Updated 3 minutes ago'])
  }],
  ['stale wins over everything else, since then nothing on screen can be trusted', () => {
    assert.equal(healthOf({ ...fine, at: now - 60_000, unreadable: ['Codex'], groveProblems: 2 }, now).tone, 'stale')
  }],
  ['an unreadable tool is named', () => {
    assert.equal(healthOf({ ...fine, unreadable: ['Codex'] }, now).text, 'Codex unread')
    assert.equal(healthOf({ ...fine, unreadable: ['Codex', 'Cursor'] }, now).text, 'Codex and 1 more unread')
  }],
  ['a grove.json error is a problem', () => {
    assert.deepEqual([healthOf({ ...fine, groveProblems: 1 }, now).tone, healthOf({ ...fine, groveProblems: 1 }, now).text], ['problem', 'grove.json has an error'])
  }],
  ['hooks on but not heard is paused, not fine', () => {
    assert.equal(healthOf({ ...fine, hooks: { state: 'on', listening: false } }, now).text, 'Live updates paused')
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
console.log(`\nAll ${cases.length} health rules hold.`)
