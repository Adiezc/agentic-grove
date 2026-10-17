/**
 * PM's Grove actions, checked case by case. Run with `npm run verify:actions`.
 *
 * Against a disposable grove (`AGENTIC_GROVE_HOME`), never yours, with a stand-in for the app: made
 * up sessions for the scan, a list of runs, and a launcher that records what it was asked. Covers
 * free against ask, both answers to a proposal, temporary agents going by themselves, the advice
 * thresholds, and arguments that must be refused.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Session } from '../core/harnesses/types.ts'
import type { Run } from '../core/spawn/runs.ts'
import type { DerivedGrove } from '../core/state/stones.ts'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-actions-'))
process.env.AGENTIC_GROVE_HOME = home
const { addProject, loadGrove } = await import('../core/state/grove.ts')
const { deriveStones } = await import('../core/state/stones.ts')
const { setActionHost } = await import('../core/actions/host.ts')
const { PM_ACTIONS, callAction } = await import('../core/actions/registry.ts')
const { decide, listProposals, onProposals, pendingProposals, proposalsPath, waitForDecision } = await import('../core/actions/proposals.ts')
const { ADVICE_THRESHOLDS, groveAdvice } = await import('../core/actions/advice.ts')
const { sweepTemporaryAgents, toGo } = await import('../core/actions/temporary.ts')
const { validate } = await import('../core/actions/validate.ts')

const NOW = Date.parse('2026-10-17T12:00:00Z')
const HOUR = 3_600_000

/* ---- The stand-in app ---- */

let sessions: Session[] = []
let runs: Run[] = []
let derived: DerivedGrove | null = null
const launched: { stoneId: string; agentId: string; task: string }[] = []
const refresh = async () => {
  derived = deriveStones(sessions, (await loadGrove()).grove, NOW)
}
setActionHost({
  derived: () => derived,
  runs: () => runs,
  launchRun: async (request) => {
    launched.push(request)
    return { ok: true, runId: `run-${launched.length}` }
  },
  changed: refresh,
})

let counter = 0
function session(cwd: string, at: number, opening?: string): Session {
  counter += 1
  const preview = opening ?? `one-off job ${counter}`
  return {
    id: `claude-code:s${counter}`, harness: 'claude-code', harnessName: 'Claude Code', title: preview, preview,
    project: path.basename(cwd), projectPath: cwd, worktree: '', cwd, gitBranch: '', model: '', effort: '',
    createdAt: at, lastActivityAt: at, lastFocusedAt: at, status: 'idle', statusProvenance: 'measured',
    unread: false, unreadProvenance: 'measured', sizeBytes: 1, archived: false, source: 'test', canOpen: false, ref: {},
  }
}
function run(agentId: string, state: Run['state'], extra: Partial<Run> = {}): Run {
  return { id: `r-${agentId}-${state}`, harness: 'claude-code', agentId, agentName: agentId, stoneId: project('site'), task: 't', createdAt: NOW, updatedAt: NOW, state, sessionId: '', ...extra }
}
const project = (name: string) => path.join(home, 'projects', name)
const folder = async (name: string) => {
  await fsp.mkdir(project(name), { recursive: true })
  return project(name)
}
const grove = async () => (await loadGrove()).grove

await folder('site')
await folder('shop')
await folder('work')
await folder('work/data')
await folder('work/slides')
for (const name of ['site', 'shop', 'work']) assert.ok((await addProject(project(name))).ok)
await refresh()

/* ---- The cases ---- */

