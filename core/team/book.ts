/**
 * Agents talking to each other: PM and the workers it sends can ask, tell and answer.
 *
 * Decided 18 October 2026 with Adrian ("the team talks", stage B of the agent plan), after Codync's
 * `team` tool (Apache-2.0, idea only): a worker can ask PM or another worker something and wait for
 * the answer; PM can ask or tell a worker without waiting, and hears the answer as a message. Every
 * message is drawn in the scene as a pulse of light between the two, and kept in this book so the
 * conversation can be read.
 *
 * How a message reaches each kind of agent, using only Claude Code's own features:
 *
 *   PM       through its channel (`core/pm/`), as a "[Grove]" message, at once.
 *   worker   through hooks set for that run only (`--settings`): after each tool it uses, its
 *            waiting messages are added to what it reads; and when it is about to stop, a waiting
 *            message holds it back and is given to it instead. A worker that has already finished
 *            gets its messages the next time it is resumed.
 *
 * A worker's own question waits for its answer (its tool call blocks, up to ten minutes); PM's never
 * do, so PM stays free to talk to you. Plain node, no Electron: `test/verify-team.ts` drives it.
 */
import { randomUUID } from 'node:crypto'

/** `pm`, or a run id (which, for Claude Code, is also its session id). */
export type Member = string
export const PM: Member = 'pm'

export type TalkKind = 'ask' | 'tell' | 'answer'

export interface TeamMessage {
  id: string
  kind: TalkKind
  from: Member
  to: Member
  text: string
  /** For an answer: the question it answers. */
  replyTo?: string
  at: number
  /** A worker's message has been handed to it (by a hook); PM's are handed over at once. */
  delivered: boolean
}

/** What the scene needs to draw a pulse: where it starts and ends. A stone id, or null for the tree. */
export interface TalkPulse {
  id: string
  kind: TalkKind
  from: string | null
  to: string | null
  at: number
}

/** A run as the book needs to know it: who it is and where. */
export interface TeamRun {
  id: string
  agentName: string
  stoneId: string
  stoneName: string
  /** Still at work, so a message can reach it. */
  live: boolean
}

export const MAX_TALK_CHARS = 8000
const KEEP = 400
/** How long a pulse stays in the snapshot for the scene to draw. */
const PULSE_MS = 8000

export class TeamBook {
  private messages: TeamMessage[] = []
  private answerWaiters = new Map<string, ((answer: TeamMessage) => void)[]>()
  private listeners = new Set<(message: TeamMessage) => void>()

  constructor(private now: () => number = Date.now) {}

  onMessage(listener: (message: TeamMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  post(fields: { kind: TalkKind; from: Member; to: Member; text: string; replyTo?: string }): TeamMessage {
    const message: TeamMessage = {
      id: randomUUID().slice(0, 8),
      kind: fields.kind,
      from: fields.from,
      to: fields.to,
      text: fields.text.trim().slice(0, MAX_TALK_CHARS),
      replyTo: fields.replyTo,
      at: this.now(),
      // PM's messages go out through its channel at once; a worker's wait for its hooks.
      delivered: fields.to === PM,
    }
    this.messages.push(message)
    if (this.messages.length > KEEP) this.messages.splice(0, this.messages.length - KEEP)
    if (message.kind === 'answer' && message.replyTo) {
      const waiting = this.answerWaiters.get(message.replyTo) ?? []
      // Someone was waiting on this answer: their tool call returns it, so the hook must not hand it over again.
      if (waiting.length) message.delivered = true
      for (const wake of waiting) wake(message)
      this.answerWaiters.delete(message.replyTo)
    }
    for (const listener of this.listeners) listener(message)
    return message
  }

  get(id: string): TeamMessage | undefined {
    return this.messages.find((message) => message.id === id)
  }

  /** Has this question been answered? */
  answerTo(askId: string): TeamMessage | undefined {
    return this.messages.find((message) => message.kind === 'answer' && message.replyTo === askId)
  }

  /** Wait up to `ms` for the answer to a question; `null` when none came in time. */
  waitForAnswer(askId: string, ms: number): Promise<TeamMessage | null> {
    const known = this.answerTo(askId)
    if (known) return Promise.resolve(known)
    return new Promise((resolve) => {
      const wake = (answer: TeamMessage) => {
        clearTimeout(timer)
        resolve(answer)
      }
      const timer = setTimeout(() => {
        const list = (this.answerWaiters.get(askId) ?? []).filter((each) => each !== wake)
        if (list.length) this.answerWaiters.set(askId, list)
        else this.answerWaiters.delete(askId)
        resolve(null)
      }, ms)
      this.answerWaiters.set(askId, [...(this.answerWaiters.get(askId) ?? []), wake])
    })
  }

  /** Hand a run its waiting messages, oldest first, and mark them delivered. */
  takeInbox(runId: string): TeamMessage[] {
    const waiting = this.messages.filter((message) => message.to === runId && !message.delivered)
    for (const message of waiting) message.delivered = true
    return waiting
  }

  /** Messages still waiting for a run that has not picked them up. */
  waitingFor(runId: string): number {
    return this.messages.filter((message) => message.to === runId && !message.delivered).length
  }

  /** The last few messages, newest last, for the conversation's talk log. */
  recent(count = 30): TeamMessage[] {
    return this.messages.slice(-count)
  }

  /** Pulses for the scene: messages from the last few seconds, placed by the stones of their runs. */
  pulses(stoneOf: (member: Member) => string | null): TalkPulse[] {
    const since = this.now() - PULSE_MS
    return this.messages
      .filter((message) => message.at >= since)
      .map((message) => ({ id: message.id, kind: message.kind, from: stoneOf(message.from), to: stoneOf(message.to), at: message.at }))
  }
}

/**
 * How a teammate's messages read when handed to a worker by its hooks. Plain, with each id, so the
 * worker can answer the right question with `answer_agent`.
 */
export function inboxText(messages: TeamMessage[], nameOf: (member: Member) => string): string {
  const lines = messages.map((message) => {
    const who = nameOf(message.from)
    if (message.kind === 'ask') return `${who} asks you (question ${message.id}): ${message.text}\nAnswer with the grove answer_agent tool, passing ask_id "${message.id}".`
    if (message.kind === 'answer') return `${who} answered your question ${message.replyTo}: ${message.text}`
    return `${who} says: ${message.text}`
  })
  return `Message from your Agentic Grove team:\n\n${lines.join('\n\n')}`
}
