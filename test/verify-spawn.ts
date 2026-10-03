/**
 * Sending agents, checked without sending any. Run with `npm run verify:spawn`.
 *
 * Two halves. The launcher's script is really run by zsh, but against a stand-in for `claude` and
 * `codex` that writes down the arguments it was given and exits, so the check proves what Claude
 * Code would receive: a task full of quotes, `$(...)`, newlines and a leading dash must arrive as
 * one untouched argument and never run as a command. The run book is driven with made-up hook calls
 * and scans, in a disposable folder, to check each state change happens on evidence and only then.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Session } from '../core/harnesses/types.ts'
import type { HookCall } from '../core/hooks/protocol.ts'
import { claudeAgentsJson, pmBrief, teamFor } from '../core/spawn/briefs.ts'
import { launch } from '../core/spawn/launch.ts'
import { RunBook, type Run } from '../core/spawn/runs.ts'

const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-spawn-'))
const folder = path.join(scratch, 'My project (with spaces)')
await fsp.mkdir(folder)

/** A stand-in tool: records its working folder and each argument, NUL-separated, then exits. */
const record = path.join(scratch, 'args.bin')
const fakeCli = path.join(scratch, 'fake-cli')
const depth = path.join(scratch, 'depth.txt')
await fsp.writeFile(fakeCli, `#!/bin/zsh\n{ print -rn -- "$PWD"; printf '\\0'; for a in "$@"; do print -rn -- "$a"; printf '\\0'; done } > '${record}'\nprint -rn -- "\${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-none}" > '${depth}'\n`, { mode: 0o700 })

/** Instead of Terminal: run the script in zsh straight away and wait for it. */
const runInZsh = async (file: string) => {
  execFileSync('/bin/zsh', [file], { stdio: 'ignore' })
  return ''
}
const recorded = async () => (await fsp.readFile(record, 'utf8')).split('\0').slice(0, -1)

const nasty = `--dangerously-skip-permissions "quoted" 'single' $(touch ${path.join(scratch, 'pwned')}) \`id\`\nsecond line; rm -rf ~`

function fakeRun(fields: Partial<Run> = {}): Run {
  return {
    id: '0b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b',
    harness: 'claude-code',
    agentId: 'builder',
    agentName: 'Builder',
    stoneId: folder,
    task: nasty,
    createdAt: 1000,
    updatedAt: 1000,
    state: 'starting',
    sessionId: '',
    ...fields,
  }
}

const session = (id: string, fields: Partial<Session> = {}): Session =>
  ({ id, harness: id.split(':')[0], status: 'running', cwd: folder, createdAt: 5000, ...fields }) as Session
const hook = (event: HookCall['event'], sessionId: string, at = 9000): HookCall => ({ event, sessionId, cwd: folder, tool: '', idle: false, at })

