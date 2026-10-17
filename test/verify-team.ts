/**
 * Agents talking to each other, checked without Claude Code. Run with `npm run verify:team`
 * (after `npx vite build`, which makes the helper).
 *
 * The book's rules on their own, then the real built helper in its two worker jobs: serving a
 * worker's team tools over MCP (a question that waits for PM's answer), and the per-run hooks that
 * hand a worker its messages after a tool or as it tries to stop. The Grove's side is a real bridge
 * wired the way the app wires it, in a disposable grove.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-team-'))
process.env.AGENTIC_GROVE_HOME = path.join(scratch, 'home')
const { PM, TeamBook, inboxText } = await import('../core/team/book.ts')
const { callTeamTool, findMember, memberName, teamTools } = await import('../core/team/tools.ts')
const { writeTeamFiles } = await import('../core/team/session.ts')
const { PmChat } = await import('../core/pm/chat.ts')
const { startPmBridge } = await import('../core/pm/bridge.ts')

const helperScript = path.resolve('dist-electron/grove-channel.js')
await fsp.access(helperScript)

const BUILDER = '11111111-2222-4333-8444-555555555555'
const RESEARCHER = '66666666-7777-4888-9999-000000000000'
const runs = [
  { id: BUILDER, agentName: 'Builder', stoneId: '/p/shellter', stoneName: 'Shellter', live: true },
  { id: RESEARCHER, agentName: 'Researcher', stoneId: '/p/data', stoneName: 'Data', live: true },
]
const host = { runs: () => runs }
const book = new TeamBook()
const chat = new PmChat()
const bridge = await startPmBridge({
  chat,
  tools: () => [],
  callTool: async () => ({ ok: false, text: 'unused' }),
  team: async (route, body) => {
    if (route === '/team/tools') return { tools: teamTools(false) }
    if (route === '/team/tool') return callTeamTool(String(body.runId), String(body.name), body.args, book, host)
    if (route === '/team/wait') {
      const answer = await book.waitForAnswer(String(body.askId), Math.min(Number(body.waitMs) || 0, 25_000))
      return answer ? { answer: answer.text } : {}
    }
    if (route === '/team/inbox') {
      const waiting = book.takeInbox(String(body.runId))
      return { text: waiting.length ? inboxText(waiting, (m) => memberName(m, runs)) : '' }
    }
    return {}
  },
})

/** Run the hook as Claude Code would. Not spawnSync: the bridge lives in this process and must answer. */
const runHook = (kind: 'post' | 'stop', sessionId: string) =>
  new Promise<string>((resolve) => {
    const child = spawn(process.execPath, [helperScript, '--hook', kind], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    child.stdout!.on('data', (chunk) => (out += chunk))
    child.on('close', () => resolve(out))
    child.stdin!.end(JSON.stringify({ session_id: sessionId, hook_event_name: kind }))
  })

const cases: [string, () => Promise<void>][] = [
  ['names find the right teammate; "pm" is PM; an unknown name says who is working', async () => {
    assert.equal(findMember('pm', '', runs), PM)
    assert.equal(findMember('builder', '', runs), BUILDER)
    assert.equal(findMember(RESEARCHER, '', runs), RESEARCHER)
    assert.match(String(findMember('Scribe', '', runs)), /Working now: Builder on Shellter, Researcher on Data/)
  }],
  ['PM\'s question returns at once; a worker\'s answer reaches PM and wakes nobody else', async () => {
    const asked = callTeamTool(PM, 'ask_agent', { to: 'Builder', question: 'How far along?' }, book, host)
    assert.equal(asked.ok, true)
    assert.equal(asked.askId, undefined, 'PM never waits')
    const ask = book.recent().at(-1)!
    assert.equal(ask.to, BUILDER)
    assert.equal(callTeamTool(RESEARCHER, 'answer_agent', { ask_id: ask.id, answer: 'nope' }, book, host).ok, false, 'only the one asked may answer')
    assert.equal(callTeamTool(BUILDER, 'answer_agent', { ask_id: ask.id, answer: 'Half done.' }, book, host).ok, true)
    assert.equal(callTeamTool(BUILDER, 'answer_agent', { ask_id: ask.id, answer: 'again' }, book, host).ok, false, 'answered once')
    assert.equal(book.recent().at(-1)!.to, PM)
  }],
  ['the hook hands a worker its messages after a tool, once, and holds it back at stop', async () => {
    callTeamTool(PM, 'tell_agent', { to: 'Researcher', message: 'Look at the 2025 figures too.' }, book, host)
    const after = JSON.parse(await runHook('post', RESEARCHER))
    assert.equal(after.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.match(after.hookSpecificOutput.additionalContext, /PM says: Look at the 2025 figures too\./)
    assert.equal(await runHook('post', RESEARCHER), '', 'handed over once')
    callTeamTool(BUILDER, 'ask_agent', { to: 'Researcher', question: 'Which file has the totals?' }, book, host)
    const stop = JSON.parse(await runHook('stop', RESEARCHER))
    assert.equal(stop.decision, 'block')
    assert.match(stop.reason, /Builder \(on Shellter\) asks you \(question [0-9a-f]{8}\)/)
    assert.equal(await runHook('stop', 'not-a-run'), '', 'nothing for a session with no messages')
  }],
  ['a worker\'s ask_agent over MCP waits for the answer and returns it', async () => {
    const child = spawn(process.execPath, [helperScript], { env: { ...process.env, GROVE_TEAM_RUN: BUILDER }, stdio: ['pipe', 'pipe', 'inherit'] })
    const lines: Record<string, any>[] = []
    readline.createInterface({ input: child.stdout! }).on('line', (line) => lines.push(JSON.parse(line)))
    const send = (m: Record<string, unknown>) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
    const reply = async (id: number) => {
      for (let i = 0; i < 100; i++) {
        const found = lines.find((m) => m.id === id)
        if (found) return found
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('no reply')
    }
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    const init = await reply(1)
    assert.equal(init.result.capabilities.experimental, undefined, 'a worker\'s helper is not a channel')
    send({ id: 2, method: 'tools/list' })
    const names = (await reply(2)).result.tools.map((t: { name: string }) => t.name)
    assert.deepEqual(names.sort(), ['answer_agent', 'ask_agent', 'team_roster', 'tell_agent'])
    send({ id: 3, method: 'tools/call', params: { name: 'ask_agent', arguments: { to: 'pm', question: 'May I delete the old fixtures?' } } })
    // PM answers a moment later, as it would through its channel.
    for (let i = 0; i < 50 && !book.recent().some((m) => m.text === 'May I delete the old fixtures?'); i++) await new Promise((r) => setTimeout(r, 100))
    const ask = book.recent().find((m) => m.text === 'May I delete the old fixtures?')!
    assert.equal(ask.to, PM)
    setTimeout(() => callTeamTool(PM, 'answer_agent', { ask_id: ask.id, answer: 'Yes, but keep the README.' }, book, host), 600)
    const answered = await reply(3)
    child.kill()
    assert.equal(answered.result.isError, false)
    assert.equal(answered.result.content[0].text, 'Answer: Yes, but keep the README.')
    assert.ok(!(await runHook('post', BUILDER)).includes('keep the README'), 'an answer the worker waited for is not handed over twice')
  }],
  ['pulses place PM at the tree and workers at their stones', async () => {
    const pulses = book.pulses((m) => (m === PM ? null : runs.find((r) => r.id === m)?.stoneId ?? null))
    assert.ok(pulses.some((p) => p.from === '/p/shellter' && p.to === null))
    assert.ok(pulses.some((p) => p.from === '/p/shellter' && p.to === '/p/data'))
  }],
  ['a worker\'s team files: its tools and two hooks, for that run only, readable by you only', async () => {
    const files = await writeTeamFiles(BUILDER, { command: '/usr/local/bin/node', args: ["/Apps/Grove's/grove-channel.js"] })
    const mcp = JSON.parse(await fsp.readFile(files.mcpConfig, 'utf8'))
    assert.equal(mcp.mcpServers.grove.env.GROVE_TEAM_RUN, BUILDER)
    const settings = JSON.parse(await fsp.readFile(files.settings, 'utf8'))
    const post = settings.hooks.PostToolUse[0].hooks[0].command as string
    assert.match(post, /'\/Apps\/Grove'\\''s\/grove-channel\.js' --hook post$/)
    assert.equal((await fsp.stat(files.settings)).mode & 0o777, 0o600)
    await assert.rejects(writeTeamFiles('../escape', { command: 'x', args: [] }))
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
await bridge.close()
await fsp.rm(scratch, { recursive: true, force: true })
if (failed) {
  console.log(`\n${failed} of ${cases.length} team checks failed.`)
  process.exit(1)
}
console.log(`\nAll ${cases.length} team checks hold.`)
process.exit(0)
