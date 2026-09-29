/**
 * Turning sessions into runestones.
 *
 * A stone is a project, and **a project is a folder you chose**. You either create one from the
 * grove or connect a folder you already have; either way it is written into `grove.json`, and
 * only those folders stand as stones. A new grove has none.
 *
 * That replaced an earlier rule, where every folder any agent had ever run in became a stone by
 * itself. On a real machine that was twenty-nine stones, most of them throwaway chat folders, and
 * the grove stopped being something you arranged and became something that happened to you.
 *
 * Sessions still matter: every session the scan finds inside a connected folder (or any folder
 * under it) lights that stone, whoever started it — the Grove, or you in a terminal. Sessions
 * everywhere else are counted but not drawn, and the busiest of their folders are offered back as
 * suggestions when you go to connect a project.
 *
 * It is pure: sessions and configuration in, stones out, no filesystem and no clock beyond the
 * `now` it is given. That is deliberate — it is the piece most likely to need its rules argued
 * with, and an argument is much easier to settle against a function you can call with made-up
 * sessions than against something that reads the disk.
 */
import path from 'node:path'
import os from 'node:os'
import type { Provenance, Session, SessionStatus, Tell } from '../harnesses/types.ts'
import type { GroveFile, Rune, StoneConfig } from './schema.ts'

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
 * genuinely what its transcript says. Left alone, one old failure would light a stone for ever,
 * and a grove with a permanent alarm in it teaches you to ignore alarms.
 *
 * So an error older than this is still *reported* on the session — nothing is thrown away — but
 * it stops setting the stone's colour. A day survives overnight: something that broke while you
 * were asleep should still be showing when you sit down.
 */
export const ERROR_ALARM_MS = 24 * 60 * 60 * 1000

/**
 * Folders never worth suggesting as a project.
 *
 * Both are real work with no project home, made by the tools themselves:
 *
 *   - **Claude desktop scratch workspaces.** A throwaway directory per scratch chat, uuid and all.
 *   - **Codex chat folders.** Every Codex chat not opened on a folder gets
 *     `~/Documents/Codex/<date>/<slug of the first message>`; on the machine this was written on,
 *     twelve of them, with names like `i`, `l` and `lev`.
 *   - **The home directory itself.** A session run from `~` is a question asked in passing.
 *
 * They can still be connected by hand; they are just never offered.
 */
const SCRATCH_PATTERNS: ((projectPath: string) => boolean)[] = [
  (p) => p.includes('/Application Support/Claude/scratch-workspaces/'),
  (p) => /\/Documents\/Codex\/\d{4}-\d{2}-\d{2}\//.test(p),
  (p) => p === os.homedir(),
]

/** One runestone in the grove, with everything needed to draw it. */
export interface Runestone {
  /** Stable across scans: the project path. What saved positions key on. */
  id: string
  /** What is written on it. The folder name unless `grove.json` overrides it. */
  name: string
  /** Absolute project path. */
  path: string
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
  /**
   * Signs from this stone's sessions that the work may need checking, newest first, at most
   * three. Each is a flag with its reason, never a status: a stone with a tell is not "failed".
   */
  tells: Tell[]
  /**
   * The stone this one grew out of, when its folder sits inside another stone's folder. A sub-stone
   * stands further out than its parent and is joined to it, not to the tree.
   */
  parent?: string
  /** Parts of this project busy enough to be worth a stone of their own. See `splitsFor`. */
  splits: SplitSuggestion[]
}

/** A folder with agent work in it that is not a stone yet, offered when connecting a project. */
/**
 * A part of a project that could stand as its own sub-stone: a subfolder or a git worktree where
 * enough separate work happens. Offered, never made: one stone per project is the default.
 */
export interface SplitSuggestion {
  path: string
  name: string
  kind: 'folder' | 'worktree'
  sessionCount: number
}

export interface ProjectSuggestion {
  path: string
  name: string
  sessionCount: number
  lastActivityAt: number
}

