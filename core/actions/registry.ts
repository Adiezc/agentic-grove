/**
 * PM's Grove actions: everything PM can do to the grove, listed once.
 *
 * This is the seam the channel server uses. It reads `PM_ACTIONS` and offers each as an MCP tool
 * (name, description, input schema), and when PM calls one it calls `callAction` and hands the
 * result back. Nothing here knows about MCP, and the app itself never calls a model: PM is a real
 * Claude Code session on your own plan, and these are only the hands it is given.
 *
 * **Two kinds of action**, decided with Adrian on 16 and 17 October 2026:
 *
 *   free  PM does it and says so: looking at the grove, sending an agent to work, growing or
 *         removing a *temporary* agent, moving one stone into or out of a clearing. Small, and
 *         undone as easily as done.
 *   ask   PM asks you first: a *permanent* agent added or removed, a new clearing, a stone split
 *         into sub-stones, a saved task carved. `callAction` does not run these. It writes a
 *         proposal (`proposals.ts`), the Grove shows it as a card, and only your Yes runs it.
 *
 * `create_agent` and `remove_agent` are free for a temporary agent and ask for a permanent one, so
 * their `risk` says `ask`, the most they can need, and `askIf` decides each call.
 *
 * **Every argument is checked twice**: against the action's schema (`validate.ts`), and then
 * against the grove as it is (`check`), so a proposal is never made for something that cannot be
 * done, and PM hears why in a sentence it can act on.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { addAgent, addProject, carveRune, declineClearing, declineRune, declineSplit, joinClearing, leaveClearing, loadGrove, makeClearing, removeAgent, MAX_RUNE_PROMPT_CHARS } from '../state/grove.ts'
import { AGENT_GLYPHS, BUILT_IN_AGENT_IDS, MAX_BRIEF_CHARS, isLinkOnly, type AgentDefinition, type GroveFile } from '../state/schema.ts'
import { MAX_CLEARING_NAME, clearingKey, clearingsOf } from '../state/clearings.ts'
import { deriveStones, type DerivedGrove, type Runestone } from '../state/stones.ts'
import { BUILT_IN_NAMES, PM_ID } from '../spawn/briefs.ts'
import type { Run } from '../spawn/runs.ts'
import { isModelName } from '../models.ts'
import { validate } from './validate.ts'
import { host } from './host.ts'
import { MAX_TEMPORARY_AGENTS, MAX_TEMPORARY_AGENT_HOURS, TEMPORARY_AGENT_HOURS, isLive, sweepTemporaryAgents } from './temporary.ts'
import { createProposal, pendingProposals, setProposalRunner } from './proposals.ts'
import { groveAdvice } from './advice.ts'

export interface ActionResult {
  ok: boolean
  /** One or two sentences for PM. */
  text: string
  data?: unknown
  proposalId?: string
}

export interface PmAction {
  /** snake_case, e.g. make_clearing */
  name: string
  title: string
  /** Written for PM: when to use it. */
  description: string
  /** A JSON Schema object. */
  inputSchema: Record<string, unknown>
  risk: 'free' | 'ask'
  run(args: unknown): Promise<ActionResult>
}

/** An action as defined here: the public shape, plus how it is checked, asked about and declined. */
interface Defined extends PmAction {
  /** For an `ask` action that is sometimes free: true when this call needs your yes. */
  askIf?(args: Args, grove: GroveFile): boolean
  /** Can it be done at all, against the grove as it is? A sentence when not. */
  check?(args: Args, view: View): Promise<string | null> | string | null
  /** What it would do, in plain words, for the proposal card. */
  plain?(args: Args, view: View): string
  /** You said no: remember it so the same suggestion is not made again. */
  declined?(args: Args, view: View): Promise<void>
}

type Args = Record<string, unknown>

/** The grove as an action sees it: the file, the derived stones, and the runs. */
interface View {
  grove: GroveFile
  derived: DerivedGrove
  runs: Run[]
}

async function view(): Promise<View> {
  const { grove } = await loadGrove()
  const derived = host().derived() ?? deriveStones([], grove)
  return { grove, derived, runs: host().runs() }
}

/* -------------------------------------------------------------------------------------------
 * Finding things by what PM calls them
 * ---------------------------------------------------------------------------------------- */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A stone by its path, or by its name when only one stone has it. */
