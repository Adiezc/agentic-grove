/**
 * PM's channel, checked end to end without Claude Code. Run with `npm run verify:pm-channel`
 * (after `npx vite build`, which makes the helper).
 *
 * The real built helper (`dist-electron/grove-channel.js`) is started the way Claude Code starts
 * it, and this check plays Claude Code's part on its stdin and stdout: the MCP handshake, the
 * tool list, a reply, a permission prompt and its answer. The Grove's side is the real chat and
 * bridge, in a disposable grove. Then the allowance rules on `send_agent`, and the launch script
 * PM is started with, against a stand-in `claude`.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-pm-'))
process.env.AGENTIC_GROVE_HOME = path.join(scratch, 'home')
const { PmChat } = await import('../core/pm/chat.ts')
const { startPmBridge } = await import('../core/pm/bridge.ts')
const { callPmTool, guardSend, pmTools } = await import('../core/pm/tools.ts')
const { bridgeFile, TOKEN_HEADER } = await import('../core/pm/protocol.ts')
const { defaultSettings } = await import('../core/state/schema.ts')
const { launch } = await import('../core/spawn/launch.ts')

const helperScript = path.resolve('dist-electron/grove-channel.js')
await fsp.access(helperScript).catch(() => {
  throw new Error('Build first: npx vite build (makes dist-electron/grove-channel.js)')
})

const chat = new PmChat()
const settings = defaultSettings()
let usage: unknown = null
const host = { settings: async () => settings, usage: () => usage as never, toolFor: async () => 'claude-code' as const }
const bridge = await startPmBridge({ chat, tools: pmTools, callTool: (name, args) => callPmTool(name, args, host) })

/* ---- Playing Claude Code ------------------------------------------------------------------ */

const child = spawn(process.execPath, [helperScript], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] })
const incoming: Record<string, unknown>[] = []
const waiters: (() => void)[] = []
readline.createInterface({ input: child.stdout! }).on('line', (line) => {
  incoming.push(JSON.parse(line) as Record<string, unknown>)
  for (const wake of waiters.splice(0)) wake()
})
const write = (message: Record<string, unknown>) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

