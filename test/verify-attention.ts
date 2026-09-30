/**
 * When the Grove sends a notification, checked case by case. Run with `npm run verify:attention`.
 *
 * Each case is one sentence of `core/attention.ts`, plus the run book's side of it: that every
 * state change is reported once, with the state it left.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { noticeFor } from '../core/attention.ts'
import { RunBook, type Run } from '../core/spawn/runs.ts'

const on = { notifyFinished: true, notifyNeedsYou: false }
const run = (fields: Partial<Run>): Run => ({
  id: 'r', harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: '/p/Shellter',
  task: 'fix the tests', createdAt: 0, updatedAt: 0, state: 'running', sessionId: 'r', ...fields,
})
const MIN = 60_000

const cases: [string, () => void | Promise<void>][] = [
  ['a failed run always notifies, with why', () => {
    const notice = noticeFor(run({ state: 'failed', error: 'No session appeared.' }), 'starting', 0, 20 * MIN, on)
    assert.equal(notice?.title, 'Builder could not start on Shellter')
    assert.equal(notice?.body, 'No session appeared.')
  }],
  ['a run that worked a minute or more notifies when it finishes', () => {
    assert.equal(noticeFor(run({ state: 'finished' }), 'running', 0, 2 * MIN, on)?.title, 'Builder finished on Shellter')
  }],
  ['a quick turn does not', () => {
    assert.equal(noticeFor(run({ state: 'finished' }), 'running', 0, 20_000, on), null)
  }],
  ['finishing can be switched off', () => {
    assert.equal(noticeFor(run({ state: 'finished' }), 'running', 0, 5 * MIN, { ...on, notifyFinished: false }), null)
  }],
  ['needing you notifies only when switched on', () => {
    assert.equal(noticeFor(run({ state: 'waiting' }), 'running', 0, MIN, on), null)
    assert.match(noticeFor(run({ state: 'waiting' }), 'running', 0, MIN, { ...on, notifyNeedsYou: true })?.title ?? '', /needs you/)
  }],
  ['the stone’s own name is used when given', () => {
    assert.equal(noticeFor(run({ state: 'finished' }), 'running', 0, 2 * MIN, on, 'Shellter game')?.title, 'Builder finished on Shellter game')
  }],
  ['the run book reports each change once, with the state left and when it began', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-attention-'))
    const book = new RunBook(path.join(dir, 'runs.json'))
    const seen: [string, string, number][] = []
    book.onStateChange = (changed, from, since) => seen.push([from, changed.state, since])
    const made = book.create({ harness: 'claude-code', agentId: 'b', agentName: 'B', stoneId: '/p', task: '' }, 1000)
    book.onHook({ event: 'SessionStart', sessionId: made.id, cwd: '/p', tool: '', at: 2000 })
    book.onHook({ event: 'PreToolUse', sessionId: made.id, cwd: '/p', tool: 'Bash', at: 3000 })
    book.onHook({ event: 'Stop', sessionId: made.id, cwd: '/p', tool: '', at: 90_000 })
    assert.deepEqual(seen, [['starting', 'running', 1000], ['running', 'finished', 2000]])
    await book.flushed()
    await fsp.rm(dir, { recursive: true, force: true })
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} attention rules hold.`)