function findStone(ref: unknown, stones: Runestone[]): Runestone | string {
  const wanted = text(ref)
  if (!wanted) return 'Say which stone, by its name or its folder.'
  const exact = stones.find((stone) => stone.path === wanted)
  if (exact) return exact
  const named = stones.filter((stone) => stone.name.toLowerCase() === wanted.toLowerCase())
  if (named.length === 1) return named[0]!
  if (named.length > 1) return `Two stones are called ${wanted}; use the folder path instead (${named.map((stone) => stone.path).join(', ')}).`
  const names = stones.map((stone) => stone.name)
  return `No stone called ${wanted}.${names.length ? ` The stones are: ${names.join(', ')}.` : ' The grove has no stones yet.'}`
}

const builtInDefinitions = (): { id: string; name: string }[] => BUILT_IN_AGENT_IDS.map((id) => ({ id, name: BUILT_IN_NAMES[id] ?? id }))

/** An agent by its id, or by its name when only one has it. Built-ins included. */
function findAgent(ref: unknown, grove: GroveFile): { id: string; name: string; own?: AgentDefinition } | string {
  const wanted = text(ref)
  if (!wanted) return 'Say which agent, by its id or its name.'
  const all = [...builtInDefinitions(), ...grove.agents.map((agent) => ({ id: agent.id, name: agent.name, own: agent }))]
  const exact = all.find((agent) => agent.id === wanted)
  if (exact) return exact
  const named = all.filter((agent) => agent.name.toLowerCase() === wanted.toLowerCase())
  if (named.length === 1) return named[0]!
  if (named.length > 1) return `Two agents are called ${wanted}; use the id instead (${named.map((agent) => agent.id).join(', ')}).`
  return `No agent called ${wanted}. The agents are: ${all.map((agent) => `${agent.name} (${agent.id})`).join(', ')}.`
}

const stoneOrThrow = (ref: unknown, v: View): Runestone => {
  const found = findStone(ref, v.derived.stones)
  if (typeof found === 'string') throw new Refusal(found)
  return found
}

class Refusal extends Error {}

const failed = (result: { ok: boolean; error?: string }, done: string): ActionResult =>
  result.ok ? { ok: true, text: done } : { ok: false, text: result.error ?? 'That did not work.' }

/** After any change to grove.json: let the window follow. */
async function changed(): Promise<void> {
  await host().changed()
}

/** The part of a stone to split off, as an absolute folder: a path, or a folder name inside the stone. */
function partPath(stone: Runestone, part: unknown): string {
  const given = text(part)
  return path.isAbsolute(given) ? path.resolve(given) : path.resolve(stone.path, given)
}

/* -------------------------------------------------------------------------------------------
 * What PM is told about the grove
 * ---------------------------------------------------------------------------------------- */

const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null)
const gist = (task: string) => {
  const line = task.replace(/\s+/g, ' ').trim()
  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

function agentRows(grove: GroveFile, runs: Run[]) {
  const busy = new Set(runs.filter(isLive).map((run) => run.agentId))
  return [
    ...builtInDefinitions().map((agent) => ({ id: agent.id, name: agent.name, kind: 'built-in', harness: 'chosen per job', working: busy.has(agent.id) })),
    ...grove.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      kind: agent.temporary ? 'temporary' : 'permanent',
      harness: agent.harness,
      description: agent.description || undefined,
      model: agent.model || undefined,
      expiresAt: agent.temporary ? agent.expiresAt : undefined,
      canBeSent: !isLinkOnly(agent.harness),
      working: busy.has(agent.id),
    })),
  ]
}

const runRows = (runs: Run[], derived: DerivedGrove) =>
  runs.filter((run) => run.state === 'starting' || run.state === 'running' || run.state === 'waiting').map((run) => ({
    id: run.id,
    agent: run.agentName,
    stone: derived.stones.find((stone) => stone.id === run.stoneId)?.name ?? path.basename(run.stoneId),
    state: run.state === 'waiting' ? 'needs the person' : run.state,
    task: gist(run.task),
    startedAt: iso(run.createdAt),
  }))

/* -------------------------------------------------------------------------------------------
 * The actions
 * ---------------------------------------------------------------------------------------- */

const TOOL_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', 'chatgpt-dot': 'ChatGPT', 'claude-cowork': 'Claude Cowork' }

