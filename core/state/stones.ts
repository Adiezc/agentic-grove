/**
 * Turning sessions into runestones.
 *
 * A stone is a project, and a project is a folder on disk. This module groups the sessions the
 * scan found by the folder they ran in, applies whatever you have said about those folders in
 * `grove.json`, and hands back the stones the grove should draw.
 *
 * It is pure: sessions and configuration in, stones out, no filesystem and no clock beyond the
 * `now` it is given. That is deliberate — it is the piece most likely to need its rules argued
 * with, and an argument is much easier to settle against a function you can call with made-up
 * sessions than against something that reads the disk.
 *
 * The rule that governs all of it, from the brief: **nothing becomes permanent scenery unless it
 * has a directory on disk.** Repeated work becomes a rune on a stone, one-off work becomes a
 * wisp that fades, and work with no real home goes to the Wildwood.
 */
import path from 'node:path'
import os from 'node:os'
import type { Provenance, Session, SessionStatus } from '../harnesses/types.ts'
import type { GroveFile, Rune, StoneConfig } from './schema.ts'

/** The one stone the user never creates and never deletes. */
export const WILDWOOD_ID = 'wildwood'

/**
 * A stone's state is the most urgent thing happening on it, in this order.
 *
 * `waiting` outranks `errored` because a session holding the turn back is something you can act
 * on right now, while an error has already happened. Both outrank `running`, which is the grove
 * working as intended and should not pull the eye.
 */
export type StoneStatus = SessionStatus

const URGENCY: Record<StoneStatus, number> = { waiting: 4, errored: 3, running: 2, idle: 1 }

/**
 * How long an error stays an alarm before it becomes history.
 *
 * Unlike `running` and `waiting`, which the adapters already bound by recency, `errored` is
 * sticky: a session that failed last Tuesday still reports `errored` today, because that is
 * genuinely what its transcript says. Left alone, one old failure would light a stone red for
 * ever, and a grove with a permanent red stone in it teaches you to ignore red.
 *
 * So an error older than this is still *reported* on the session — nothing is thrown away — but
 * it stops setting the stone's colour. A day is a guess, chosen because it survives overnight:
 * something that broke while you were asleep should still be red when you sit down. It is a
 * number worth revisiting once the grove is actually on screen.
 */
export const ERROR_ALARM_MS = 24 * 60 * 60 * 1000

/**
 * Folders that get sent to the Wildwood rather than earning a stone of their own.
 *
 * Both of these are real work that genuinely has no project home, which is exactly what the
 * Wildwood is for:
 *
 *   - **Claude desktop scratch workspaces.** A throwaway directory per scratch session, with a
 *     uuid in its name. On the machine this was written on there were four, which would have
 *     been four monoliths named `scratch-2026-09-03-bc2de4` standing in the grove for ever.
 *     They pass the "has a directory on disk" test and fail the spirit of it.
 *   - **The home directory itself.** A session run from `~` is a question you asked in passing,
 *     not a project. It would otherwise stand as a stone named after your home folder, which is both odd and
 *     a stone you can never usefully do anything with.
 *
 * A folder matching one of these can still be given a stone by putting it in `grove.json` with
 * `"wildwood": false` — the explicit setting always wins over the assumption.
 */
const WILDWOOD_PATTERNS: { test: (projectPath: string) => boolean; why: string }[] = [
  {
    test: (p) => p.includes('/Application Support/Claude/scratch-workspaces/'),
    why: 'a Claude desktop scratch workspace',
  },
  { test: (p) => p === os.homedir(), why: 'your home directory rather than a project' },
]

