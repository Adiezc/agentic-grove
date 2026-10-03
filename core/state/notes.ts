/**
 * Carved messages: a note for your future self, left on a stone, an agent or the tree.
 *
 * Roadmap idea 9. You leave a note ("the migration is half done, start with the tests"), and it
 * waits, quietly, until work next starts there. Then it is the first thing in that place's panel,
 * and once you have read it, it fades and is gone. A note is for the next time, not for ever: one
 * note per place, and carving a new one replaces the old.
 *
 * "Work next starts there", by place:
 *
 *   stone   a session in that project started after the note was carved
 *   agent   the Grove sent that agent somewhere after the note was carved
 *   tree    either of those, anywhere in the grove
 *
 * Notes live in `grove.json` (`notes`), because they are something you said, not something the
 * scan found; `at` is written as a date a person can read. Passing a note into the Claude Code
 * session itself would be a second step with its own consent: the hooks deliberately say nothing
 * back to Claude Code today.
 *
 * Pure: notes, stones and runs in, states out. `npm run verify:notes` checks the rules.
 */

export type NotePlace = 'stone' | 'agent' | 'tree'
export const NOTE_PLACES: readonly NotePlace[] = ['stone', 'agent', 'tree']

/** Long enough for a paragraph to your future self; short enough to read at a glance. */
export const MAX_NOTE_CHARS = 600

export interface CarvedNote {
  on: NotePlace
  /** The stone's path or the agent's id. Empty for the tree. */
  id: string
  text: string
  /** When it was carved, as an ISO date (`2026-10-03T12:00:00.000Z`). */
  at: string
}

/** `waiting` until work starts there, then `showing` until read (reading removes it). */
export type NoteState = 'waiting' | 'showing'

export interface NoteView extends CarvedNote {
  state: NoteState
}

/** The little the rules need to know about a stone and a run. */
export interface NoteStone {
  id: string
  sessions: { createdAt: number }[]
}
export interface NoteRun {
  agentId: string
  createdAt: number
}

/** Whether the note's place has seen work start since it was carved. */
export function hasWokenUp(note: CarvedNote, stones: NoteStone[], runs: NoteRun[]): boolean {
  const carved = Date.parse(note.at)
  if (!Number.isFinite(carved)) return false
  const sessionSince = (stone: NoteStone) => stone.sessions.some((session) => session.createdAt > carved)
  const runSince = (run: NoteRun) => run.createdAt > carved
  if (note.on === 'stone') return stones.some((stone) => stone.id === note.id && sessionSince(stone))
  if (note.on === 'agent') return runs.some((run) => run.agentId === note.id && runSince(run))
  return stones.some(sessionSince) || runs.some(runSince)
}

export function noteViews(notes: CarvedNote[], stones: NoteStone[], runs: NoteRun[]): NoteView[] {
  return notes.map((note) => ({ ...note, state: hasWokenUp(note, stones, runs) ? 'showing' : 'waiting' }))
}

/** The note on one place, if there is one. */
export const noteOn = <T extends CarvedNote>(notes: T[], on: NotePlace, id: string): T | undefined =>
  notes.find((note) => note.on === on && note.id === (on === 'tree' ? '' : id))