const STONE = { type: 'string', minLength: 1, maxLength: 1000, description: 'The stone, by its name or its folder path.' }
const REASON = { type: 'string', maxLength: 600, description: 'Why, in a sentence the person will read on the card.' }

const ACTIONS: Defined[] = [
  {
    name: 'grove_status',
    title: 'Look at the grove',
    description:
      'See the whole grove: every stone and what is happening on it, the clearings, every agent (built-in, permanent and temporary), the runs working now, the questions waiting for the person, and what you could suggest growing (with a reason each). Call it first in a conversation, and again before suggesting anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'free',
    async run() {
      const swept = await sweepTemporaryAgents(host().runs())
      if (swept.length) await changed()
      const v = await view()
      const pending = await pendingProposals()
      const tops = v.derived.stones.filter((stone) => !stone.parent)
      const data = {
        stones: v.derived.stones.map((stone) => ({
          name: stone.name,
          path: stone.path,
          status: stone.status === 'waiting' ? 'needs the person' : stone.status,
          running: stone.runningCount,
          needsYou: stone.attentionCount,
          lastActivityAt: iso(stone.lastActivityAt),
          clearing: stone.clearing,
          partOf: stone.parent ? v.derived.stones.find((other) => other.id === stone.parent)?.name ?? stone.parent : undefined,
          savedTasks: stone.runes.map((rune) => rune.name),
        })),
        clearings: clearingsOf(tops.map((stone) => ({ id: stone.id, clearing: stone.clearing, place: stone.place }))).map((clearing) => ({
          name: clearing.name,
          stones: clearing.members.map((id) => tops.find((stone) => stone.id === id)?.name ?? id),
        })),
        agents: agentRows(v.grove, v.runs),
        runs: runRows(v.runs, v.derived),
        waitingForThePerson: pending.map((proposal) => ({ id: proposal.id, action: proposal.action, summary: proposal.summary, askedAt: proposal.createdAt })),
        suggestions: groveAdvice({ stones: v.derived.stones, grove: v.grove }, Date.now(), undefined, pending),
      }
      const working = data.runs.length
      const text =
        `${data.stones.length} ${data.stones.length === 1 ? 'stone' : 'stones'}, ${data.agents.length} agents, ${working} ${working === 1 ? 'run' : 'runs'} working` +
        `${pending.length ? `, ${pending.length} ${pending.length === 1 ? 'question' : 'questions'} waiting for the person` : ''}` +
        `${data.suggestions.length ? `, ${data.suggestions.length} ${data.suggestions.length === 1 ? 'thing' : 'things'} you could suggest` : ''}.`
      return { ok: true, text, data }
    },
  },

  {
    name: 'list_agents',
    title: 'List the agents',
    description: 'List every agent on the tree: the built-in three (PM, Researcher, Builder), the person’s own, and any temporary ones you grew, with whether each is working now. Use it before sending or creating an agent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'free',
    async run() {
      const v = await view()
      const rows = agentRows(v.grove, v.runs)
      return { ok: true, text: rows.map((agent) => `${agent.name} (${agent.id}, ${agent.kind}${agent.working ? ', working' : ''})`).join('; ') + '.', data: rows }
    },
  },

  {
    name: 'create_agent',
    title: 'Grow an agent',
    description:
      'Grow an agent on the tree. With temporary: true it is yours for one job: it is grown at once and goes by itself when its run ends or after `hours` (default 4, at most 24); use this when a job needs a specialist the tree does not have. Without it, the agent is permanent, and the person is asked first. Give it a short name, a one-line description and a brief saying how it should work.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 40, description: 'What it is called on the tree, like "Reviewer".' },
        description: { type: 'string', maxLength: 120, description: 'One line: what it does.' },
        brief: { type: 'string', maxLength: MAX_BRIEF_CHARS, description: 'How it should work. Sent ahead of every job it is given.' },
        harness: { type: 'string', enum: ['claude-code', 'codex', 'chatgpt-dot', 'claude-cowork'], description: 'Which tool runs it. Default claude-code. Only claude-code and codex can be sent to a stone, and only they can be temporary.' },
        model: { type: 'string', maxLength: 80, description: 'A model name for its tool, like "sonnet". Leave out for the tool’s default.' },
        glyph: { type: 'string', enum: [...AGENT_GLYPHS], description: 'The face on its orb.' },
        temporary: { type: 'boolean', description: 'True for an agent for this job only, grown without asking.' },
        hours: { type: 'number', minimum: 0.25, maximum: MAX_TEMPORARY_AGENT_HOURS, description: 'Temporary agents only: how long it may stay if nothing keeps it.' },
        reason: REASON,
      },
      required: ['name'],
      additionalProperties: false,
    },
    risk: 'ask',
    askIf: (args) => args.temporary !== true,
    check(args, v) {
      const harness = text(args.harness) || 'claude-code'
      if (args.temporary === true && isLinkOnly(harness as never)) return 'Only a Claude Code or Codex agent can be temporary.'
      if (args.temporary !== true && args.hours !== undefined) return '`hours` is only for a temporary agent.'
      if (args.model !== undefined && !isModelName(text(args.model))) return `"${text(args.model).slice(0, 40)}" is not a model name.`
      if (args.temporary === true && v.grove.agents.filter((agent) => agent.temporary).length >= MAX_TEMPORARY_AGENTS) {
        return `There are already ${MAX_TEMPORARY_AGENTS} temporary agents; remove one you are done with first.`
      }
      return null
    },
    plain: (args) => {
      const line = text(args.description).replace(/[.!]+$/, '')
      const tool = TOOL_NAMES[text(args.harness) || 'claude-code'] ?? text(args.harness)
      return `Add a permanent agent, ${text(args.name)}${line ? ` (${line.charAt(0).toLowerCase()}${line.slice(1)})` : ''}, on ${tool}`
    },
    async run(raw) {
      const args = raw as Args
      const temporary = args.temporary === true
      const hours = typeof args.hours === 'number' ? args.hours : TEMPORARY_AGENT_HOURS
      const result = await addAgent(
        { name: text(args.name), description: text(args.description), harness: text(args.harness) || 'claude-code', brief: text(args.brief), model: text(args.model), glyph: text(args.glyph) || undefined },
        temporary ? { temporaryUntil: Date.now() + hours * 3_600_000 } : {}
      )
      if (!result.ok) return { ok: false, text: result.error ?? 'The agent could not be grown.' }
      await changed()
      return {
        ok: true,
        text: temporary
          ? `Grew ${text(args.name)} (${result.id}) for this job; it goes by itself when its run ends or in ${hours} hours.`
          : `Added ${text(args.name)} (${result.id}) to the tree for good.`,
        data: { id: result.id },
      }
    },
  },

  {
    name: 'remove_agent',
    title: 'Remove an agent',
    description: 'Take an agent off the tree. A temporary agent you grew is removed at once; removing one of the person’s permanent agents asks them first. The built-in three cannot be removed. Its runs and saved tasks stay.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string', minLength: 1, maxLength: 80, description: 'Its id or name.' }, reason: REASON },
      required: ['agent'],
      additionalProperties: false,
    },
    risk: 'ask',
    askIf: (args, grove) => !grove.agents.find((agent) => agent.id === text(args.agent) || agent.name.toLowerCase() === text(args.agent).toLowerCase())?.temporary,
    check(args, v) {
      const found = findAgent(args.agent, v.grove)
      if (typeof found === 'string') return found
      if (!found.own) return `${found.name} is built into the Grove and cannot be removed.`
      if (found.own.temporary && v.runs.some((run) => run.agentId === found.id && isLive(run))) return `${found.name} is still working; it goes by itself when its run ends.`
      return null
    },
    plain: (args, v) => {
      const found = findAgent(args.agent, v.grove)
      return typeof found === 'string' ? `Remove the agent ${text(args.agent)}` : `Remove ${found.name} from the tree for good`
    },
    async run(raw) {
      const v = await view()
      const found = findAgent((raw as Args).agent, v.grove)
      if (typeof found === 'string') return { ok: false, text: found }
      const result = await removeAgent(found.id)
      if (result.ok) await changed()
      return failed(result, `Removed ${found.name} from the tree.`)
    },
  },

  {
    name: 'send_agent',
    title: 'Send an agent to a stone',
    description:
      'Start a job: send an agent to a stone with a task. A Terminal window opens in that project running the agent on the person’s own Claude Code or Codex, and its progress shows on the stone. Use it for Researcher, Builder, the person’s own agents or a temporary one you grew. Workers edit freely and run safe commands, and stop to ask before deleting, pushing, installing, sending or spending.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', minLength: 1, maxLength: 80, description: 'Its id or name, like "builder".' },
        stone: STONE,
        task: { type: 'string', minLength: 1, maxLength: 20_000, description: 'What to do, in full: the agent starts with only this and its brief.' },
        model: { type: 'string', maxLength: 80, description: 'A model for this one job. Leave out and the Grove picks one from the kind of job and the person’s settings.' },
        effort: { type: 'string', maxLength: 10, description: 'low, medium, high, xhigh or max. Leave out and the Grove picks one.' },
        person_ok: { type: 'boolean', description: 'True only when the person already said yes to this model and effort in the chat.' },
        reason: REASON,
      },
      required: ['agent', 'stone', 'task'],
      additionalProperties: false,
    },
    risk: 'free',
    check(args, v) {
      const agent = findAgent(args.agent, v.grove)
      if (typeof agent === 'string') return agent
      if (agent.id === PM_ID) return 'You are PM; send one of the workers instead.'
      if (agent.own && isLinkOnly(agent.own.harness)) return `${agent.name} lives in its own app and cannot be sent to a stone.`
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return stone
      if (args.model !== undefined && !isModelName(text(args.model))) return `"${text(args.model).slice(0, 40)}" is not a model name.`
      return null
    },
    async run(raw) {
      const args = raw as Args
      const v = await view()
      const agent = findAgent(args.agent, v.grove)
      if (typeof agent === 'string') return { ok: false, text: agent }
      const stone = stoneOrThrow(args.stone, v)
      const result = await host().launchRun({ stoneId: stone.path, agentId: agent.id, task: text(args.task), ...(args.model !== undefined ? { model: text(args.model) } : {}), ...(args.effort !== undefined ? { effort: text(args.effort) } : {}) })
      if (!result.ok) return { ok: false, text: result.error ?? 'It could not be started.', data: { runId: result.runId } }
      return { ok: true, text: `Sent ${agent.name} to ${stone.name}; a Terminal window is opening there. Its run id is ${result.runId}.`, data: { runId: result.runId } }
    },
  },

  {
    name: 'make_clearing',
    title: 'Make a clearing',
    description:
      'Suggest a new clearing: two to six stones that belong together (work, side projects, experiments) standing together inside one ring. The person is asked first. Suggest one when grove_status lists a clearing suggestion, or when the person asks; propose a short name like "Work".',
    inputSchema: {
      type: 'object',
      properties: {
        stones: { type: 'array', minItems: 2, maxItems: 6, items: STONE, description: 'The stones, by name or path.' },
        name: { type: 'string', minLength: 1, maxLength: MAX_CLEARING_NAME, description: 'The clearing’s name.' },
        reason: REASON,
      },
      required: ['stones', 'name'],
      additionalProperties: false,
    },
    risk: 'ask',
    check(args, v) {
      const stones = (args.stones as unknown[]).map((ref) => findStone(ref, v.derived.stones))
      const missing = stones.find((stone) => typeof stone === 'string')
      if (missing) return missing as string
      const found = stones as Runestone[]
      if (new Set(found.map((stone) => stone.path)).size !== found.length) return 'The same stone is listed twice.'
      const sub = found.find((stone) => stone.parent)
      if (sub) return `${sub.name} stands off another stone, so it cannot be in a clearing of its own.`
      const inOne = found.find((stone) => stone.clearing)
      if (inOne) return `${inOne.name} is already in the clearing ${inOne.clearing}; use join_clearing to add stones to it.`
      if (v.derived.stones.some((stone) => stone.clearing && clearingKey(stone.clearing) === clearingKey(text(args.name)))) return `There is already a clearing called ${text(args.name)}; use join_clearing.`
      return null
    },
    plain: (args, v) => {
      const names = (args.stones as unknown[]).map((ref) => {
        const found = findStone(ref, v.derived.stones)
        return typeof found === 'string' ? text(ref) : found.name
      })
      return `Put ${names.slice(0, -1).join(', ')} and ${names.at(-1)} together in a new clearing, ${text(args.name)}`
    },
    async declined(args, v) {
      const paths = (args.stones as unknown[]).flatMap((ref) => {
        const found = findStone(ref, v.derived.stones)
        return typeof found === 'string' ? [] : [found.path]
      })
      if (paths.length >= 2) await declineClearing(paths)
    },
    async run(raw) {
      const args = raw as Args
      const v = await view()
      const stones = (args.stones as unknown[]).map((ref) => stoneOrThrow(ref, v))
      const result = await makeClearing(stones.map((stone) => stone.path), text(args.name))
      if (result.ok) await changed()
      return failed(result, `Made the clearing ${text(args.name)} with ${stones.map((stone) => stone.name).join(', ')}.`)
    },
  },

  {
    name: 'join_clearing',
    title: 'Move a stone into a clearing',
    description: 'Move one stone into a clearing, an existing one or a new one by that name. Use it when the person asks to put a stone in a clearing. Undone with leave_clearing.',
    inputSchema: {
      type: 'object',
      properties: { stone: STONE, clearing: { type: 'string', minLength: 1, maxLength: MAX_CLEARING_NAME, description: 'The clearing’s name.' }, reason: REASON },
      required: ['stone', 'clearing'],
      additionalProperties: false,
    },
    risk: 'free',
    check(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return stone
      if (stone.parent) return `${stone.name} stands off another stone, so it cannot be in a clearing of its own.`
      return null
    },
    async run(raw) {
      const args = raw as Args
      const stone = stoneOrThrow(args.stone, await view())
      const result = await joinClearing(stone.path, text(args.clearing))
      if (result.ok) await changed()
      return failed(result, `${stone.name} now stands in the clearing ${text(args.clearing)}.`)
    },
  },

  {
    name: 'leave_clearing',
    title: 'Take a stone out of its clearing',
    description: 'Take one stone out of its clearing; it goes back to a circle of its own. Use it when the person asks.',
    inputSchema: { type: 'object', properties: { stone: STONE, reason: REASON }, required: ['stone'], additionalProperties: false },
    risk: 'free',
    check(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return stone
      if (!stone.clearing) return `${stone.name} is not in a clearing.`
      return null
    },
    async run(raw) {
      const stone = stoneOrThrow((raw as Args).stone, await view())
      const result = await leaveClearing(stone.path)
      if (result.ok) await changed()
      return failed(result, `${stone.name} stands on its own again.`)
    },
  },

  {
    name: 'split_stone',
    title: 'Split a stone',
    description:
      'Suggest giving part of a project, a subfolder or a git worktree, a stone of its own, standing off its parent. The person is asked first. Suggest it when grove_status lists a split suggestion, or when the person asks. The folder and its files are not touched.',
    inputSchema: {
      type: 'object',
      properties: {
        stone: STONE,
        part: { type: 'string', minLength: 1, maxLength: 1000, description: 'The part: its folder path, or a subfolder name inside the stone.' },
        reason: REASON,
      },
      required: ['stone', 'part'],
      additionalProperties: false,
    },
    risk: 'ask',
    async check(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return stone
      const part = partPath(stone, args.part)
      const offered = stone.splits.some((split) => split.path === part)
      if (!offered && !part.startsWith(stone.path + path.sep)) return `The part must be a folder inside ${stone.name} (${stone.path}).`
      if (v.grove.stones.some((each) => each.path === part)) return `${path.basename(part)} already has a stone.`
      const stat = await fsp.stat(part).catch(() => null)
      if (!stat?.isDirectory()) return `There is no folder at ${part}.`
      return null
    },
    plain: (args, v) => {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return `Give ${text(args.part)} a stone of its own`
      return `Give ${path.basename(partPath(stone, args.part))} its own stone, inside ${stone.name}`
    },
    async declined(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone !== 'string') await declineSplit(stone.path, partPath(stone, args.part))
    },
    async run(raw) {
      const args = raw as Args
      const stone = stoneOrThrow(args.stone, await view())
      const part = partPath(stone, args.part)
      const result = await addProject(part)
      if (result.ok) await changed()
      return failed(result, `${path.basename(part)} now has its own stone, inside ${stone.name}.`)
    },
  },

  {
    name: 'carve_rune',
    title: 'Save a task on a stone',
    description:
      'Suggest saving a job the person does again and again as a rune on a stone, so it is one click next time. The person is asked first. Suggest it when grove_status lists a rune suggestion, or when the person says they will want this again. Leave out `agent` to have you (PM) pick who does it each time.',
    inputSchema: {
      type: 'object',
      properties: {
        stone: STONE,
        prompt: { type: 'string', minLength: 1, maxLength: MAX_RUNE_PROMPT_CHARS, description: 'The task, as it should be run each time.' },
        agent: { type: 'string', maxLength: 80, description: 'Who runs it, by id or name. Leave out for PM to choose.' },
        reason: REASON,
      },
      required: ['stone', 'prompt'],
      additionalProperties: false,
    },
    risk: 'ask',
    check(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone === 'string') return stone
      if (text(args.agent)) {
        const agent = findAgent(args.agent, v.grove)
        if (typeof agent === 'string') return agent
        if (agent.own?.temporary) return `${agent.name} is temporary and will be gone; save it for a permanent agent, or leave the agent out.`
      }
      return null
    },
    plain: (args, v) => {
      const stone = findStone(args.stone, v.derived.stones)
      const task = gist(text(args.prompt))
      return `Save “${task}” as a task on ${typeof stone === 'string' ? text(args.stone) : stone.name}`
    },
    async declined(args, v) {
      const stone = findStone(args.stone, v.derived.stones)
      if (typeof stone !== 'string') await declineRune(stone.path, text(args.prompt))
    },
    async run(raw) {
      const args = raw as Args
      const v = await view()
      const stone = stoneOrThrow(args.stone, v)
      const agent = text(args.agent) ? findAgent(args.agent, v.grove) : null
      if (typeof agent === 'string') return { ok: false, text: agent }
      const result = await carveRune(stone.path, text(args.prompt), agent?.id ?? '')
      if (result.ok) await changed()
      return failed(result, `Saved it as a task on ${stone.name}.`)
    },
  },
]