/** One runestone in the grove, with everything needed to draw it. */
export interface Runestone {
  /** Stable across scans: the project path, or `'wildwood'`. What saved positions key on. */
  id: string
  /** What is written on it. The folder name unless `grove.json` overrides it. */
  name: string
  /** Absolute project path. Empty for the Wildwood, which is not a folder. */
  path: string
  role: 'project' | 'wildwood'
  status: StoneStatus
  /**
   * How much to trust `status` — the weakest provenance among the sessions that set it. A stone
   * lit from a Codex inference should not claim the confidence of one lit from a live pid.
   */
  statusProvenance: Provenance
  /** Most recent first. */
  sessions: Session[]
  runningCount: number
  /** Sessions asking for something: holding the turn back, or a recent failure. */
  attentionCount: number
  lastActivityAt: number
  /** Repeatable tasks carved here. */
  runes: Rune[]
  /** Why this is a Wildwood resident rather than its own stone, when it is one. */
  wildwoodReasons: string[]
}

export interface DerivedGrove {
  stones: Runestone[]
  /** Stones hidden by configuration. Reported so the interface can offer them back. */
  hidden: { path: string; name: string; sessionCount: number }[]
  totalSessions: number
  runningSessions: number
  attentionSessions: number
}

/**
 * Is this session asking for something?
 *
 * Not the same as "has it changed". A running session has moved on since you last looked — that
 * is what running means — so counting it would put a marker beside every busy stone, which is
 * the opposite of "nothing pulls the eye unless it has earned it".
 */
export function wantsYou(session: Session, now: number): boolean {
  if (session.status === 'waiting') return true
  if (session.status === 'errored') return now - session.lastActivityAt < ERROR_ALARM_MS
  return session.status === 'idle' && session.unread
}

/** Which status a session contributes to its stone. A stale error contributes nothing urgent. */
function contributedStatus(session: Session, now: number): StoneStatus {
  if (session.status === 'errored' && now - session.lastActivityAt >= ERROR_ALARM_MS) return 'idle'
  return session.status
}

const PROVENANCE_ORDER: Provenance[] = ['unknown', 'inferred', 'measured', 'official']

/** The weakest of the provenances given — a stone is only as trustworthy as its worst source. */
function weakest(values: Provenance[]): Provenance {
  if (!values.length) return 'unknown'
  return values.reduce((worst, value) =>
    PROVENANCE_ORDER.indexOf(value) < PROVENANCE_ORDER.indexOf(worst) ? value : worst
  )
}

/**
 * Should this project's sessions go to the Wildwood?
 *
 * An explicit setting in `grove.json` always wins, in both directions — including saying "no,
 * this really is a project" about a folder the Grove would otherwise assume away.
 */
function wildwoodReasons(projectPath: string, config: StoneConfig | undefined): string[] {
  if (config?.wildwood === true) return ['you set it to the Wildwood in grove.json']
  if (config && 'wildwood' in config && config.wildwood === false) return []
  return WILDWOOD_PATTERNS.filter((pattern) => pattern.test(projectPath)).map((p) => p.why)
}

/**
 * What to write on a stone.
 *
 * The session's own `project` rather than the basename of its path, because `core/scan.ts` has
 * already done real work on that field: where two checkouts share a folder name it grows each
 * one leftward along its path until they differ, so `~/Codex/2026-08-29/notes` and
 * `~/Codex/2026-08-30/notes` become `2026-08-29/notes` and `2026-08-30/notes`.
 *
 * Recomputing the basename here threw that away and put two stones in the grove with the same
 * name — on this machine, two called `referenced-chatgpt-conversation-this-is-an`, which is
 * precisely the "their sessions become indistinguishable" case the scan bothers to prevent.
 * Every session in a group shares a path, so they agree on the name; the first is enough.
 */
function stoneName(projectPath: string, group: Session[]): string {
  return group[0]?.project || path.basename(projectPath) || projectPath
}

/**
 * Derive the grove from the sessions on disk and what you have said about them.
 *
 * `now` is passed in rather than read, so that the error-decay rule can be tested without
 * waiting a day.
 */
