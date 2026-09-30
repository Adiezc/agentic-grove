/**
 * Harness-agnostic session scanning — the poll half of the Grove's three data paths.
 *
 * Ported from Station-Sciences/bot-crossing's `server/scan.mjs` (MIT) — see
 * ./harnesses/LICENSE-bot-crossing.
 *
 * This module knows nothing about any particular tool. It asks every harness present on the
 * machine for its sessions, stamps each one with where it came from, and hands back a single
 * list sorted by recency. Everything tool-specific lives in `./harnesses/`.
 *
 * It is the baseline truth for the whole app: hooks (session 6) make the grove feel instant, but
 * a poll is what makes it *correct*, including for sessions the Grove did not start and knows
 * nothing about.
 */
import type { OpenResult, Session } from './harnesses/types.ts'
import { HARNESSES, detectedHarnesses, harnessById } from './harnesses/index.ts'

/**
 * A runestone is keyed on a project's name, and a name is the last segment of its path — so two
 * checkouts of the same repository, `~/work/1/foo` and `~/work/2/foo`, are both "foo". Left
 * alone they would share one stone and their sessions would be indistinguishable, which is wrong
 * for anyone keeping parallel copies instead of using worktrees.
 *
 * Where a name is ambiguous, grow it leftward along the path until it is not: `1/foo` and
 * `2/foo`. **Only names that actually collide are touched**, and that restraint is the point —
 * the name is also the key a stone's saved position will be stored under, so disambiguating
 * unconditionally would move every stone in everybody's grove to fix something most people
 * never hit.
 */
function disambiguateProjects(sessions: Session[]): Session[] {
  const pathsByName = new Map<string, Set<string>>()
  for (const session of sessions) {
    if (!session.project) continue
    const paths = pathsByName.get(session.project) ?? new Set<string>()
    paths.add(session.projectPath)
    pathsByName.set(session.project, paths)
  }

  // Keyed on name plus path, joined by a newline — the one character a filesystem path cannot
  // contain, so two different pairs can never collide into one key.
  const key = (name: string, projectPath: string) => `${name}\n${projectPath}`
  const renames = new Map<string, string>()

  for (const [name, pathSet] of pathsByName) {
    if (pathSet.size < 2) continue
    const paths = [...pathSet]
    const segments = paths.map((p) => p.split('/').filter(Boolean))
    const deepest = Math.max(...segments.map((s) => s.length))

    // Take one more trailing segment until every path in the group reads differently. Paths that
    // differ at all must separate by `deepest`, so this always terminates. A session with no
    // path at all cannot be told apart by one, so it keeps the bare name and the others move
    // around it.
    const labelAt = (segs: string[], depth: number) => (segs.length ? segs.slice(-depth).join('/') : name)
    let depth = 1
    let labels = segments.map((segs) => labelAt(segs, depth))
    while (new Set(labels).size < paths.length && depth < deepest) {
      depth += 1
      labels = segments.map((segs) => labelAt(segs, depth))
    }
    paths.forEach((projectPath, i) => {
      const label = labels[i]
      if (label) renames.set(key(name, projectPath), label)
    })
  }

  if (!renames.size) return sessions
  return sessions.map((session) => {
    const next = renames.get(key(session.project, session.projectPath))
    return next && next !== session.project ? { ...session, project: next } : session
  })
}

/** What went wrong during a scan, without any of it being fatal. */
export interface ScanProblem {
  harness: string
  message: string
}

export interface HarnessStatus {
  id: string
  name: string
  detected: boolean
  /** Anything the adapter wants to say about why it might look thin. Usually empty. */
  diagnostic: string
}

export interface ScanResult {
  sessions: Session[]
  harnesses: HarnessStatus[]
  problems: ScanProblem[]
  /** How long the whole pass took. Worth watching: this runs on a timer, all day. */
  durationMs: number
}

/**
 * Every session from every detected harness.
 *
 * A harness that throws is skipped rather than allowed to take the scan down with it: one broken
 * adapter should cost you that tool's sessions, not the whole grove. The failure is collected
 * and returned rather than only logged, because a scan that silently returns half the truth is
 * worse than one that says which half is missing.
 */
export async function scan(): Promise<ScanResult> {
  const startedAt = Date.now()
  const detected = await detectedHarnesses()
  const problems: ScanProblem[] = []

  const lists = await Promise.all(
    detected.map(async (harness) => {
      try {
        const sessions = await harness.scanSessions()
        // The adapter leaves these blank; filling them in here is what keeps an adapter from
        // having to know its own name twice.
        return sessions.map((session) => ({
          ...session,
          harness: harness.id,
          harnessName: harness.name,
        }))
      } catch (error) {
        problems.push({
          harness: harness.id,
          message: error instanceof Error ? error.message : String(error),
        })
        return []
      }
    })
  )

  const sessions = disambiguateProjects(lists.flat())
  sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt)

  const detectedIds = new Set(detected.map((harness) => harness.id))
  const harnesses = await Promise.all(
    HARNESSES.map(async (harness) => ({
      id: harness.id,
      name: harness.name,
      detected: detectedIds.has(harness.id),
      diagnostic: harness.diagnostic ? await harness.diagnostic().catch(() => '') : '',
    }))
  )

  return { sessions, harnesses, problems, durationMs: Date.now() - startedAt }
}

/**
 * Poll on a timer until stopped.
 *
 * Deliberately *not* a `setInterval`: a scan takes as long as the disk takes, and an interval
 * would start the next pass before the last had finished whenever a very large transcript or a
 * busy disk made one slow. Waiting `intervalMs` *after* each pass means the loop can never pile
 * up on itself, at the cost of the period drifting by however long a scan takes — which nobody
 * can see, and a pile-up everybody would.
 *
 * `onResult` is called after every pass, including the first, which happens immediately.
 */
export function startScanLoop(onResult: (result: ScanResult) => void, intervalMs = 5000): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      const result = await scan()
      // Stopped while that pass was reading the disk: its answer belongs to a loop nobody is
      // listening to any more, and publishing it could put older data over newer.
      if (!stopped) onResult(result)
    } catch (error) {
      // scan() catches per-harness failures itself, so arriving here means something broke in
      // the loop rather than in an adapter. Report it and keep polling: the next pass may well
      // succeed, and a silently dead loop looks exactly like a machine with no agents on it.
      console.error('agentic-grove: scan pass failed —', error)
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }

  void tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

const dispatch = (harnessId: string) => {
  const harness = harnessById(harnessId)
  if (!harness) throw new Error(`Unknown harness "${harnessId}"`)
  return harness
}

/** Hand a session back to the tool it belongs to. Both may be async. */
export const openSession = async (
  harnessId: string,
  ref: Record<string, unknown>
): Promise<OpenResult> => dispatch(harnessId).openSession(ref)

export const newSession = async (harnessId: string, dir: string): Promise<OpenResult> =>
  dispatch(harnessId).newSession(dir)
