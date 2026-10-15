/**
 * A run's life after launch, checked without sending anything. Run with `npm run verify:lifecycle`.
 *
 * Found by the audit of 15 October 2026 in the real app: a launch that died before its session
 * began said "starting" for fifteen minutes and blocked the console; a resumed session sitting at
 * its prompt said "Working" for as long as it sat; "Resume" was offered on a session whose window
 * was still open; and a Terminal opened from inside Claude Code made every run a child session
 * that saved no transcript. These checks pin each fix down.
 *
 * The launch script is really run by zsh against a stand-in tool, so the process files and the
 * signal handling are the script's own behaviour, not a model of it. Everything happens in a
 * disposable folder; `AGENTIC_GROVE_HOME` points there before anything reads it.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-lifecycle-'))
process.env.AGENTIC_GROVE_HOME = path.join(scratch, 'home')

const { launch } = await import('../core/spawn/launch.ts')
const { clearRunProcess, exitFile, pidFile, pruneRunProcesses, readRunProcess } = await import('../core/spawn/process.ts')
const { RunBook } = await import('../core/spawn/runs.ts')
type Run = import('../core/spawn/runs.ts').Run
type HookCall = import('../core/hooks/protocol.ts').HookCall
type Session = import('../core/harnesses/types.ts').Session

const folder = path.join(scratch, 'project')
const markers = path.join(scratch, 'markers')
await fsp.mkdir(folder)

/** Write a stand-in tool whose body is the given zsh, and return its path. */
async function tool(name: string, body: string): Promise<string> {
  const file = path.join(scratch, name)
  await fsp.writeFile(file, `#!/bin/zsh\n${body}\n`, { mode: 0o700 })
  return file
}

/** Instead of Terminal: run the script in zsh and wait for it, with whatever environment is given. */
const runInZsh = (env: NodeJS.ProcessEnv = process.env) => async (file: string) => {
  execFileSync('/bin/zsh', [file], { stdio: 'ignore', env })
  return ''
}

function fakeRun(fields: Partial<Run> = {}): Run {
  return {
    id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    harness: 'claude-code',
    agentId: 'builder',
    agentName: 'Builder',
    stoneId: folder,
    task: 'x',
    createdAt: 1000,
    updatedAt: 1000,
    state: 'starting',
    sessionId: '',
    ...fields,
  }
}

const hook = (event: HookCall['event'], sessionId: string, at: number, extra: Partial<HookCall> = {}): HookCall =>
  ({ event, sessionId, cwd: folder, tool: '', idle: false, agentId: '', agentType: '', at, ...extra })
const session = (id: string, fields: Partial<Session> = {}): Session =>
  ({ id: `claude-code:${id}`, harness: 'claude-code', status: 'running', cwd: folder, createdAt: 5000, ...fields }) as Session

/** A run book with one Claude Code run in it, and that run. */
function bookWithRun(name: string, at = 1000) {
  const book = new RunBook(path.join(scratch, `${name}.json`))
  const run = book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'x' }, at)
  return { book, run }
}

