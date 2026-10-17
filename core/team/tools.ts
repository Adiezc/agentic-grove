/**
 * The team tools: what PM and the workers call to talk to each other (`book.ts` explains the
 * plan). Workers get them through the Grove's helper in team mode; PM gets them beside its Grove
 * actions. The only difference is waiting: a worker's `ask_agent` waits for the answer, PM's does
 * not, so PM can keep talking to you while a worker thinks.
 */
import { PM, type Member, type TeamBook, type TeamRun, MAX_TALK_CHARS } from './book.ts'
import type { PmTool } from '../pm/protocol.ts'

export interface TeamHost {
  /** The runs the Grove started, newest first. */
  runs(): TeamRun[]
}

export interface TeamAnswer {
  ok: boolean
  text: string
  /** A worker's question: the helper waits for this id's answer. */
  askId?: string
}

/** How long a worker's question waits for its answer before giving up. */
export const ASK_WAIT_MS = 10 * 60_000

const TO = {
  type: 'string',
  maxLength: 120,
  description: '"pm", or a teammate\'s name as team_roster lists it ("Builder", "Researcher"), or a run id.',
}
const STONE = { type: 'string', maxLength: 200, description: 'Which stone, when two runs of the same agent are working.' }

export function teamTools(forPm: boolean): PmTool[] {
  return [
    {
      name: 'team_roster',
      description: 'Who is on the team right now: PM and every agent the Grove has working, with the stone each is on and its run id.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ask_agent',
      description: forPm
        ? 'Ask a working agent a question. Returns at once; their answer reaches you as a [Grove] message. Use it to check on progress or to get a decision only they can make.'
        : 'Ask PM or another agent on the team a question and wait for the answer (up to ten minutes). Use it when you are blocked on something only they know or can decide; do not use it for things you can find out yourself.',
      inputSchema: {
        type: 'object',
        properties: { to: TO, question: { type: 'string', minLength: 1, maxLength: MAX_TALK_CHARS }, stone: STONE },
        required: ['to', 'question'],
        additionalProperties: false,
      },
    },
    {
      name: 'tell_agent',
      description: 'Tell PM or another agent something without waiting: a finding they need, a change of plan, a heads-up that you are touching a file.',
      inputSchema: {
        type: 'object',
        properties: { to: TO, message: { type: 'string', minLength: 1, maxLength: MAX_TALK_CHARS }, stone: STONE },
        required: ['to', 'message'],
        additionalProperties: false,
      },
    },
    {
      name: 'answer_agent',
      description: 'Answer a question a teammate asked you, by its id ("question 1a2b3c4d").',
      inputSchema: {
        type: 'object',
        properties: { ask_id: { type: 'string', minLength: 1, maxLength: 20 }, answer: { type: 'string', minLength: 1, maxLength: MAX_TALK_CHARS } },
        required: ['ask_id', 'answer'],
        additionalProperties: false,
      },
    },
  ]
}

export const TEAM_TOOL_NAMES = new Set(['team_roster', 'ask_agent', 'tell_agent', 'answer_agent'])

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** A run by id, or by agent name (on a stone, if given), live ones first, newest first. */
export function findMember(to: string, stone: string, runs: TeamRun[]): Member | string {
  const wanted = to.trim().toLowerCase()
  if (!wanted) return 'Say who: "pm" or a teammate\'s name.'
  if (wanted === 'pm' || wanted === 'manager') return PM
  const byId = runs.find((run) => run.id === to.trim())
  if (byId) return byId.id
  const named = runs.filter((run) => run.agentName.toLowerCase() === wanted && (!stone || run.stoneName.toLowerCase() === stone.toLowerCase() || run.stoneId === stone))
  const live = named.filter((run) => run.live)
  const pick = live[0] ?? named[0]
  if (!pick) {
    const working = runs.filter((run) => run.live).map((run) => `${run.agentName} on ${run.stoneName}`)
    return `No teammate called "${to}"${stone ? ` on ${stone}` : ''}. Working now: ${working.length ? working.join(', ') : 'nobody but PM'}.`
  }
  return pick.id
}

export function memberName(member: Member, runs: TeamRun[]): string {
  if (member === PM) return 'PM'
  const run = runs.find((each) => each.id === member)
  return run ? `${run.agentName} (on ${run.stoneName})` : 'A teammate who has left'
}

export function callTeamTool(from: Member, name: string, args: unknown, book: TeamBook, host: TeamHost): TeamAnswer {
  const given = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
  const runs = host.runs()

  if (name === 'team_roster') {
    const working = runs.filter((run) => run.live && run.id !== from)
    const lines = [from === PM ? null : '- PM (to: "pm"): runs the team and talks to the person', ...working.map((run) => `- ${run.agentName} on ${run.stoneName} (run ${run.id})`)].filter(Boolean)
    return { ok: true, text: lines.length ? `On the team now:\n${lines.join('\n')}` : 'Nobody else is working right now.' }
  }

  if (name === 'answer_agent') {
    const ask = book.get(str(given.ask_id))
    if (!ask || ask.kind !== 'ask') return { ok: false, text: `There is no question "${str(given.ask_id)}".` }
    if (ask.to !== from) return { ok: false, text: 'That question was asked of someone else.' }
    if (book.answerTo(ask.id)) return { ok: false, text: 'That question has already been answered.' }
    book.post({ kind: 'answer', from, to: ask.from, text: str(given.answer), replyTo: ask.id })
    return { ok: true, text: `Answered ${memberName(ask.from, runs)}.` }
  }

  if (name === 'ask_agent' || name === 'tell_agent') {
    const to = findMember(str(given.to), str(given.stone), runs)
    if (to !== PM && !runs.some((run) => run.id === to)) return { ok: false, text: to }
    if (to === from) return { ok: false, text: 'That is you.' }
    const text = str(name === 'ask_agent' ? given.question : given.message)
    if (!text) return { ok: false, text: 'Nothing to say.' }
    const message = book.post({ kind: name === 'ask_agent' ? 'ask' : 'tell', from, to, text })
    const target = runs.find((run) => run.id === to)
    const late = target && !target.live ? ` ${target.agentName} has finished, so it will read this when it is resumed.` : ''
    if (name === 'tell_agent') return { ok: true, text: `Told ${memberName(to, runs)}.${late}` }
    if (from === PM) return { ok: true, text: `Asked ${memberName(to, runs)} (question ${message.id}); the answer will reach you as a [Grove] message.${late}` }
    return { ok: true, text: `Asked ${memberName(to, runs)}; waiting for the answer.`, askId: message.id }
  }

  return { ok: false, text: `There is no team tool called ${name}.` }
}
