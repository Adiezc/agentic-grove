/** On-demand evidence, without turning a reported tool/todo into verified success. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { projectActivity, readActivityFile } from '../core/activity.ts'
import { selectedActivity } from '../core/activity-access.ts'
import { observationFixture } from './fixtures/observation.ts'
import { pollActivity } from '../src/hud/activity-poll.ts'
import type { ActivityResult } from '../core/activity-access.ts'

const fixture = await observationFixture()
const now = Date.now()
const time = new Date(now).toISOString()
const id = '00000000-0000-4000-8000-000000000001'
const claude = (name: string, input: object, callId = 'call') => ({ type: 'assistant', timestamp: time, message: { content: [{ type: 'tool_use', name, input, id: callId }] } })
const answer = (callId = 'call', failed = false) => ({ type: 'user', timestamp: time, message: { content: [{ type: 'tool_result', tool_use_id: callId, is_error: failed, content: 'PRIVATE output must not leave the reader' }] } })
let passed = 0
async function check(name: string, test: () => void | Promise<void>) { await test(); passed++; console.log(`✓ ${name}`) }
try {
  await check('reading/editing tool labels retain only the filename, not file contents or paths', () => {
    const reading = projectActivity([claude('Read', { file_path: '/private/work/secret.ts', content: 'PRIVATE file text' })], 'claude', now)
    assert.equal(reading.lastTool?.label, 'Reading secret.ts')
    assert.equal(projectActivity([claude('Edit', { file_path: '/private/work/edit.ts', old_string: 'PRIVATE old text' })], 'claude', now).lastTool?.label, 'Editing edit.ts')
    assert.ok(!JSON.stringify(reading).includes('PRIVATE'))
    assert.ok(!JSON.stringify(reading).includes('/private/work'))
  })
  await check('test commands are attempts; returned results never become a tests-passed claim', () => {
    const detail = projectActivity([claude('Bash', { command: 'npm run test:unit', description: 'PRIVATE command description' }), answer()], 'claude', now)
    assert.equal(detail.lastTool?.label, 'Running a test command')
    assert.equal(detail.lastTool?.outcome, 'returned')
    assert.ok(!JSON.stringify(detail).includes('PRIVATE'))
    assert.ok(!JSON.stringify(detail).includes('passed'))
    assert.equal(projectActivity([claude('Bash', { command: 'echo npm test', description: 'Testing' })], 'claude', now).lastTool?.label, 'Running a command')
  })
  await check('only a matching explicit error result marks a tool error', () => {
    assert.equal(projectActivity([claude('Read', {}), answer('other', true)], 'claude', now).lastTool?.outcome, 'requested')
    assert.equal(projectActivity([claude('Read', {}), answer('call', true)], 'claude', now).lastTool?.outcome, 'errored')
  })
  await check('task counts are reported fields and malformed updates become unknown', () => {
    const todos = claude('TodoWrite', { todos: [{ content: 'First', status: 'completed' }, { content: 'Second', activeForm: 'Reading fixtures', status: 'in_progress' }] })
    assert.deepEqual(projectActivity([todos], 'claude', now).tasks, { completed: 1, total: 2, current: 'Reading fixtures', at: now })
    assert.equal(projectActivity([todos, claude('TodoWrite', { todos: [{ status: 'invented' }] })], 'claude', now).tasks, null)
    assert.equal(projectActivity([claude('TodoWrite', { todos: [] })], 'claude', now).tasks?.total, 0)
  })
  await check('worker requests are bounded, repeated streamed IDs are merged and prompts stay private', () => {
    const call = claude('Agent', { name: 'Reviewer', prompt: 'PRIVATE worker brief' })
    const detail = projectActivity([call, call], 'claude', now)
    assert.equal(detail.delegations.length, 1)
    assert.equal(detail.delegations[0]?.name, 'Reviewer')
    assert.ok(!JSON.stringify(detail).includes('PRIVATE'))
    const many = Array.from({ length: 20 }, (_, index) => claude('Task', { subagent_type: `worker-${index}` }, `id-${index}`))
    assert.equal(projectActivity(many, 'claude', now).delegations.length, 6)
  })
  await check('Codex function calls, custom patch tools and reported plans are projected safely', () => {
    const call = { type: 'response_item', timestamp: time, payload: { type: 'function_call', call_id: 'codex', name: 'exec_command', arguments: JSON.stringify({ cmd: 'pytest', private: 'PRIVATE' }) } }
    const result = { type: 'response_item', timestamp: time, payload: { type: 'function_call_output', call_id: 'codex', output: JSON.stringify({ exit_code: 1, output: 'PRIVATE stdout' }) } }
    assert.equal(projectActivity([call, result], 'codex', now).lastTool?.outcome, 'errored')
    assert.equal(projectActivity([call], 'codex', now).lastTool?.label, 'Running a test command')
    assert.equal(projectActivity([{ ...call, payload: { ...call.payload, name: 'functions.exec_command' } }], 'codex', now).lastTool?.label, 'Running a test command')
    const patch = { type: 'response_item', timestamp: time, payload: { type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: 'PRIVATE full patch' } }
    assert.equal(projectActivity([patch], 'codex', now).lastTool?.label, 'Editing files')
    assert.ok(!JSON.stringify(projectActivity([call, result, patch], 'codex', now)).includes('PRIVATE'))
    const plan = { type: 'response_item', timestamp: time, payload: { type: 'function_call', call_id: 'plan', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Inspect', status: 'completed' }] }) } }
    assert.equal(projectActivity([plan], 'codex', now).tasks?.completed, 1)
  })
  await check('missing/future timestamps and malformed tool arguments are not invented evidence', () => {
    const badTime = { ...claude('Read', {}), timestamp: 'not a date' }
    assert.equal(projectActivity([badTime], 'claude', now).lastTool?.at, 0)
    assert.equal(projectActivity([{ ...badTime, timestamp: new Date(now + 3600_000).toISOString() }], 'claude', now).lastTool?.at, 0)
    assert.equal(projectActivity([null, 4, { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{partial' } }], 'codex', now).lastTool?.label, 'Running a command')
    assert.equal(projectActivity([{ ...claude('Read', {}), isSidechain: true }], 'claude', now).lastTool, null)
  })

  const project = path.join(fixture.root, 'project')
  const file = path.join(fixture.providers, '.claude/projects', project.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const records = [claude('TodoWrite', { todos: [{ status: 'completed', content: 'Old task' }] }), { type: 'user', message: { content: 'x'.repeat(300 * 1024) } }, claude('Read', { file_path: '/work/visible.ts' }), answer()]
  await fs.writeFile(file, records.map((row) => JSON.stringify(row)).join('\n') + '\n{partial')
  await check('bounded reads exclude old progress beyond the tail and tolerate a partial final line', async () => {
    const detail = await readActivityFile(file, 'claude')
    assert.equal(detail?.lastTool?.label, 'Reading visible.ts')
    assert.equal(detail?.tasks, null)
    assert.equal(detail?.bounded, true)
    assert.equal(await readActivityFile(path.join(fixture.root, 'missing.jsonl'), 'claude'), null)
  })
  const { scan } = await import('../core/scan.ts')
  const { harnessById } = await import('../core/harnesses/index.ts')
  const { readTranscript } = await import('../core/spawn/transcript.ts')
  const observed = await scan()
  const sessions = observed.sessions.filter((session) => session.harness === 'claude-code')
  assert.equal(sessions.length, 1)
  const stones = [{ id: project, sessions }]
  await check('selected known sessions read through the adapter and the isolated transcript view', async () => {
    const detail = await selectedActivity(stones, project, `claude-code:${id}`, harnessById)
    assert.ok(detail.ok)
    assert.equal(detail.detail?.lastTool?.label, 'Reading visible.ts')
    assert.ok((await readTranscript(id, project))?.some((line) => line.kind === 'tool' && line.text === 'Read visible.ts'))
  })
  await check('unknown IDs, cross-stone requests, arrays and path tricks never reach an adapter', async () => {
    let accessed = 0
    const lookup = (harness: string) => { accessed++; return harnessById(harness) }
    for (const [stone, session] of [[project, '../../secrets'], ['/other/stone', sessions[0]!.id], [[project], sessions[0]!.id], [project, ['claude-code:x']], [project, 'x'.repeat(200)]]) {
      assert.equal((await selectedActivity(stones, stone, session, lookup)).ok, false)
    }
    assert.equal(accessed, 0)
    assert.equal(await harnessById('claude-code')?.readActivity?.('../../secrets'), null)
  })
  await check('unsupported providers and missing evidence are explicit, not invented activity', async () => {
    const cursor = { ...sessions[0]!, id: 'cursor:fixture', harness: 'cursor' }
    const result = await selectedActivity([{ id: project, sessions: [cursor] }], project, cursor.id, harnessById)
    assert.ok(result.ok && result.detail === null && result.unavailable)
    await fs.unlink(file)
    const missing = await selectedActivity(stones, project, sessions[0]!.id, harnessById)
    assert.ok(missing.ok && missing.detail === null && missing.unavailable)
  })
  await check('closed or changed panels ignore late replies and create no further poll', async () => {
    let resolve!: (value: ActivityResult) => void
    let reads = 0
    let delivered = 0
    const pending = new Promise<ActivityResult>((done) => { resolve = done })
    const stop = pollActivity(() => { reads++; return pending }, () => { delivered++ }, 1)
    stop()
    resolve({ ok: true, detail: null })
    await new Promise((done) => setTimeout(done, 10))
    assert.equal(delivered, 0)
    assert.equal(reads, 1)
  })
  await check('a slow detail read never overlaps another read', async () => {
    let resolve!: (value: ActivityResult) => void
    let reads = 0
    const pending = new Promise<ActivityResult>((done) => { resolve = done })
    const stop = pollActivity(() => { reads++; return pending }, () => {}, 1)
    try {
      await new Promise((done) => setTimeout(done, 10))
      assert.equal(reads, 1)
    } finally { stop(); resolve({ ok: true, detail: null }) }
  })
  await check('poll failures remain explicit and stopping from a reply cancels the next read', async () => {
    let stop!: () => void
    let calls = 0
    let outcome: ActivityResult | null = null
    stop = pollActivity(async () => { calls++; throw new Error('Fixture disk error') }, (result) => { outcome = result; stop() }, 1)
    await new Promise((done) => setTimeout(done, 10))
    assert.ok(outcome && !(outcome as ActivityResult).ok)
    assert.equal(calls, 1)
  })
  console.log(`\n${passed} activity evidence checks passed.`)
} finally { await fixture.dispose() }