export interface DerivedGrove {
  /** In the order you connected them. The scene keeps a stone's place by this order. */
  stones: Runestone[]
  /** Stones hidden by configuration. Reported so the interface can offer them back. */
  hidden: { path: string; name: string; sessionCount: number }[]
  /** Folders with sessions but no stone, busiest first, scratch folders left out. At most five. */
  suggestions: ProjectSuggestion[]
  /** Sessions outside every connected project: seen, counted, not drawn. */
  unconnectedSessions: number
  /** Totals over the sessions that are drawn, on stones. */
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
 * The configured folder a session belongs to: its own folder, or the nearest one above it.
 *
 * Nearest wins, so connecting both `~/Work` and `~/Work/site` gives `~/Work/site` its own
 * sessions rather than letting the parent swallow them. The separator is appended before
 * comparing, or `~/Work/site-old` would count as being inside `~/Work/site`.
 */
function owningConfig(paths: string[], configs: StoneConfig[]): StoneConfig | undefined {
  let best: StoneConfig | undefined
  for (const config of configs) {
    const inside = paths.some((each) => each && (each === config.path || each.startsWith(config.path + path.sep)))
    if (inside && (!best || config.path.length > best.path.length)) best = config
  }
  return best
}

/** Where a session works, most specific first: a worktree's own folder, then the project root. */
const placesOf = (session: Session): string[] => [session.cwd, session.projectPath].filter(Boolean)

/**
 * Parts of a stone big and separate enough to suggest as sub-stones.
 *
 * Adrian's example: a `Work` stone where the agents spend their time in two different places,
 * `Work/Data` and `Work/Presentations`. That is two projects sharing a folder, and each deserves its
 * own stone. The test, kept simple so it can be argued with:
 *
 *   - at least two parts (first-level subfolders, or git worktrees) with work in them,
 *   - each with at least four sessions,
 *   - each holding at least a fifth of the stone's sessions.
 *
 * One busy subfolder alone is not a split; it is just where the work is.
 */
const SPLIT_MIN_SESSIONS = 4
const SPLIT_MIN_SHARE = 0.2

export function splitsFor(stonePath: string, group: Session[], taken: Set<string>): SplitSuggestion[] {
  const parts = new Map<string, SplitSuggestion>()
  for (const session of group) {
    let part: { path: string; name: string; kind: SplitSuggestion['kind'] } | null = null
    if (session.worktree && session.cwd && session.cwd !== stonePath) {
      part = { path: session.cwd, name: session.worktree, kind: 'worktree' }
    } else {
      const where = session.cwd || session.projectPath
      if (where && where.startsWith(stonePath + path.sep)) {
        const first = where.slice(stonePath.length + 1).split(path.sep)[0]!
        part = { path: path.join(stonePath, first), name: first, kind: 'folder' }
      }
    }
    if (!part || taken.has(part.path)) continue
    const entry = parts.get(part.path) ?? { ...part, sessionCount: 0 }
    entry.sessionCount += 1
    parts.set(part.path, entry)
  }
  const big = [...parts.values()].filter(
    (part) => part.sessionCount >= SPLIT_MIN_SESSIONS && part.sessionCount >= group.length * SPLIT_MIN_SHARE
  )
  return big.length >= 2 ? big.sort((a, b) => b.sessionCount - a.sessionCount).slice(0, 4) : []
}

function buildStone(config: StoneConfig, group: Session[], now: number, configs: StoneConfig[]): Runestone {
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
    id: config.path,
    name: config.name || path.basename(config.path) || config.path,
    path: config.path,
    status,
    statusProvenance: weakest(deciding.map((session) => session.statusProvenance)),
    sessions: ordered,
    runningCount: statuses.filter((value) => value === 'running').length,
    attentionCount: ordered.filter((session) => wantsYou(session, now)).length,
    lastActivityAt: ordered[0]?.lastActivityAt ?? 0,
    runes: config.runes ?? [],
    tells: ordered
      .flatMap((session) => session.tells ?? [])
      .sort((a, b) => b.at - a.at)
      .slice(0, 3),
    parent: owningConfig([path.dirname(config.path)], configs.filter((other) => !other.hidden))?.path,
    splits: splitsFor(config.path, ordered, new Set(configs.map((other) => other.path))),
  }
}

/**
 * Derive the grove from the sessions on disk and the projects you have connected.
 *
 * `now` is passed in rather than read, so that the error-decay rule can be tested without
 * waiting a day.
 */
export function deriveStones(
  sessions: Session[],
  grove: GroveFile,
  now: number = Date.now()
): DerivedGrove {
  const bySession = new Map<StoneConfig, Session[]>()
  const unconnected = new Map<string, Session[]>()

  for (const session of sessions) {
    const config = owningConfig(placesOf(session), grove.stones)
    if (config) {
      const list = bySession.get(config) ?? []
      list.push(session)
      bySession.set(config, list)
    } else {
      const key = session.projectPath || ''
      const list = unconnected.get(key) ?? []
      list.push(session)
      unconnected.set(key, list)
    }
  }

  const stones: Runestone[] = []
  const hidden: DerivedGrove['hidden'] = []
  for (const config of grove.stones) {
    const group = bySession.get(config) ?? []
    if (config.hidden) {
      hidden.push({ path: config.path, name: config.name || path.basename(config.path), sessionCount: group.length })
    } else {
      // A connected project with no sessions yet is still a stone. It is yours; it stands.
      stones.push(buildStone(config, group, now, grove.stones))
    }
  }

  const suggestions = [...unconnected.entries()]
    .filter(([folder]) => folder && !SCRATCH_PATTERNS.some((isScratch) => isScratch(folder)))
    .map(([folder, group]) => ({
      path: folder,
      name: group[0]?.project || path.basename(folder),
      sessionCount: group.length,
      lastActivityAt: Math.max(...group.map((session) => session.lastActivityAt)),
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, 5)

  const drawn = stones.flatMap((stone) => stone.sessions)
  return {
    stones,
    hidden,
    suggestions,
    unconnectedSessions: [...unconnected.values()].reduce((total, group) => total + group.length, 0),
    totalSessions: drawn.length,
    runningSessions: drawn.filter((session) => session.status === 'running').length,
    attentionSessions: drawn.filter((session) => wantsYou(session, now)).length,
  }
}
