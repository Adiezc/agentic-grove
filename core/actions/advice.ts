/**
 * When PM should suggest growing the grove: a clearing, a sub-stone, a saved task.
 *
 * The rules already exist, one per idea, and the Projects and Runes panels already offer what they
 * find: `suggestClearings` (projects you work on together), `splitsFor` (a project whose work has
 * spread over separate parts) and `suggestRunes` (a prompt you keep starting sessions with). This
 * file does not add a fourth set of rules. It runs those three with the numbers in
 * `ADVICE_THRESHOLDS`, leaves out anything you have turned down or PM has already asked about, and
 * gives each suggestion a one-line reason and the action call that would carry it out, so PM can
 * put it to you in one sentence and ask.
 *
 * PM only ever suggests. Every action it suggests here is an `ask` action, so even a yes in the
 * chat ends in a card you answer. Pure: state and a clock in, suggestions out.
 */
import path from 'node:path'
import type { GroveFile } from '../state/schema.ts'
import type { Runestone } from '../state/stones.ts'
import { SPLIT_MIN_PARTS, SPLIT_MIN_SESSIONS, SPLIT_MIN_SHARE, splitsFor } from '../state/stones.ts'
import { SUGGEST_HOURS, suggestClearings } from '../state/clearings.ts'
import { SUGGEST_AFTER, promptKey, suggestRunes } from '../state/suggest-runes.ts'
import { PAIRING_WINDOW_MS, pairings } from '../state/pairings.ts'
import type { Proposal } from './proposals.ts'

/**
 * The numbers that decide when PM suggests something. Each starts as the value the panels use, so
 * PM and the panels agree unless you change one here on purpose.
 */
export const ADVICE_THRESHOLDS = {
  clearing: {
    /** Different clock hours two stones must both have had work in, within the window, to be suggested together. */
    sharedHours: SUGGEST_HOURS,
    /** How far back shared hours count, in hours. A week: a habit, not one busy afternoon. */
    windowHours: PAIRING_WINDOW_MS / 3_600_000,
  },
  split: {
    /** Sessions a subfolder or worktree needs before it is a part worth its own stone. */
    minSessions: SPLIT_MIN_SESSIONS,
    /** The share of the stone's sessions each such part must hold, from 0 to 1. */
    minShare: SPLIT_MIN_SHARE,
    /** How many such parts it takes. One busy subfolder alone is just where the work is. */
    minParts: SPLIT_MIN_PARTS,
  },
  rune: {
    /** Sessions on one stone that must have opened with the same prompt before it is offered as a saved task. */
    repeats: SUGGEST_AFTER,
  },
  /** At most this many suggestions of each kind are handed to PM at once, strongest first. */
  perKind: 2,
}

export type AdviceThresholds = typeof ADVICE_THRESHOLDS

export interface Advice {
  kind: 'clearing' | 'split' | 'rune'
  /** One line PM can say as it is. */
  reason: string
  /** The action that would carry it out. Always one that asks you first. */
  action: 'make_clearing' | 'split_stone' | 'carve_rune'
  /** Its arguments, ready to pass, except a clearing's name, which PM should ask for or propose. */
  args: Record<string, unknown>
}

export interface AdviceState {
  /** The stones as the scan derived them, sessions and all. */
  stones: Runestone[]
  /** For what you have turned down. */
  grove: Pick<GroveFile, 'stones' | 'declinedClearings'>
}

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''))

/** Has PM already asked for this, and is the question still waiting? */
function asked(pending: Proposal[], action: string, matches: (args: Record<string, unknown>) => boolean): boolean {
  return pending.some((proposal) => proposal.state === 'pending' && proposal.action === action && matches(proposal.args))
}

/** PM may name a stone by its path or its name; either way it is the same stone. */
const names = (ref: unknown, stone: { path: string; name: string }) =>
  typeof ref === 'string' && (ref === stone.path || ref.trim().toLowerCase() === stone.name.toLowerCase())

