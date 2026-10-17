/**
 * Proposals: what PM asks you before it changes something that is yours to decide.
 *
 * You are the board (an idea from Paperclip; see CREDITS.md). PM may do the small, undoable things
 * on its own, but an action marked `ask` in `registry.ts` (a permanent agent, a sub-stone, a saved
 * task, a new clearing) is written here as a proposal instead of being done. The Grove shows it as
 * a card with Yes and No (`src/hud/Proposals.tsx`), and the tree turns amber until you answer.
 * Yes runs the action exactly as PM asked; No runs nothing, and a suggestion you turned down is
 * remembered so it is not offered again.
 *
 * **Kept in `proposals.json`** under the grove home (`AGENTIC_GROVE_HOME` in the checks), beside
 * `runs.json` and for the same reason: it is history the Grove writes, not intent you edit, and a
 * question PM asked should still be waiting after the Grove restarts. Every change reads the file,
 * changes it and writes it back, one at a time, so two answers given at once cannot lose either.
 *
 * **Telling PM the answer.** `onProposals` tells a listener about every new proposal and every
 * answer, and `waitForDecision` resolves when one proposal is answered (or after a timeout), so
 * the channel server can pass the outcome back to PM's session. Both also notice an answer written
 * by another process, by reading the file again every second while anyone waits.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { groveHome } from '../state/grove.ts'

export type ProposalState = 'pending' | 'yes' | 'no' | 'failed'

export interface Proposal {
  id: string
  /** The action's name in the registry, like `split_stone`. */
  action: string
  /** Exactly what PM asked for, already checked against the action's schema. */
  args: Record<string, unknown>
  /** What it would do, in plain words, for the card: "Give Data its own stone, inside Work". */
  summary: string
  /** Why PM is asking, in its own words. */
  reason: string
  /** ISO date. */
  createdAt: string
  state: ProposalState
  decidedAt?: string
  /** Your reason, if you gave one. Passed back to PM with the answer. */
  answer?: string
  /** What happened when a yes ran the action. */
  result?: { ok: boolean; text: string }
}

export type ProposalEvent = { kind: 'created' | 'decided'; proposal: Proposal }

/** How decided proposals are kept for. History, not an archive. */
const KEEP_DECIDED = 100
/** How often a wait looks at the file for an answer given by another process. */
const POLL_MS = 1000

export const proposalsPath = (): string => path.join(groveHome(), 'proposals.json')

/**
 * How a yes and a no are carried out. Set by `registry.ts` when it loads, so this file does not
 * import the registry (which imports this one).
 */
export interface ProposalRunner {
  run(action: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>
  declined(action: string, args: Record<string, unknown>): Promise<void>
}
let runner: ProposalRunner | null = null
export function setProposalRunner(next: ProposalRunner): void {
  runner = next
}

const isProposal = (value: unknown): value is Proposal => {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.action === 'string' &&
    typeof p.args === 'object' && p.args !== null &&
    typeof p.summary === 'string' &&
    typeof p.reason === 'string' &&
    typeof p.createdAt === 'string' &&
    ['pending', 'yes', 'no', 'failed'].includes(p.state as string)
  )
}

async function read(): Promise<Proposal[]> {
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(proposalsPath(), 'utf8'))
    const list = typeof raw === 'object' && raw !== null ? (raw as { proposals?: unknown }).proposals : undefined
    return Array.isArray(list) ? list.filter(isProposal) : []
  } catch {
    return []
  }
}

async function write(list: Proposal[]): Promise<void> {
  const file = proposalsPath()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const pending = list.filter((each) => each.state === 'pending')
  const decided = list.filter((each) => each.state !== 'pending').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')).slice(0, KEEP_DECIDED)
  const text = JSON.stringify({ proposals: [...pending, ...decided] }, null, 2) + '\n'
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporary, text, 'utf8')
    await fsp.rename(temporary, file)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Every change waits for the one before it, as in `grove.ts`. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

const listeners = new Set<(event: ProposalEvent) => void>()

