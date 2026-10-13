/** Actual provider-file scans, with no account, installed CLI or real session data required. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { observationPaths } from '../core/observation-paths.ts'
import { observationFixture } from './fixtures/observation.ts'

const fixture = await observationFixture()
const realUserHome = os.homedir()
const originalCodexHome = process.env.CODEX_HOME
const originalNow = Date.now
const now = originalNow()
Date.now = () => now
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const iso = (at = now) => new Date(at).toISOString()
let passed = 0
const check = async (name: string, test: () => void | Promise<void>) => {
  await test()
  passed++
  console.log(`✓ ${name}`)
}
const write = async (file: string, value: string | object) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value))
  await fs.utimes(file, now / 1000, now / 1000)
}
const jsonl = (records: object[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

/** Directory/content reads stay inside the fixture. Cursor also stats paths to decode project names. */
async function observed<T>(read: () => Promise<T>): Promise<T> {
  const methods = ['access', 'open', 'readFile', 'readdir', 'stat', 'writeFile', 'appendFile', 'rename', 'unlink', 'mkdir', 'rm', 'truncate'] as const
  const originals = new Map<string, unknown>()
  const violations: string[] = []
  for (const method of methods) {
    const original = fs[method]
    originals.set(method, original)
    Object.defineProperty(fs, method, { configurable: true, writable: true, value: (...args: unknown[]) => {
      const file = path.resolve(String(args[0]))
      const inside = file === fixture.root || file.startsWith(`${fixture.root}${path.sep}`)
      const projectMetadata = method === 'stat' && file !== realUserHome && !file.startsWith(`${realUserHome}${path.sep}`)
      // tsx may asynchronously check that its own cache folder exists while a scan is running.
      // Allow only that directory-presence probe, never cache contents or provider files.
      const runtimeCacheProbe = method === 'access' && file === path.join(os.tmpdir(), 'tsx')
      const reading = ['access', 'open', 'readFile', 'readdir', 'stat'].includes(method)
      if (!reading || (!inside && !projectMetadata && !runtimeCacheProbe) || (method === 'open' && args[1] !== 'r')) {
        violations.push(`${method}: ${file}`)
        return Promise.reject(new Error('Provider fixture attempted an outside read or write'))
      }
      return Reflect.apply(original, fs, args)
    } })
  }
  try { return await read() } finally {
    for (const [method, original] of originals) Object.defineProperty(fs, method, { configurable: true, writable: true, value: original })
    assert.deepEqual(violations, [], 'Observers must not touch real records or write provider files')
  }
}