export function deriveStones(
  sessions: Session[],
  grove: GroveFile,
  now: number = Date.now()
): DerivedGrove {
  const configByPath = new Map(grove.stones.map((stone) => [stone.path, stone]))

  /** Sessions that belong to a real project stone, grouped by path. */
  const byPath = new Map<string, Session[]>()
  /** Sessions with no home worth a monolith, plus why each ended up here. */
  const wildwoodSessions: Session[] = []
  const wildwoodWhy = new Set<string>()
  const hidden: DerivedGrove['hidden'] = []
  const hiddenCounts = new Map<string, number>()

  for (const session of sessions) {
    const projectPath = session.projectPath
    const config = configByPath.get(projectPath)

    if (config?.hidden) {
      hiddenCounts.set(projectPath, (hiddenCounts.get(projectPath) ?? 0) + 1)
      continue
    }

    const reasons = wildwoodReasons(projectPath, config)
    if (reasons.length) {
      wildwoodSessions.push(session)
      for (const reason of reasons) wildwoodWhy.add(reason)
      continue
    }

    // A session with no resolvable project path at all — the harness could not tell us where it
    // ran — has nowhere else to go, and inventing a folder for it would be worse.
    if (!projectPath) {
      wildwoodSessions.push(session)
      wildwoodWhy.add('the harness did not record where it was working')
      continue
    }

    const list = byPath.get(projectPath) ?? []
    list.push(session)
    byPath.set(projectPath, list)
  }

  for (const [projectPath, count] of hiddenCounts) {
    hidden.push({
      path: projectPath,
      name: configByPath.get(projectPath)?.name || path.basename(projectPath),
      sessionCount: count,
    })
  }

  const build = (
    id: string,
    name: string,
    stonePath: string,
    role: Runestone['role'],
    group: Session[],
    runes: Rune[],
    reasons: string[]
  ): Runestone => {
    const ordered = [...group].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const statuses = ordered.map((session) => contributedStatus(session, now))
    const status = statuses.reduce<StoneStatus>(
      (worst, current) => (URGENCY[current] > URGENCY[worst] ? current : worst),
      'idle'
    )
    // Only the sessions actually setting the stone's status get a say in how much it is trusted.
    // Averaging in a dozen idle sessions would make a live, pid-verified stone look vague.
    const deciding = ordered.filter((_, index) => statuses[index] === status)
    return {
      id,
      name,
      path: stonePath,
      role,
      status,
      statusProvenance: weakest(deciding.map((session) => session.statusProvenance)),
      sessions: ordered,
      runningCount: statuses.filter((value) => value === 'running').length,
      attentionCount: ordered.filter((session) => wantsYou(session, now)).length,
      lastActivityAt: ordered[0]?.lastActivityAt ?? 0,
      runes,
      wildwoodReasons: reasons,
    }
  }

  const stones: Runestone[] = []
  for (const [projectPath, group] of byPath) {
    const config = configByPath.get(projectPath)
    stones.push(
      build(
        projectPath,
        config?.name || stoneName(projectPath, group),
        projectPath,
        'project',
        group,
        config?.runes ?? [],
        []
      )
    )
  }

  // Most urgent first, then most recent. This is the order the eye should travel in, and it is
  // also the order the interface can rely on without sorting again.
  stones.sort(
    (a, b) => URGENCY[b.status] - URGENCY[a.status] || b.lastActivityAt - a.lastActivityAt
  )

  // The Wildwood is always present, even with nothing in it — it is permanent scenery by
  // decision, and a grove where it appears and disappears would be a grove that flickers.
  const wildwoodRunes = configByPath.get(WILDWOOD_ID)?.runes ?? []
  stones.push(
    build(
      WILDWOOD_ID,
      'Wildwood',
      '',
      'wildwood',
      wildwoodSessions,
      wildwoodRunes,
      [...wildwoodWhy]
    )
  )

  const visible = stones.flatMap((stone) => stone.sessions)
  return {
    stones,
    hidden,
    totalSessions: visible.length,
    runningSessions: visible.filter((session) => session.status === 'running').length,
    attentionSessions: visible.filter((session) => wantsYou(session, now)).length,
  }
}
