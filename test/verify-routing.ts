/**
 * PM's routing rules, checked case by case. Run with `npm run verify:routing`.
 *
 * Each case is one sentence of the rule book in `core/routing.ts`. If a rule changes on purpose,
 * change its case here in the same commit, so the two never disagree about what PM does.
 */
import assert from 'node:assert/strict'
import { headroomFrom, route, type Connected } from '../core/routing.ts'

const none: Connected = { claudeCode: false, codex: false, claudeApp: false, chatgptApp: false, dots: false }
const all: Connected = { claudeCode: true, codex: true, claudeApp: true, chatgptApp: true, dots: true }

const cases: [string, () => void][] = [
  ['project work with nothing connected says what to connect', () => {
    assert.equal(route('project', none).harness, null)
  }],
  ['project work goes to the one project tool there is', () => {
    assert.equal(route('project', { ...none, codex: true }).harness, 'codex')
    assert.equal(route('project', { ...none, claudeCode: true }).harness, 'claude-code')
  }],
  ['with both, Claude Code wins a tie or an unknown', () => {
    assert.equal(route('project', all).harness, 'claude-code')
    assert.equal(route('project', all, { claudeCode: 40, codex: null }).harness, 'claude-code')
  }],
  ['with both, more headroom wins', () => {
    assert.equal(route('project', all, { claudeCode: 10, codex: 70 }).harness, 'codex')
    assert.equal(route('project', all, { claudeCode: 70, codex: 10 }).harness, 'claude-code')
  }],
  ['recurring work goes to a Dot when the plan has them', () => {
    assert.equal(route('recurring', all).harness, 'chatgpt-dot')
  }],
  ['recurring work without Dots becomes a saved task on a project tool', () => {
    assert.equal(route('recurring', { ...none, claudeCode: true }).harness, 'claude-code')
  }],
  ['everyday work prefers Cowork, then ChatGPT, then a project tool', () => {
    assert.equal(route('everyday', all).harness, 'claude-cowork')
    assert.equal(route('everyday', { ...none, chatgptApp: true }).harness, 'chatgpt-dot')
    assert.equal(route('everyday', { ...none, codex: true }).harness, 'codex')
  }],
  ['an allowance known to be used up is skipped, and the reason never claims room', () => {
    assert.equal(route('project', all, { claudeCode: 0, codex: null }).harness, 'codex')
    assert.equal(route('project', all, { claudeCode: 30, codex: 0 }).harness, 'claude-code')
    const both = route('project', all, { claudeCode: 0, codex: 0 })
    assert.equal(both.harness, 'claude-code')
    assert.match(both.reason, /used up/)
    assert.doesNotMatch(route('project', { ...none, claudeCode: true }, { claudeCode: 0, codex: null }).reason, /room/)
  }],
  ['headroom counts only while current: a reset window or an old reading is unknown', () => {
    const now = 10 * 60 * 60_000
    const report = (usedPercent: number, resetsAt: number | null, observedAt: number | null) => ({
      at: now,
      providers: [{ provider: 'claude-code' as const, name: 'Claude Code', windows: [{ key: 'five_hour' as const, provenance: 'official' as const, usedPercent, resetsAt, tokens: null, observedAt }] }],
    })
    assert.equal(headroomFrom(report(100, now + 60_000, now - 60_000), now).claudeCode, 0)
    assert.equal(headroomFrom(report(100, now - 1, now - 60_000), now).claudeCode, null)
    assert.equal(headroomFrom(report(40, null, now - 6 * 60 * 60_000), now).claudeCode, null)
    assert.equal(headroomFrom(null, now).codex, null)
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
console.log(`\nAll ${cases.length} routing rules hold.`)