const cases: [string, () => Promise<void>][] = [
  ['Claude Code gets the task as one argument, untouched, and nothing in it runs', async () => {
    const result = await launch({ run: fakeRun(), folder, brief: 'Be brief.', model: '' }, runInZsh, async () => fakeCli)
    assert.equal(result.ok, true)
    const [cwd, ...args] = await recorded()
    assert.equal(await fsp.realpath(cwd!), await fsp.realpath(folder))
    assert.deepEqual(args, [
      '--session-id', fakeRun().id,
      '--name', 'Builder: --dangerously-skip-permissions "quoted" \'single…',
      '--append-system-prompt', 'Be brief.',
      ` ${nasty}`,
    ])
    await assert.rejects(fsp.access(path.join(scratch, 'pwned')), 'the $(...) in the task ran')
  }],
  ['an empty task opens Claude Code with no prompt, and no model flag when none is set', async () => {
    await launch({ run: fakeRun({ task: '' }), folder, brief: '', model: '' }, runInZsh, async () => fakeCli)
    const [, ...args] = await recorded()
    assert.deepEqual(args, ['--session-id', fakeRun().id, '--name', 'Builder'])
  }],
  ['a model is passed when the agent has one', async () => {
    await launch({ run: fakeRun({ task: 'hi' }), folder, brief: '', model: 'opus' }, runInZsh, async () => fakeCli)
    const [, ...args] = await recorded()
    assert.deepEqual(args.slice(-3), ['--model', 'opus', 'hi'])
  }],
  ['resuming passes only the session id', async () => {
    await launch({ run: fakeRun(), folder, brief: 'ignored', model: '', resume: true }, runInZsh, async () => fakeCli)
    const [, ...args] = await recorded()
    assert.deepEqual(args, ['--resume', fakeRun().id])
  }],
  ['Codex gets the brief and the task as one opening prompt', async () => {
    await launch({ run: fakeRun({ harness: 'codex', task: 'Fix it' }), folder, brief: 'You build.', model: '' }, runInZsh, async () => fakeCli)
    const [, ...args] = await recorded()
    assert.deepEqual(args, ['You build.\n\nFix it'])
  }],
  ['PM on Claude Code gets its team as subagents, and its workers cannot start their own', async () => {
    const team = claudeAgentsJson(teamFor([]))
    await launch({ run: fakeRun({ agentId: 'manager', agentName: 'PM', task: 'hi' }), folder, brief: 'Lead.', model: '', agents: team }, runInZsh, async () => fakeCli)
    const [, ...args] = await recorded()
    assert.deepEqual(args.slice(-3), ['--agents', team, 'hi'])
    assert.equal(await fsp.readFile(depth, 'utf8'), '1')
    await launch({ run: fakeRun({ task: 'hi' }), folder, brief: '', model: '' }, runInZsh, async () => fakeCli)
    assert.ok(!(await recorded()).includes('--agents'), 'a run without a team got one')
    assert.equal(await fsp.readFile(depth, 'utf8'), 'none')
    await launch({ run: fakeRun({ harness: 'codex', agentId: 'manager', task: 'hi' }), folder, brief: 'Lead.', model: '', agents: team }, runInZsh, async () => fakeCli)
    assert.deepEqual((await recorded()).slice(1), ['Lead.\n\nhi'], 'Codex has no --agents; its team is in the brief')
  }],
  ['PM\'s team: the built-in workers, then your agents, each under a name of its own', async () => {
    const team = teamFor([
      { id: 'a1', name: 'Code Reviewer', description: 'Reads diffs.', systemPrompt: 'Be blunt.', model: 'opus' },
      { id: 'a2', name: 'Builder', description: '' },
    ])
    assert.deepEqual(team.map((worker) => worker.key), ['researcher', 'builder', 'code-reviewer', 'builder-2'])
    const json = JSON.parse(claudeAgentsJson(team)) as Record<string, { prompt: string; tools?: string[]; model?: string }>
    assert.ok(!json.researcher!.tools!.some((tool) => /Edit|Write/.test(tool)), 'the Researcher can change files')
    assert.equal(json['code-reviewer']!.model, 'opus')
    assert.match(json['code-reviewer']!.prompt, /Be blunt\./)
    assert.equal(json.builder!.tools, undefined)
    const forCodex = pmBrief(team, 'codex')
    for (const worker of team) assert.ok(forCodex.includes(worker.prompt), `Codex is not told what ${worker.key} does`)
    assert.ok(!pmBrief(team, 'claude-code').includes(team[0]!.prompt), 'Claude Code already has the prompts; the brief repeats them')
  }],
  ['the temporary folder with the task in it is gone once the tool starts', async () => {
    const before = new Set((await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith('agentic-grove-run-')))
    await launch({ run: fakeRun(), folder, brief: '', model: '' }, runInZsh, async () => fakeCli)
    const after = (await fsp.readdir(os.tmpdir())).filter((name) => name.startsWith('agentic-grove-run-') && !before.has(name))
    assert.deepEqual(after, [])
  }],
  ['a missing command fails with which tool to install, and opens nothing', async () => {
    let opened = false
    const result = await launch({ run: fakeRun(), folder, brief: '', model: '' }, async () => ((opened = true), ''), async () => null)
    assert.equal(result.ok, false)
    assert.equal(!result.ok && result.missing, 'claude-code')
    assert.equal(opened, false)
  }],
  ['a run moves only on evidence: hooks for Claude Code, in order', async () => {
    const book = new RunBook(path.join(scratch, 'runs-a.json'))
    const run = book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'x' }, 1000)
    assert.equal(book.onHook(hook('PreToolUse', 'aaaaaaaa-0000-0000-0000-000000000000')), false, 'a stranger’s hook moved our run')
    assert.equal(book.get(run.id)?.state, 'starting')
    book.onHook(hook('SessionStart', run.id))
    assert.equal(book.get(run.id)?.state, 'running')
    assert.equal(book.get(run.id)?.sessionId, run.id)
    book.onHook(hook('Notification', run.id))
    assert.equal(book.get(run.id)?.state, 'waiting')
    book.onHook(hook('Stop', run.id))
    assert.equal(book.get(run.id)?.state, 'finished')
    // Once hooks have spoken, a scan that reads "waiting" off the transcript must not overrule them.
    book.onScan([session(`claude-code:${run.id}`, { status: 'running' })], 9500)
    assert.equal(book.get(run.id)?.state, 'finished')
    // Claude Code's idle reminder a minute later is not a question: the run stays finished, not amber.
    assert.equal(book.onHook({ ...hook('Notification', run.id), idle: true }), false)
    assert.equal(book.get(run.id)?.state, 'finished')
    book.onHook(hook('SessionEnd', run.id))
    assert.equal(book.get(run.id)?.state, 'ended')
  }],
  ['without hooks, the scan confirms a Claude Code run by its exact id', async () => {
    const book = new RunBook(path.join(scratch, 'runs-b.json'))
    const run = book.create({ harness: 'claude-code', agentId: 'researcher', agentName: 'Researcher', stoneId: folder, task: 'x' }, 1000)
    book.onScan([session('claude-code:ffffffff-0000-0000-0000-000000000000')], 2000)
    assert.equal(book.get(run.id)?.state, 'starting', 'another session in the same folder confirmed the run')
    book.onScan([session(`claude-code:${run.id}`, { status: 'waiting' })], 3000)
    assert.equal(book.get(run.id)?.state, 'finished')
  }],
  ['a Codex run takes the first new Codex session in its folder, and only one run can take it', async () => {
    const book = new RunBook(path.join(scratch, 'runs-c.json'))
    const first = book.create({ harness: 'codex', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'x' }, 10_000)
    const second = book.create({ harness: 'codex', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'y' }, 10_500)
    book.onScan([
      session('codex:old', { createdAt: 1000 }),
      session('codex:elsewhere', { createdAt: 11_000, cwd: '/somewhere/else' }),
      session('codex:new', { createdAt: 11_000 }),
    ], 12_000)
    assert.equal(book.get(first.id)?.sessionId, 'new')
    assert.equal(book.get(second.id)?.sessionId, '', 'two runs claimed one session')
  }],
  ['a run that never appears gives up after fifteen minutes, and says why', async () => {
    const book = new RunBook(path.join(scratch, 'runs-d.json'))
    const run = book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'x' }, 0)
    book.onScan([], 14 * 60_000)
    assert.equal(book.get(run.id)?.state, 'starting')
    book.onScan([], 16 * 60_000)
    assert.equal(book.get(run.id)?.state, 'failed')
    assert.match(book.get(run.id)?.error ?? '', /No session appeared/)
  }],
  ['runs survive a restart, and a broken file is an empty history rather than a crash', async () => {
    const file = path.join(scratch, 'runs-e.json')
    const book = new RunBook(file)
    const run = book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'keep me' })
    book.onHook(hook('SessionStart', run.id))
    await book.flushed()
    const again = new RunBook(file)
    await again.load()
    assert.equal(again.get(run.id)?.task, 'keep me')
    assert.equal(again.get(run.id)?.state, 'running')
    await fsp.writeFile(file, '{ not json')
    const broken = new RunBook(file)
    await broken.load()
    assert.deepEqual(broken.list(), [])
  }],
  ['many quick changes all land, none lost to overlapping saves', async () => {
    const file = path.join(scratch, 'runs-f.json')
    const book = new RunBook(file)
    const ids = Array.from({ length: 30 }, (_, index) =>
      book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: `t${index}` }, index).id
    )
    await book.flushed()
    const again = new RunBook(file)
    await again.load()
    assert.equal(again.list().length, ids.length)
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
await fsp.rm(scratch, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} spawn checks hold.`)