/** Hear about every new proposal and every answer. Returns an unsubscribe function. */
export function onProposals(listener: (event: ProposalEvent) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(event: ProposalEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener({ ...event, proposal: { ...event.proposal } })
    } catch (error) {
      console.warn(`agentic-grove: a proposal listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** The same request, however its fields were ordered: so asking twice does not make two cards. */
const sameRequest = (a: Proposal, action: string, args: Record<string, unknown>) =>
  a.action === action && stable(a.args) === stable(args)
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner
  )

/**
 * Write a new proposal, or return the one already waiting for exactly the same request. `created`
 * is false in that case, so PM can be told it already asked.
 */
export function createProposal(fields: { action: string; args: Record<string, unknown>; summary: string; reason: string }, now = Date.now()): Promise<{ proposal: Proposal; created: boolean }> {
  return serial(async () => {
    const list = await read()
    const existing = list.find((each) => each.state === 'pending' && sameRequest(each, fields.action, fields.args))
    if (existing) return { proposal: existing, created: false }
    const proposal: Proposal = {
      id: randomUUID(),
      action: fields.action,
      args: fields.args,
      summary: fields.summary.slice(0, 300),
      reason: fields.reason.trim().slice(0, 600),
      createdAt: new Date(now).toISOString(),
      state: 'pending',
    }
    await write([...list, proposal])
    emit({ kind: 'created', proposal })
    return { proposal, created: true }
  })
}

/** Every proposal kept: waiting ones first, oldest first, then answered ones, newest first. */
export async function listProposals(): Promise<Proposal[]> {
  const list = await read()
  const pending = list.filter((each) => each.state === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const decided = list.filter((each) => each.state !== 'pending').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
  return [...pending, ...decided]
}

export async function pendingProposals(): Promise<Proposal[]> {
  return (await listProposals()).filter((each) => each.state === 'pending')
}

export async function getProposal(id: string): Promise<Proposal | undefined> {
  return (await read()).find((each) => each.id === id)
}

/** Ids being answered right now, so a double click cannot run an action twice. */
const deciding = new Set<string>()

/**
 * Answer a proposal. Yes runs the action as PM asked it; No runs nothing and remembers the
 * suggestion as turned down. Only a waiting proposal can be answered, once.
 */
export async function decide(id: unknown, verdict: unknown, reason?: unknown): Promise<{ ok: boolean; error?: string; proposal?: Proposal }> {
  if (typeof id !== 'string' || (verdict !== 'yes' && verdict !== 'no')) return { ok: false, error: 'Answer yes or no to a proposal' }
  const answer = typeof reason === 'string' ? reason.trim().slice(0, 600) : ''
  if (deciding.has(id)) return { ok: false, error: 'That one is already being answered' }
  deciding.add(id)
  try {
    const proposal = await getProposal(id)
    if (!proposal) return { ok: false, error: 'No such proposal' }
    if (proposal.state !== 'pending') return { ok: false, error: 'That proposal has already been answered' }
    if (!runner) return { ok: false, error: 'PM’s actions are not loaded' }

    let state: ProposalState = 'no'
    let result: Proposal['result']
    if (verdict === 'yes') {
      result = await runner.run(proposal.action, proposal.args).catch((error: unknown) => ({ ok: false, text: `It failed: ${error instanceof Error ? error.message : String(error)}` }))
      state = result.ok ? 'yes' : 'failed'
    } else {
      await runner.declined(proposal.action, proposal.args).catch(() => {})
    }
    const decided = await serial(async () => {
      const list = await read()
      const index = list.findIndex((each) => each.id === id)
      const entry: Proposal = { ...(list[index] ?? proposal), state, decidedAt: new Date().toISOString() }
      if (answer) entry.answer = answer
      if (result) entry.result = { ok: result.ok, text: result.text }
      if (index >= 0) list[index] = entry
      else list.push(entry)
      await write(list)
      return entry
    })
    emit({ kind: 'decided', proposal: decided })
    return { ok: true, proposal: decided }
  } finally {
    deciding.delete(id)
  }
}

/**
 * Resolve with the proposal once it is answered, or with `null` after `timeoutMs`. An unknown id
 * resolves with `null` at once.
 */
export function waitForDecision(id: string, timeoutMs: number): Promise<Proposal | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: Proposal | null) => {
      if (done) return
      done = true
      unsubscribe()
      clearInterval(poll)
      clearTimeout(timer)
      resolve(value)
    }
    const check = async () => {
      const found = await getProposal(id)
      if (!found) finish(null)
      else if (found.state !== 'pending') finish(found)
    }
    const unsubscribe = onProposals((event) => {
      if (event.kind === 'decided' && event.proposal.id === id) finish(event.proposal)
    })
    const poll = setInterval(() => void check(), POLL_MS)
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs))
    poll.unref?.()
    void check()
  })
}