const cases: [string, () => Promise<void> | void][] = [
  ['the registry lists every action once, snake_case, with a schema, a risk and a description', () => {
    const names = PM_ACTIONS.map((action) => action.name)
    for (const wanted of ['grove_status', 'list_agents', 'create_agent', 'remove_agent', 'send_agent', 'make_clearing', 'join_clearing', 'leave_clearing', 'split_stone', 'carve_rune']) {
      assert.ok(names.includes(wanted), wanted)
    }
    assert.equal(new Set(names).size, names.length)
    for (const action of PM_ACTIONS) {
      assert.match(action.name, /^[a-z]+(_[a-z]+)*$/)
      assert.equal(action.inputSchema.type, 'object')
      assert.ok(action.description.length > 40, `${action.name} needs a description PM can use`)
      assert.ok(action.risk === 'free' || action.risk === 'ask')
      // Every schema must be one the checker understands, or validation would refuse everything.
      assert.equal(validate(action.inputSchema, {}, 'probe')?.includes('does not understand') ?? false, false, action.name)
    }
    const risk = Object.fromEntries(PM_ACTIONS.map((action) => [action.name, action.risk]))
    for (const name of ['split_stone', 'carve_rune', 'make_clearing', 'create_agent', 'remove_agent']) assert.equal(risk[name], 'ask', name)
    for (const name of ['grove_status', 'list_agents', 'send_agent', 'join_clearing', 'leave_clearing']) assert.equal(risk[name], 'free', name)
  }],

  ['bad input is refused with a reason, and nothing is written', async () => {
    const before = await fsp.readFile(path.join(home, 'grove.json'), 'utf8')
    const refusals = [
      await callAction('delete_everything', {}),
      await callAction('join_clearing', { stone: 'site' }),
      await callAction('join_clearing', { stone: 'site', clearing: 'Work', extra: 1 }),
      await callAction('join_clearing', { stone: 42, clearing: 'Work' }),
      await callAction('join_clearing', { stone: 'nowhere', clearing: 'Work' }),
      await callAction('make_clearing', { stones: ['site'], name: 'Work' }),
      await callAction('create_agent', { name: '' }),
      await callAction('create_agent', { name: 'Linky', harness: 'chatgpt-dot', temporary: true }),
      await callAction('create_agent', { name: 'Old', temporary: true, hours: 100 }),
      await callAction('remove_agent', { agent: 'builder' }),
      await callAction('send_agent', { agent: 'manager', stone: 'site', task: 'x' }),
      await callAction('split_stone', { stone: 'work', part: '/etc' }),
      await callAction('split_stone', { stone: 'work', part: 'missing' }),
      await callAction('grove_status', 'not an object'),
    ]
    for (const result of refusals) {
      assert.equal(result.ok, false, result.text)
      assert.ok(result.text.length > 5 && !result.proposalId)
    }
    assert.match(refusals[1]!.text, /clearing is required/)
    assert.match(refusals[2]!.text, /extra is not a field/)
    assert.match(refusals[4]!.text, /No stone called nowhere/)
    assert.equal(await fsp.readFile(path.join(home, 'grove.json'), 'utf8'), before)
    assert.equal((await pendingProposals()).length, 0)
  }],

  ['a free action runs at once: a stone joins and leaves a clearing', async () => {
    const joined = await callAction('join_clearing', { stone: 'site', clearing: 'Web' })
    assert.ok(joined.ok && !joined.proposalId, joined.text)
    assert.equal((await grove()).stones.find((stone) => stone.path === project('site'))?.clearing, 'Web')
    assert.equal(derived?.stones.find((stone) => stone.path === project('site'))?.clearing, 'Web', 'the host was told to redraw')
    const left = await callAction('leave_clearing', { stone: project('site') })
    assert.ok(left.ok, left.text)
    assert.equal((await grove()).stones.find((stone) => stone.path === project('site'))?.clearing, undefined)
  }],

  ['an ask action makes a proposal and changes nothing; asking twice makes one card', async () => {
    const events: string[] = []
    const stop = onProposals((event) => events.push(event.kind))
    const asked = await callAction('make_clearing', { stones: ['site', 'shop'], name: 'Web', reason: 'You work on both every day.' })
    assert.ok(asked.ok && asked.proposalId, asked.text)
    assert.match(asked.text, /^Asked the person/)
    assert.ok((await grove()).stones.every((stone) => !stone.clearing), 'nothing ran')
    const again = await callAction('make_clearing', { name: 'Web', stones: ['site', 'shop'] })
    assert.equal(again.proposalId, asked.proposalId)
    const pending = await pendingProposals()
    assert.equal(pending.length, 1)
    assert.equal(pending[0]!.reason, 'You work on both every day.')
    assert.equal(pending[0]!.args.reason, undefined, 'the reason is kept apart from the arguments')
    assert.match(pending[0]!.summary, /site and shop together in a new clearing, Web/)
    assert.ok((await fsp.stat(proposalsPath())).isFile() && proposalsPath().startsWith(home))
    stop()
    assert.deepEqual(events, ['created'])
  }],

  ['yes runs the action as asked, once, and the waiter hears it', async () => {
    const [proposal] = await pendingProposals()
    const waiting = waitForDecision(proposal!.id, 5000)
    const answered = await decide(proposal!.id, 'yes', 'Good idea')
    assert.ok(answered.ok, answered.error)
    assert.equal(answered.proposal?.state, 'yes')
    assert.equal(answered.proposal?.answer, 'Good idea')
    const heard = await waiting
    assert.equal(heard?.state, 'yes')
    assert.ok(heard?.result?.ok)
    const stones = (await grove()).stones
    assert.deepEqual(stones.filter((stone) => stone.clearing === 'Web').map((stone) => path.basename(stone.path)).sort(), ['shop', 'site'])
    assert.equal((await decide(proposal!.id, 'yes')).ok, false, 'a proposal is answered once')
    assert.equal((await pendingProposals()).length, 0)
    assert.equal((await listProposals())[0]!.state, 'yes', 'answered proposals are kept as history')
  }],

  ['no runs nothing, and the turned-down suggestion is not offered again', async () => {
    // Two stones worked on in the same hours often enough to be suggested together.
    await callAction('leave_clearing', { stone: 'site' })
    await callAction('leave_clearing', { stone: 'shop' })
    sessions = [0, 1, 2, 3].flatMap((hour) => [session(project('site'), NOW - hour * HOUR - 60_000), session(project('shop'), NOW - hour * HOUR - 120_000)])
    await refresh()
    const advised = groveAdvice({ stones: derived!.stones, grove: await grove() }, NOW)
    const offer = advised.find((each) => each.kind === 'clearing')
    assert.ok(offer, 'a clearing is suggested')
    assert.match(offer!.reason, /site and shop|shop and site/)
    const asked = await callAction('make_clearing', { ...offer!.args, name: 'Pair' })
    assert.ok(asked.proposalId)
    assert.equal(groveAdvice({ stones: derived!.stones, grove: await grove() }, NOW, undefined, await pendingProposals()).filter((each) => each.kind === 'clearing').length, 0, 'not suggested while asked')
    const answered = await decide(asked.proposalId, 'no', 'Not now')
    assert.equal(answered.proposal?.state, 'no')
    assert.ok((await grove()).stones.every((stone) => !stone.clearing))
    assert.equal((await grove()).declinedClearings?.length, 1)
    assert.equal(groveAdvice({ stones: derived!.stones, grove: await grove() }, NOW).filter((each) => each.kind === 'clearing').length, 0)
  }],

  ['a wait for an answer that never comes gives up, and an unknown id resolves at once', async () => {
    const asked = await callAction('carve_rune', { stone: 'site', prompt: 'run the tests' })
    assert.ok(asked.proposalId)
    const started = Date.now()
    assert.equal(await waitForDecision(asked.proposalId, 150), null)
    assert.ok(Date.now() - started < 2000)
    assert.equal(await waitForDecision('no-such-id', 10_000), null)
    assert.ok((await grove()).stones.every((stone) => !stone.runes), 'nothing carved while waiting')
    const answered = await decide(asked.proposalId, 'yes')
    assert.ok(answered.ok && answered.proposal?.state === 'yes')
    assert.equal((await grove()).stones.find((stone) => stone.path === project('site'))?.runes?.[0]?.prompt, 'run the tests')
    assert.equal((await decide('x', 'maybe')).ok, false)
  }],

  ['a temporary agent is grown freely; a permanent one is asked for', async () => {
    const temp = await callAction('create_agent', { name: 'Linter', description: 'Checks style.', temporary: true, hours: 2 })
    assert.ok(temp.ok && !temp.proposalId, temp.text)
    const made = (await grove()).agents.find((agent) => agent.name === 'Linter')
    assert.ok(made?.temporary && made.createdBy === 'pm')
    assert.ok(Math.abs(Date.parse(made.expiresAt!) - (Date.now() + 2 * HOUR)) < 60_000)
    const permanent = await callAction('create_agent', { name: 'Reviewer', description: 'Reviews changes.', brief: 'Be thorough.' })
    assert.ok(permanent.proposalId, permanent.text)
    assert.ok(!(await grove()).agents.some((agent) => agent.name === 'Reviewer'))
    assert.match((await pendingProposals())[0]!.summary, /permanent agent, Reviewer/)
    assert.ok((await decide(permanent.proposalId, 'yes')).ok)
    const reviewer = (await grove()).agents.find((agent) => agent.name === 'Reviewer')
    assert.ok(reviewer && !reviewer.temporary && reviewer.systemPrompt === 'Be thorough.')
  }],

  ['removing a temporary agent is free; removing a permanent one asks', async () => {
    const asked = await callAction('remove_agent', { agent: 'Reviewer' })
    assert.ok(asked.proposalId)
    assert.ok((await grove()).agents.some((agent) => agent.id === 'reviewer'))
    await decide(asked.proposalId, 'no')
    assert.ok((await grove()).agents.some((agent) => agent.id === 'reviewer'), 'no keeps it')
    await callAction('create_agent', { name: 'Scratch', temporary: true })
    const gone = await callAction('remove_agent', { agent: 'scratch' })
    assert.ok(gone.ok && !gone.proposalId, gone.text)
    assert.ok(!(await grove()).agents.some((agent) => agent.id === 'scratch'))
  }],

  ['send_agent goes through the app’s launcher with ids only', async () => {
    const sent = await callAction('send_agent', { agent: 'Linter', stone: 'shop', task: 'Check the CSS' })
    assert.ok(sent.ok, sent.text)
    assert.deepEqual(launched.at(-1), { stoneId: project('shop'), agentId: 'linter', task: 'Check the CSS' })
    assert.equal((sent.data as { runId: string }).runId, `run-${launched.length}`)
  }],

  ['a temporary agent goes when its run ends or its time is up, never mid-job', async () => {
    const agents = [
      { id: 'a', name: 'a', description: '', harness: 'claude-code' as const, temporary: true as const, expiresAt: new Date(NOW + HOUR).toISOString() },
      { id: 'b', name: 'b', description: '', harness: 'claude-code' as const, temporary: true as const, expiresAt: new Date(NOW - HOUR).toISOString() },
      { id: 'c', name: 'c', description: '', harness: 'claude-code' as const, temporary: true as const, expiresAt: new Date(NOW - HOUR).toISOString() },
      { id: 'd', name: 'd', description: '', harness: 'claude-code' as const, temporary: true as const, expiresAt: new Date(NOW + HOUR).toISOString() },
      { id: 'e', name: 'e', description: '', harness: 'claude-code' as const, temporary: true as const, expiresAt: new Date(NOW + HOUR).toISOString() },
      { id: 'p', name: 'p', description: '', harness: 'claude-code' as const },
    ]
    const book = [run('a', 'ended'), run('c', 'running'), run('d', 'finished'), run('e', 'finished', { process: 'closed' }), run('p', 'ended')]
    // a: its run ended. b: expired, never sent. c: expired but working. d: finished, window open. e: finished, window closed.
    assert.deepEqual(toGo(agents, book, NOW).sort(), ['a', 'b', 'e'])

    runs = [run('linter', 'running')]
    assert.deepEqual(await sweepTemporaryAgents(runs), [], 'kept while working')
    assert.ok((await grove()).agents.some((agent) => agent.id === 'linter'))
    runs = [run('linter', 'ended')]
    assert.deepEqual(await sweepTemporaryAgents(runs), ['linter'])
    assert.ok(!(await grove()).agents.some((agent) => agent.id === 'linter'))
    assert.ok((await grove()).agents.some((agent) => agent.id === 'reviewer'), 'a permanent agent never goes by itself')
    runs = []
  }],

  ['the advice thresholds decide when a split and a saved task are suggested', async () => {
    // Work's sessions spread over two parts, five each, plus the same opening prompt three times.
    sessions = [
      ...[1, 2, 3, 4, 5].map((n) => session(project('work/data'), NOW - n * 24 * HOUR)),
      ...[1, 2, 3, 4, 5].map((n) => session(project('work/slides'), NOW - n * 24 * HOUR - 1000)),
      ...[1, 2, 3].map((n) => session(project('shop'), NOW - n * 30 * HOUR, 'Write the weekly summary.')),
    ]
    await refresh()
    const state = { stones: derived!.stones, grove: await grove() }
    const advice = groveAdvice(state, NOW)
    const splits = advice.filter((each) => each.kind === 'split')
    assert.equal(splits.length, 2)
    assert.deepEqual(splits.map((each) => path.basename(each.args.part as string)).sort(), ['data', 'slides'])
    assert.match(splits[0]!.reason, /5 of the 10 sessions on work/)
    const rune = advice.find((each) => each.kind === 'rune')
    assert.equal(rune?.args.prompt, 'Write the weekly summary.')
    assert.match(rune!.reason, /3 sessions on shop/)

    const stricter = structuredClone(ADVICE_THRESHOLDS)
    stricter.split.minSessions = 6
    stricter.rune.repeats = 4
    assert.equal(groveAdvice(state, NOW, stricter).filter((each) => each.kind !== 'clearing').length, 0, 'raising the numbers stops the suggestions')
    const looser = structuredClone(ADVICE_THRESHOLDS)
    looser.split.minParts = 1
    looser.split.minSessions = 5
    looser.perKind = 1
    assert.equal(groveAdvice(state, NOW, looser).filter((each) => each.kind === 'split').length, 1, 'perKind caps each kind')
  }],

  ['split_stone asks; yes makes the sub-stone, no is remembered and not suggested again', async () => {
    const asked = await callAction('split_stone', { stone: 'work', part: 'data', reason: 'Half the work is here.' })
    assert.ok(asked.proposalId, asked.text)
    assert.ok(!(await grove()).stones.some((stone) => stone.path === project('work/data')))
    assert.ok((await decide(asked.proposalId, 'yes')).ok)
    assert.ok((await grove()).stones.some((stone) => stone.path === project('work/data')))
    await refresh()
    assert.equal(derived!.stones.find((stone) => stone.path === project('work/data'))?.parent, project('work'))

    const second = await callAction('split_stone', { stone: 'work', part: project('work/slides') })
    assert.ok(second.proposalId)
    await decide(second.proposalId, 'no')
    assert.deepEqual((await grove()).stones.find((stone) => stone.path === project('work'))?.declinedSplits, [project('work/slides')])
    await refresh()
    const looser = structuredClone(ADVICE_THRESHOLDS)
    looser.split.minParts = 1
    assert.equal(groveAdvice({ stones: derived!.stones, grove: await grove() }, NOW, looser).filter((each) => each.kind === 'split').length, 0)
  }],

  ['a yes is checked again: if the grove changed meanwhile, it fails with a reason', async () => {
    const asked = await callAction('make_clearing', { stones: ['site', 'shop'], name: 'Later' })
    assert.ok(asked.proposalId)
    await callAction('join_clearing', { stone: 'site', clearing: 'Elsewhere' })
    const answered = await decide(asked.proposalId, 'yes')
    assert.ok(answered.ok)
    assert.equal(answered.proposal?.state, 'failed')
    assert.match(answered.proposal!.result!.text, /already in the clearing Elsewhere/)
  }],

  ['grove_status tells PM everything in one call', async () => {
    await callAction('create_agent', { name: 'Helper', temporary: true })
    await callAction('carve_rune', { stone: 'shop', prompt: 'Write the weekly summary.' })
    runs = [run('builder', 'running')]
    const status = await callAction('grove_status', {})
    assert.ok(status.ok)
    const data = status.data as Record<string, { name?: string; kind?: string }[]>
    assert.ok(data.stones!.some((stone) => stone.name === 'work'))
    assert.ok(data.agents!.some((agent) => agent.name === 'Helper' && agent.kind === 'temporary'))
    assert.ok(data.agents!.some((agent) => agent.name === 'PM' && agent.kind === 'built-in'))
    assert.equal(data.runs!.length, 1)
    assert.equal(data.waitingForThePerson!.length, 1)
    assert.ok(data.clearings!.some((clearing) => clearing.name === 'Elsewhere'))
    assert.ok(!data.suggestions!.some((each) => (each as { kind?: string }).kind === 'rune'), 'a suggestion already asked about is left out')
    assert.match(status.text, /1 question waiting/)
    runs = []
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }
}
await fsp.rm(home, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} action checks hold.`)