/** A part to split off, as a path or as a folder name inside its stone. */
const namesPart = (ref: unknown, stone: { path: string }, part: string) =>
  typeof ref === 'string' && (path.resolve(stone.path, ref.trim()) === part)

/**
 * What PM could suggest now, with a reason each. Turned-down suggestions are never included (the
 * `declined…` lists in `grove.json`), nor ones PM has a proposal waiting on.
 */
export function groveAdvice(
  state: AdviceState,
  now = Date.now(),
  thresholds: AdviceThresholds = ADVICE_THRESHOLDS,
  pending: Proposal[] = []
): Advice[] {
  const { stones, grove } = state
  const nameOf = (id: string) => stones.find((stone) => stone.id === id)?.name ?? path.basename(id)
  const configOf = (id: string) => grove.stones.find((stone) => stone.path === id)
  const out: Advice[] = []

  const windowMs = thresholds.clearing.windowHours * 3_600_000
  const days = Math.round(thresholds.clearing.windowHours / 24)
  const clearings = suggestClearings(stones, pairings(stones, now, windowMs), grove.declinedClearings, thresholds.clearing.sharedHours)
    .filter((offer) => !asked(pending, 'make_clearing', (args) => {
      const refs = Array.isArray(args.stones) ? args.stones : []
      const members = offer.stones.map((id) => stones.find((stone) => stone.id === id) ?? { path: id, name: path.basename(id) })
      return refs.length === members.length && members.every((stone) => refs.some((ref) => names(ref, stone)))
    }))
    .slice(0, thresholds.perKind)
  for (const offer of clearings) {
    out.push({
      kind: 'clearing',
      reason: `You worked on ${list(offer.stones.map(nameOf))} in the same hours ${offer.hours} times in the last ${days === 1 ? 'day' : `${days} days`}, and none is in a clearing yet.`,
      action: 'make_clearing',
      args: { stones: offer.stones },
    })
  }

  const taken = new Set(stones.map((stone) => stone.path))
  const splits = stones
    .filter((stone) => !stone.twin)
    .flatMap((stone) => {
      const declined = configOf(stone.path)?.declinedSplits ?? []
      const parts = splitsFor(stone.path, stone.sessions, new Set([...taken, ...declined]), thresholds.split)
      return parts
        .filter((part) => !asked(pending, 'split_stone', (args) => names(args.stone, stone) && namesPart(args.part, stone, part.path)))
        .map((part) => ({ stone, part }))
    })
    .sort((a, b) => b.part.sessionCount - a.part.sessionCount)
    .slice(0, thresholds.perKind)
  for (const { stone, part } of splits) {
    out.push({
      kind: 'split',
      reason: `${part.sessionCount} of the ${stone.sessions.length} sessions on ${stone.name} were in ${part.kind === 'worktree' ? `the worktree ${part.name}` : `its ${part.name} folder`}, enough to give it a stone of its own.`,
      action: 'split_stone',
      args: { stone: stone.path, part: part.path },
    })
  }

  const runes = stones
    .flatMap((stone) =>
      suggestRunes(stone.sessions, stone.runes, configOf(stone.path)?.declinedRunes ?? [], thresholds.rune.repeats)
        .filter((offer) => !asked(pending, 'carve_rune', (args) => names(args.stone, stone) && typeof args.prompt === 'string' && promptKey(args.prompt) === offer.key))
        .map((offer) => ({ stone, offer }))
    )
    .sort((a, b) => b.offer.count - a.offer.count)
    .slice(0, thresholds.perKind)
  for (const { stone, offer } of runes) {
    out.push({
      kind: 'rune',
      reason: `You started ${offer.count} sessions on ${stone.name} with “${offer.prompt.length > 60 ? `${offer.prompt.slice(0, 59)}…` : offer.prompt}”; saved as a task it would be one click.`,
      action: 'carve_rune',
      args: { stone: stone.path, prompt: offer.prompt },
    })
  }
  return out
}