async function next(match: (m: Record<string, unknown>) => boolean, ms = 8000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + ms
  for (;;) {
    const at = incoming.findIndex(match)
    if (at >= 0) return incoming.splice(at, 1)[0]!
    if (Date.now() > deadline) throw new Error('timed out waiting for the helper')
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
      setTimeout(resolve, 200)
    })
  }
}
let ids = 0
async function request(method: string, params: Record<string, unknown> = {}) {
  const id = ++ids
  write({ id, method, params })
  return next((m) => m.id === id)
}
const until = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const cases: [string, () => Promise<void>][] = [
  ['the handshake declares a channel with permission relay, and never offers revision 2026-07-28', async () => {
    const answer = (await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } })).result as Record<string, any>
    assert.equal(answer.protocolVersion, '2025-06-18')
    assert.deepEqual(answer.capabilities.experimental, { 'claude/channel': {}, 'claude/channel/permission': {} })
    assert.ok(answer.instructions.includes('reply tool'))
    const newer = (await request('initialize', { protocolVersion: '2026-07-28' })).result as Record<string, any>
    assert.notEqual(newer.protocolVersion, '2026-07-28')
    write({ method: 'notifications/initialized' })
  }],
  ['PM is offered reply, the Grove actions, pick_model and usage_status', async () => {
    const tools = ((await request('tools/list')).result as { tools: { name: string }[] }).tools.map((t) => t.name)
    for (const name of ['reply', 'grove_status', 'send_agent', 'create_agent', 'make_clearing', 'split_stone', 'pick_model', 'usage_status']) assert.ok(tools.includes(name), name)
  }],
  ['what you type reaches PM as a channel event, and the chat counts PM as listening', async () => {
    await until(() => chat.state().connected)
    chat.say('What is on my plate today?')
    const event = await next((m) => m.method === 'notifications/claude/channel')
    const params = event.params as { content: string; meta: { chat_id: string } }
    assert.equal(params.content, 'What is on my plate today?')
    assert.match(params.meta.chat_id, /^[0-9a-f-]{36}$/)
    assert.equal(chat.state().working, true)
  }],
  ['PM\'s reply shows in the chat, flagged when it needs you, and clears "working"', async () => {
    const result = (await request('tools/call', { name: 'reply', arguments: { text: 'Shall I start the Builder on the tests?', needs_you: true } })).result as { isError: boolean }
    assert.equal(result.isError, false)
    const state = chat.state()
    const last = state.messages.at(-1)!
    assert.equal(last.from, 'pm')
    assert.equal(last.needsYou, true)
    assert.equal(state.needsYou, true)
    assert.equal(state.working, false)
  }],
  ['a permission prompt becomes an open card; Allow goes back to Claude Code as a verdict with its id', async () => {
    write({ method: 'notifications/claude/channel/permission_request', params: { request_id: 'abcde', tool_name: 'Bash', description: 'Run the tests', input_preview: '{"command":"npm test"}' } })
    await until(() => chat.state().messages.some((m) => m.permission?.request_id === 'abcde'))
    assert.equal(chat.answerPermission('abcde', true), true)
    const verdict = await next((m) => m.method === 'notifications/claude/channel/permission')
    assert.deepEqual(verdict.params, { request_id: 'abcde', behavior: 'allow' })
    assert.equal(chat.answerPermission('abcde', false), false, 'an answered prompt cannot be answered twice')
    assert.equal(chat.answerPermission('ablde', true), false, 'not an id Claude Code makes')
  }],
  ['a Grove tool call goes through: grove_status answers in plain words', async () => {
    const result = (await request('tools/call', { name: 'grove_status', arguments: {} })).result as { isError: boolean; content: { text: string }[] }
    assert.equal(result.isError, false)
    assert.ok(result.content[0]!.text.length > 0)
  }],
  ['the bridge turns away a wrong token and anything from a web page', async () => {
    const { port, token } = JSON.parse(await fsp.readFile(bridgeFile(), 'utf8')) as { port: number; token: string }
    const mode = (await fsp.stat(bridgeFile())).mode & 0o777
    assert.equal(mode, 0o600)
    const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/pm/tools`, { method: 'POST', headers, body: '{}' })
    assert.equal((await post({ [TOKEN_HEADER]: 'nope' })).status, 404)
    assert.equal((await post({ [TOKEN_HEADER]: token, Origin: 'https://evil.example' })).status, 403)
    assert.equal((await post({ [TOKEN_HEADER]: token })).status, 200)
  }],
  ['send_agent gets the Grove\'s pick when PM gives none, and Opus over 70% waits for your yes', async () => {
    const quiet = await guardSend({ agent: 'builder', stone: 'x', task: 'fix the failing scan test' }, host)
    assert.ok('args' in quiet)
    assert.equal(quiet.args.model, 'opus')
    assert.equal(quiet.args.effort, 'medium')
    const now = Date.now()
    const window = (key: string, usedPercent: number) => ({ key, provenance: 'official', usedPercent, resetsAt: now + 3_600_000, tokens: null, observedAt: now })
    usage = { at: now, providers: [{ provider: 'claude-code', name: 'Claude Code', windows: [window('five_hour', 80)] }] }
    const asked = await guardSend({ agent: 'builder', stone: 'x', task: 'fix the failing scan test' }, host)
    assert.ok('refused' in asked, 'Opus at 80% must wait for a yes')
    assert.match(asked.refused, /person_ok/)
    const ok = await guardSend({ agent: 'builder', stone: 'x', task: 'fix the failing scan test', person_ok: true }, host)
    assert.ok('args' in ok)
    assert.equal('person_ok' in ok.args, false, 'person_ok is the Grove\'s word, not passed on')
    usage = { at: now, providers: [{ provider: 'claude-code', name: 'Claude Code', windows: [window('five_hour', 95)] }] }
    const held = await guardSend({ agent: 'builder', stone: 'x', task: 'fix the failing scan test' }, host)
    assert.ok('refused' in held && /reset/.test(held.refused), 'over 90% new jobs wait for the reset')
    usage = null
  }],
  ['PM\'s launch: channel, permission mode and stone folders arrive as Claude Code expects, also on resume', async () => {
    const record = path.join(scratch, 'args.bin')
    const fakeCli = path.join(scratch, 'fake-cli')
    await fsp.writeFile(fakeCli, `#!/bin/zsh\n{ for a in "$@"; do print -rn -- "$a"; printf '\\0'; done } > '${record}'\n`, { mode: 0o700 })
    const runInZsh = async (file: string) => {
      execFileSync('/bin/zsh', [file], { stdio: 'ignore' })
      return ''
    }
    const folder = path.join(scratch, 'pm')
    await fsp.mkdir(folder, { recursive: true })
    const run = { id: '0b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b', harness: 'claude-code' as const, agentId: 'manager', agentName: 'PM', stoneId: folder, task: '', createdAt: 1, updatedAt: 1, state: 'starting' as const, sessionId: '' }
    const spec = { run, folder, brief: 'Be PM.', model: 'opus', effort: 'medium', channel: { mcpConfig: '/tmp/pm mcp.json' }, permissionMode: 'acceptEdits', addDirs: ['/Users/x/My Project', '/Users/x/other'] }
    assert.equal((await launch(spec, runInZsh, async () => fakeCli)).ok, true)
    let args = (await fsp.readFile(record, 'utf8')).split('\0').slice(0, -1)
    assert.deepEqual(args.slice(-12), ['--permission-mode', 'acceptEdits', '--add-dir', '/Users/x/My Project', '--add-dir', '/Users/x/other', '--mcp-config', '/tmp/pm mcp.json', '--dangerously-load-development-channels', 'server:grove', '--allowedTools', 'mcp__grove'])
    assert.equal(args.at(-1), 'mcp__grove')
    assert.ok(args.includes('--effort') && args.includes('--model'))
    assert.equal((await launch({ ...spec, resume: true }, runInZsh, async () => fakeCli)).ok, true)
    args = (await fsp.readFile(record, 'utf8')).split('\0').slice(0, -1)
    assert.deepEqual(args.slice(0, 2), ['--resume', run.id])
    assert.ok(args.includes('--append-system-prompt') && args.includes('server:grove'), 'a resumed PM keeps its brief and channel')
    const bad = await launch({ ...spec, permissionMode: 'bypassPermissions' }, runInZsh, async () => fakeCli)
    assert.equal(bad.ok, false)
  }],
  ['the conversation survives a restart; a prompt left open by a gone session is closed', async () => {
    await chat.settled()
    const again = new PmChat()
    await again.load()
    const texts = again.state().messages.map((m) => m.text)
    assert.ok(texts.includes('What is on my plate today?'))
    assert.ok(again.state().messages.every((m) => m.permission?.state !== 'open'))
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
child.kill()
await bridge.close()
await fsp.rm(scratch, { recursive: true, force: true })
if (failed) {
  console.log(`\n${failed} of ${cases.length} PM channel checks failed.`)
  process.exit(1)
}
console.log(`\nAll ${cases.length} PM channel checks hold.`)
process.exit(0)