const cases: [string, () => Promise<void>][] = [
  ['the launch script leaves its process id, then the tool’s exit code', async () => {
    const pidSeen = path.join(scratch, 'pid-seen.txt')
    // The tool reads the process id file while it runs, to prove it was written before the tool started.
    const cli = await tool('exits-3', `cat '${pidFile(fakeRun().id, markers)}' > '${pidSeen}'\nexit 3`)
    await launch({ run: fakeRun(), folder, brief: '', model: '' }, runInZsh(), async () => cli, markers)
    assert.match(await fsp.readFile(pidSeen, 'utf8'), /^\d+\n$/)
    const seen = await readRunProcess(fakeRun().id, markers)
    assert.equal(seen.state, 'gone')
    assert.equal(seen.state === 'gone' && seen.code, 3)
  }],
  ['closing the window (a hang-up) still leaves the exit code, and the tool still gets the signal', async () => {
    const got = path.join(scratch, 'got-hup.txt')
    // The stand-in hangs up its own script, as a closing Terminal window does to both, then exits
    // the way Claude Code does on a hang-up.
    const cli = await tool('hung-up', `trap 'print hup > ${got}; exit 129' HUP\nkill -HUP $PPID\nkill -HUP $$\nsleep 5`)
    await launch({ run: fakeRun(), folder, brief: '', model: '' }, runInZsh(), async () => cli, markers)
    assert.equal(await fsp.readFile(got, 'utf8'), 'hup\n', 'the tool did not get the hang-up')
    const seen = await readRunProcess(fakeRun().id, markers)
    assert.equal(seen.state === 'gone' && seen.code, 129)
  }],
  ['a run never inherits another Claude Code session’s identity, but keeps your own settings', async () => {
    const out = path.join(scratch, 'env.txt')
    const cli = await tool('env', `print -r -- "\${CLAUDECODE:-unset} \${CLAUDE_CODE_CHILD_SESSION:-unset} \${CLAUDE_CODE_SESSION_ID:-unset} \${CLAUDE_CODE_USE_BEDROCK:-unset}" > '${out}'`)
    const inherited = { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'parent', CLAUDE_CODE_USE_BEDROCK: '1' }
    await launch({ run: fakeRun(), folder, brief: '', model: '' }, runInZsh(inherited), async () => cli, markers)
    assert.equal(await fsp.readFile(out, 'utf8'), 'unset unset unset 1\n')
  }],
  ['the files are read honestly: none is unknown, a live id is open, a dead one is gone with no code', async () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000001'
    assert.equal((await readRunProcess(id, markers)).state, 'unknown')
    await fsp.writeFile(pidFile(id, markers), 'not a number\n')
    assert.equal((await readRunProcess(id, markers)).state, 'unknown', 'a garbled id was trusted')
    await fsp.writeFile(pidFile(id, markers), `${process.pid}\n`)
    assert.equal((await readRunProcess(id, markers)).state, 'alive')
    const child = spawn('/usr/bin/true')
    await new Promise((resolve) => child.on('exit', resolve))
    await fsp.writeFile(pidFile(id, markers), `${child.pid}\n`)
    const gone = await readRunProcess(id, markers, () => false, 7000)
    assert.deepEqual(gone, { state: 'gone', code: null, at: 7000 })
  }],
  ['resuming clears the last window’s files, so its exit is not read as the new one’s', async () => {
    const run = fakeRun({ id: 'aaaaaaaa-0000-4000-8000-000000000002', state: 'ended', sessionId: 'x' })
    await fsp.writeFile(exitFile(run.id, markers), '0\n')
    let seenWhenOpened = ''
    const open = async (file: string) => {
      seenWhenOpened = (await readRunProcess(run.id, markers)).state
      execFileSync('/bin/zsh', [file], { stdio: 'ignore' })
      return ''
    }
    await launch({ run, folder, brief: '', model: '', resume: true }, open, async () => tool('ok', 'exit 0'), markers)
    assert.equal(seenWhenOpened, 'unknown', 'the old exit file was still there when Terminal opened')
    await clearRunProcess(run.id, markers)
    assert.equal((await readRunProcess(run.id, markers)).state, 'unknown')
  }],
  ['a launch that stops before any session fails at once with what to do, after a short grace', async () => {
    const { book, run } = bookWithRun('never-started')
    assert.equal(book.onProcess(run.id, { state: 'gone', code: 0, at: 10_000 }, 20_000), false, 'failed before the scan had a chance to see it')
    assert.equal(book.get(run.id)?.state, 'starting')
    book.onProcess(run.id, { state: 'gone', code: 0, at: 10_000 }, 30_000)
    assert.equal(book.get(run.id)?.state, 'failed')
    assert.match(book.get(run.id)?.error ?? '', /trust the folder/)
    assert.equal(book.get(run.id)?.process, 'closed')
    const crashed = bookWithRun('crashed')
    crashed.book.onProcess(crashed.run.id, { state: 'gone', code: 2, at: 0 }, 60_000)
    assert.match(crashed.book.get(crashed.run.id)?.error ?? '', /exit code 2/)
  }],
  ['a session whose window closed is ended, even with no SessionEnd hook, and its workers stop showing', async () => {
    const book = new RunBook(path.join(scratch, 'closed.json'))
    const run = book.create({ harness: 'claude-code', agentId: 'manager', agentName: 'PM', stoneId: folder, task: 'x', team: { researcher: 'researcher' } }, 1000)
    book.onHook(hook('SessionStart', run.id, 2000, { source: 'startup' }))
    book.onHook(hook('SubagentStart', run.id, 2100, { agentId: 'sub-1', agentType: 'researcher' }))
    book.onProcess(run.id, { state: 'alive', pid: 1 }, 2200)
    assert.equal(book.get(run.id)?.process, 'open')
    assert.equal(book.get(run.id)?.state, 'running')
    book.onProcess(run.id, { state: 'gone', code: null, at: 3000 }, 3000)
    assert.equal(book.get(run.id)?.state, 'ended')
    assert.equal(book.get(run.id)?.helping, undefined)
    // A transcript written a moment before the window closed must not bring it back to "running".
    const scanBook = bookWithRun('closed-scan')
    scanBook.book.onProcess(scanBook.run.id, { state: 'gone', code: 0, at: 0 }, 60_000)
    scanBook.book.onScan([session(scanBook.run.id, { status: 'running' })], 61_000)
    assert.equal(scanBook.book.get(scanBook.run.id)?.state, 'failed')
  }],
  ['a run still saying "running" settles on the idle reminder; a finished one stays finished, not amber', async () => {
    const { book, run } = bookWithRun('idle')
    book.onHook(hook('SessionStart', run.id, 2000, { source: 'startup' }))
    book.onHook(hook('PreToolUse', run.id, 3000))
    // The Stop was lost. A minute later Claude Code says it is waiting for input.
    book.onHook(hook('Notification', run.id, 63_000, { idle: true }))
    assert.equal(book.get(run.id)?.state, 'finished')
    assert.equal(book.onHook(hook('Notification', run.id, 123_000, { idle: true })), false)
    assert.equal(book.get(run.id)?.state, 'finished')
  }],
  ['a resumed session opens as finished (at its prompt), a new one as working', async () => {
    const { book, run } = bookWithRun('resume')
    book.onHook(hook('SessionStart', run.id, 2000, { source: 'startup' }))
    assert.equal(book.get(run.id)?.state, 'running')
    book.onHook(hook('Stop', run.id, 3000))
    book.onProcess(run.id, { state: 'gone', code: 0, at: 4000 }, 4000)
    book.resumed(run.id, 5000)
    assert.equal(book.get(run.id)?.state, 'starting')
    assert.equal(book.get(run.id)?.process, undefined, 'the closed window was still remembered after resuming')
    assert.equal(book.get(run.id)?.exitCode, undefined)
    book.onHook(hook('SessionStart', run.id, 6000, { source: 'resume' }))
    assert.equal(book.get(run.id)?.state, 'finished')
    book.onHook(hook('UserPromptSubmit', run.id, 7000))
    assert.equal(book.get(run.id)?.state, 'running')
  }],
  ['after a restart, an open window is checked again and a closed one ends the run', async () => {
    const file = path.join(scratch, 'restart.json')
    const book = new RunBook(file)
    const run = book.create({ harness: 'claude-code', agentId: 'builder', agentName: 'Builder', stoneId: folder, task: 'x' }, 1000)
    book.onHook(hook('SessionStart', run.id, 2000, { source: 'startup' }))
    book.onProcess(run.id, { state: 'alive', pid: 1 }, 2100)
    await book.flushed()
    const again = new RunBook(file)
    await again.load()
    assert.equal(again.get(run.id)?.process, 'open')
    again.onProcess(run.id, { state: 'gone', code: null, at: 9000 }, 9000)
    assert.equal(again.get(run.id)?.state, 'ended')
    // Let that save land first, or it can overwrite the hand edit below (it did on CI's slower disk).
    await again.flushed()
    // A hand-edited file with nonsense in the new fields keeps the run and drops the nonsense.
    const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as { runs: Record<string, unknown>[] }
    raw.runs[0]!.process = 'maybe'
    raw.runs[0]!.exitCode = 'zero'
    await fsp.writeFile(file, JSON.stringify(raw))
    const edited = new RunBook(file)
    await edited.load()
    assert.equal(edited.get(run.id)?.task, 'x')
    assert.equal(edited.get(run.id)?.process, undefined)
    assert.equal(edited.get(run.id)?.exitCode, undefined)
  }],
  ['files of runs the book no longer keeps are cleared, and nothing else in the folder', async () => {
    const keep = 'aaaaaaaa-0000-4000-8000-00000000000a'
    const drop = 'aaaaaaaa-0000-4000-8000-00000000000b'
    await fsp.writeFile(pidFile(keep, markers), '1\n')
    await fsp.writeFile(exitFile(drop, markers), '0\n')
    await fsp.writeFile(path.join(markers, 'notes.txt'), 'mine')
    await pruneRunProcesses(new Set([keep]), markers)
    const left = await fsp.readdir(markers)
    assert.ok(left.includes(`${keep}.pid`))
    assert.ok(!left.includes(`${drop}.exit`))
    assert.ok(left.includes('notes.txt'), 'a file that is not ours was removed')
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
console.log(`\nAll ${cases.length} lifecycle checks hold.`)