/* -------------------------------------------------------------------------------------------
 * Calling one
 * ---------------------------------------------------------------------------------------- */

/** Every action PM has, in the order it is offered. */
export const PM_ACTIONS: PmAction[] = ACTIONS

const byName = new Map(ACTIONS.map((action) => [action.name, action]))

/** Validate against the schema, then against the grove. A sentence when it cannot be done. */
async function refusal(action: Defined, args: unknown, v: View): Promise<string | null> {
  const problem = validate(action.inputSchema, args ?? {})
  if (problem) return `Refused: ${problem}.`
  try {
    const why = await action.check?.((args ?? {}) as Args, v)
    return why ? `Refused: ${why}` : null
  } catch (error) {
    return `Refused: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Run an action now, without asking. Only for free actions and for proposals the person said yes to. */
async function runNow(action: Defined, args: unknown): Promise<ActionResult> {
  try {
    return await action.run(args ?? {})
  } catch (error) {
    return { ok: false, text: error instanceof Refusal ? `Refused: ${error.message}` : `It failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * What the channel server calls when PM uses an action. Checks the arguments; runs a free action
 * and returns what happened; for one that needs the person, writes a proposal and returns its id
 * without running anything.
 */
export async function callAction(name: string, args: unknown): Promise<ActionResult> {
  const action = byName.get(name)
  if (!action) return { ok: false, text: `There is no action called ${String(name)}. The actions are: ${ACTIONS.map((each) => each.name).join(', ')}.` }
  const v = await view()
  const refused = await refusal(action, args, v)
  if (refused) return { ok: false, text: refused }
  const given = (args ?? {}) as Args
  const asks = action.risk === 'ask' && (action.askIf ? action.askIf(given, v.grove) : true)
  if (!asks) return runNow(action, given)

  const { reason, ...request } = given
  const summary = action.plain?.(request, v) ?? action.title
  const { proposal, created } = await createProposal({ action: action.name, args: request, summary, reason: text(reason) })
  await changed()
  return {
    ok: true,
    text: created
      ? `Asked the person: ${summary}. Nothing is done until they answer; you will be told yes or no.`
      : `Asked the person already: ${summary}. Still waiting for their answer.`,
    proposalId: proposal.id,
  }
}

/* Yes and No on a proposal come back through here. A yes is checked again first: the grove may
 * have changed while the card waited, and the action should fail with a reason, not half-run. */
setProposalRunner({
  async run(name, args) {
    const action = byName.get(name)
    if (!action) return { ok: false, text: `There is no action called ${name} any more.` }
    const refused = await refusal(action, args, await view())
    if (refused) return { ok: false, text: refused.replace(/^Refused: /, 'It could not be done: ') }
    const result = await runNow(action, args)
    return { ok: result.ok, text: result.text }
  },
  async declined(name, args) {
    const action = byName.get(name)
    if (action?.declined) {
      await action.declined(args, await view())
      await changed()
    }
  },
})