async function fingerprint(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(result, await fingerprint(file))
    else result[path.relative(fixture.providers, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex')
  }
  return result
}

try {
  const { scan, startScanLoop, openSession } = await import('../core/scan.ts')
  const { HARNESSES } = await import('../core/harnesses/index.ts')
  const { claudeUsage } = await import('../core/usage/claude.ts')
  const { codexUsage } = await import('../core/usage/codex.ts')
  const { deriveStones } = await import('../core/state/stones.ts')
  const { defaultGrove } = await import('../core/state/schema.ts')

  await check('normal paths retain the user home and configured Codex home', () => {
    assert.deepEqual(observationPaths({}, '/example/user'), { home: '/example/user', codex: '/example/user/.codex' })
    assert.equal(observationPaths({ CODEX_HOME: '/configured/codex' }, '/example/user').codex, '/configured/codex')
  })
  await check('fixture overrides every observer, without changing OS or Codex environment homes', () => {
    assert.equal(os.homedir(), realUserHome)
    assert.equal(process.env.CODEX_HOME, originalCodexHome)
    assert.equal(observationPaths({ ...process.env, CODEX_HOME: '/must/not/read' }).codex, path.join(fixture.providers, '.codex'))
    for (const harness of HARNESSES) for (const value of Object.values(harness.paths ?? {})) assert.ok(value.startsWith(`${fixture.providers}${path.sep}`), value)
  })
  await check('invalid or overlapping fixture roots never silently fall back', () => {
    for (const env of [
      { AGENTIC_GROVE_PROVIDER_HOME: '' },
      { AGENTIC_GROVE_PROVIDER_HOME: 'relative', AGENTIC_GROVE_HOME: fixture.grove },
      { AGENTIC_GROVE_PROVIDER_HOME: fixture.providers },
      { AGENTIC_GROVE_PROVIDER_HOME: realUserHome, AGENTIC_GROVE_HOME: fixture.grove },
      { AGENTIC_GROVE_PROVIDER_HOME: fixture.providers, AGENTIC_GROVE_HOME: path.join(fixture.providers, 'grove') },
    ]) assert.throws(() => observationPaths(env))
  })
  await check('empty provider homes yield no sessions or usage, even on a working Mac', async () => {
    const result = await observed(scan)
    assert.deepEqual(result.sessions, [])
    assert.ok(result.harnesses.every((harness) => !harness.detected))
    assert.equal(await observed(() => claudeUsage(now)), null)
    assert.equal(await observed(() => codexUsage(now)), null)
  })

  const project = path.join(fixture.root, 'projects', 'druid')
  await fs.mkdir(project, { recursive: true })
  const claudeProject = path.join(fixture.providers, '.claude/projects', project.replaceAll('/', '-'))
  const claudeFile = (n: number) => path.join(claudeProject, `${uuid(n)}.jsonl`)
  const user = { type: 'user', cwd: project, timestamp: iso(), message: { content: 'Grow the fixture' } }
  const tool = { type: 'assistant', timestamp: iso(), message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'fixture.ts' } }], stop_reason: 'tool_use' } }
  const answer = { type: 'assistant', timestamp: iso(), message: { content: [{ type: 'text', text: 'Ready for your review.' }], stop_reason: 'end_turn' } }
  const usageTool = { ...tool, message: { ...tool.message, id: 'fixture-main-message', usage: { input_tokens: 11, cache_creation_input_tokens: 2, output_tokens: 7 } } }
  for (const n of [1, 2, 4, 5]) {
    await write(claudeFile(n), jsonl([user, n === 1 ? usageTool : n === 2 ? answer : tool]))
    await write(path.join(fixture.providers, '.claude/sessions', `${n}.json`), { sessionId: uuid(n), pid: n === 5 ? 2147483647 : process.pid })
  }
  const desktop = (n: number) => path.join(fixture.providers, 'Library/Application Support/Claude/claude-code-sessions/account/org', `local_${uuid(n)}.json`)
  await write(desktop(3), { sessionId: `local_${uuid(3)}`, cwd: project, title: 'Fixture failure', error: 'Expected test error', createdAt: now - 1000, lastActivityAt: now })
  await write(desktop(40), { sessionId: `local_${uuid(40)}`, cliSessionId: uuid(4), cwd: project, title: 'Original session', createdAt: now - 2000, lastActivityAt: now - 1000 })
  await write(desktop(41), { sessionId: `local_${uuid(41)}`, cliSessionId: uuid(4), cwd: project, title: 'Original session', createdAt: now - 2000, lastActivityAt: now })
  await write(path.join(claudeProject, uuid(1), 'subagents', 'agent-child.jsonl'), jsonl([user, { ...tool, message: { ...tool.message, id: 'fixture-child-message', usage: { output_tokens: 3 } } }]))
  await write(path.join(fixture.providers, '.claude/sessions/broken.json'), '{partial')
  await fs.appendFile(claudeFile(1), '{partial\n')

  const codexFile = (n: number) => path.join(fixture.providers, '.codex/sessions/2026/10/13', `rollout-fixture-${uuid(n)}.jsonl`)
  const rollout = (n: number, type: string, error = false, subagent = false) => jsonl([
    { type: 'session_meta', timestamp: iso(), payload: { id: uuid(n), cwd: project, timestamp: iso(), ...(subagent ? { parent_thread_id: uuid(10) } : {}) } },
    { type: 'turn_context', payload: { cwd: project, model: 'fixture-model', effort: 'high' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A controlled task' }] } },
    { type: 'event_msg', payload: { type, error } },
  ])
  for (const [n, type, error] of [[10, 'task_started', false], [11, 'task_complete', true], [12, 'turn_aborted', false], [13, 'task_complete', false], [14, 'task_started', false]] as const) {
    await write(codexFile(n), rollout(n, type, error, n === 14))
  }
  await write(path.join(fixture.providers, '.codex/session_index.jsonl'), jsonl([{ id: uuid(10), thread_name: 'Named fixture task' }]))
  const database = new DatabaseSync(path.join(fixture.providers, '.codex/state_2.sqlite'))
  database.exec('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, source TEXT, archived INTEGER, created_at INTEGER, updated_at INTEGER); CREATE TABLE thread_spawn_edges (child_thread_id TEXT);')
  const insert = database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)')
  insert.run(uuid(10), project, 'Database task title', 'vscode', 0, Math.floor(now / 1000) - 20, Math.floor(now / 1000))
  insert.run(uuid(15), project, 'Archived database-only task', 'vscode', 1, Math.floor(now / 1000) - 20, Math.floor(now / 1000))
  insert.run(uuid(16), project, 'Hidden child', 'vscode', 0, 0, 0)
  insert.run(uuid(17), project, 'Guardian machinery', '{"subagent":{"other":"guardian"}}', 0, 0, 0)
  database.prepare('INSERT INTO thread_spawn_edges VALUES (?)').run(uuid(16))
  database.close()
  const older = new DatabaseSync(path.join(fixture.providers, '.codex/state_1.sqlite'))
  older.exec('CREATE TABLE threads (id TEXT, cwd TEXT)')
  older.prepare('INSERT INTO threads VALUES (?, ?)').run(uuid(18), project)
  older.close()

  const cursorDir = path.join(fixture.providers, '.cursor/projects', project.replaceAll('/', '-'))
  const cursorFile = path.join(cursorDir, 'agent-transcripts', uuid(20), `${uuid(20)}.jsonl`)
  await write(cursorFile, jsonl([{ role: 'user', message: 'Cursor fixture', timestamp: iso() }, { type: 'turn_ended', status: 'success' }, { role: 'user', message: 'Continue', timestamp: iso() }]))
  const before = await fingerprint(fixture.providers)
  const result = await observed(scan)
  const find = (id: string) => {
    const session = result.sessions.find((session) => session.id === id)
    assert.ok(session, `Missing fixture ${id}`)
    return session
  }

  await check('all three adapters detect only the seeded stores, with no scan failures', () => {
    assert.ok(result.harnesses.every((harness) => harness.detected))
    assert.deepEqual(result.problems, [])
    assert.equal(result.sessions.length, 11)
    assert.equal(new Set(result.sessions.map((session) => session.id)).size, result.sessions.length)
  })
  await check('Claude live tool use runs, a handed-back turn waits, and a dead process is idle', () => {
    assert.equal(find(`claude-code:${uuid(1)}`).status, 'running')
    assert.equal(find(`claude-code:${uuid(2)}`).status, 'waiting')
    assert.equal(find(`claude-code:${uuid(5)}`).status, 'idle')
    assert.equal(find(`claude-code:${uuid(2)}`).statusProvenance, 'inferred')
  })
  await check('Claude errors remain explicit and duplicate resume records retain one identity', () => {
    assert.equal(find(`claude-code:local_${uuid(3)}`).status, 'errored')
    assert.equal(find(`claude-code:local_${uuid(3)}`).statusProvenance, 'measured')
    assert.equal(result.sessions.filter((session) => session.id === `claude-code:${uuid(4)}`).length, 1)
    assert.equal(find(`claude-code:${uuid(4)}`).title, 'Original session')
  })
  await check('subagents and guardian/spawn-edge rows do not become project sessions', () => {
    for (const n of [14, 16, 17, 18]) assert.ok(!result.sessions.some((session) => session.id === `codex:${uuid(n)}`))
    assert.equal(result.sessions.filter((session) => session.harness === 'claude-code').length, 5)
  })
  await check('Codex running, failed, aborted and finished turns remain distinct', () => {
    assert.equal(find(`codex:${uuid(10)}`).status, 'running')
    assert.equal(find(`codex:${uuid(11)}`).status, 'errored')
    assert.equal(find(`codex:${uuid(12)}`).status, 'idle')
    assert.equal(find(`codex:${uuid(13)}`).status, 'idle')
  })
  await check('the newest SQLite schema merges transcript identity and keeps archived records', () => {
    const session = find(`codex:${uuid(10)}`)
    assert.equal(session.title, 'Database task title')
    assert.equal(session.model, 'fixture-model')
    assert.equal(session.createdAt, (Math.floor(now / 1000) - 20) * 1000)
    assert.equal(find(`codex:${uuid(15)}`).archived, true)
  })
  await check('Cursor decodes the fixture project and infers its continuing turn', () => {
    const session = find(`cursor:${uuid(20)}`)
    assert.equal(session.cwd, project)
    assert.equal(session.status, 'running')
    assert.equal(session.statusProvenance, 'inferred')
  })
  await check('finished sessions resume under the same Codex identity', async () => {
    await fs.appendFile(codexFile(13), jsonl([{ type: 'event_msg', payload: { type: 'task_started' } }]))
    const resumed = await observed(scan)
    assert.equal(resumed.sessions.filter((session) => session.id === `codex:${uuid(13)}`).length, 1)
    assert.equal(resumed.sessions.find((session) => session.id === `codex:${uuid(13)}`)?.status, 'running')
    const link = await openSession('codex', { sessionId: uuid(13) })
    assert.ok(link.ok)
    assert.equal(link.url, `codex://threads/${uuid(13)}`)
  })
  await check('a waiting session lights its connected stone and unknown quota stays unknown', async () => {
    const stones = deriveStones(result.sessions, { ...defaultGrove(), stones: [{ path: project }] }, now)
    assert.equal(stones.stones[0]?.status, 'waiting')
    const limits = await observed(() => codexUsage(now))
    assert.ok(limits?.windows.every((window) => window.provenance === 'unknown' && window.usedPercent === null))
  })
  await check('Claude counts only fixture main/subagent usage and invents no percentage', async () => {
    const usage = await observed(() => claudeUsage(now))
    assert.ok(usage)
    for (const window of usage.windows) {
      assert.equal(window.tokens, 23)
      assert.equal(window.provenance, 'measured')
      assert.equal(window.usedPercent, null)
    }
  })
  await check('Codex quota comes from the seeded reading, not the real account', async () => {
    await fs.appendFile(codexFile(12), jsonl([{ type: 'event_msg', timestamp: iso(), payload: { type: 'token_count', rate_limits: {
      primary: { used_percent: 37, window_minutes: 300, resets_at: Math.floor(now / 1000) + 600 },
      secondary: { used_percent: 19, window_minutes: 10080, resets_at: Math.floor(now / 1000) + 3600 },
    } } }]))
    const usage = await observed(() => codexUsage(now))
    assert.equal(usage?.windows[0]?.usedPercent, 37)
    assert.equal(usage?.windows[1]?.usedPercent, 19)
    await write(codexFile(12), rollout(12, 'turn_aborted'))
  })
  await check('scans and usage reads leave every provider fixture byte unchanged', async () => {
    // The deliberate resume above is the only writer; remove its appended lifecycle line first.
    await write(codexFile(13), rollout(13, 'task_complete'))
    await observed(() => claudeUsage(now))
    await observed(() => codexUsage(now))
    assert.deepEqual(await fingerprint(fixture.providers), before)
  })
  await check('stopping the polling loop during its first pass publishes no stale result', async () => {
    let published = 0
    let finished = 0
    let complete!: () => void
    const completed = new Promise<void>((resolve) => { complete = resolve })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const diagnostics = HARNESSES.map((harness) => harness.diagnostic)
    // Diagnostics are the final async stage. Wait for the actual pass, not an arbitrary delay.
    for (const harness of HARNESSES) harness.diagnostic = async () => {
      if (++finished === HARNESSES.length) complete()
      return ''
    }
    try {
      await observed(async () => {
        const stop = startScanLoop(() => { published++ }, 10)
        stop()
        await Promise.race([completed, new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Fixture scan did not finish within five seconds')), 5000)
        })])
        await new Promise<void>((resolve) => setImmediate(resolve))
      })
    } finally {
      clearTimeout(timeout)
      HARNESSES.forEach((harness, index) => { harness.diagnostic = diagnostics[index] })
    }
    assert.equal(published, 0)
  })
  console.log(`\n${passed} isolated provider checks passed.`)
} finally {
  Date.now = originalNow
  await fixture.dispose()
}
