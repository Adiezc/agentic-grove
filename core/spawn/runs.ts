/**
 * Runs: the work the Grove itself started, as opposed to sessions it merely watches.
 *
 * The scan sees every session on the Mac. A run is narrower and says more: *you* sent *this agent*
 * to *this stone* with *this task*, at this time, and here is what became of it. That difference is
 * what the 30 September review asked for ("distinguish observed external sessions from runs owned
 * by Grove"), and it is why runs live in their own file rather than in `grove.json`:
 *
 *   - `grove.json` is intent you may edit by hand. Runs are history the Grove writes as things
 *     happen, several times a minute while an agent works. Mixing the two would mean every hook
 *     call rewriting a file you might have open in an editor.
 *   - A run has to survive the Grove quitting, so that reopening it can still say "Builder is
 *     working on Shellter" about a Terminal window that stayed open.
 *
 * **How a run learns what is happening.** The Grove starts Claude Code with a session id it chose
 * itself (`claude --session-id`), so every hook call and every transcript for that session can be
 * matched to the run exactly, with no guessing by folder and time. Codex has no such flag and no
 * hooks, so a Codex run is matched to the first new Codex session in its folder, and says so.
 *
 * **States**, and the one rule about them: a run only moves forward on evidence.
 *
 *   starting  Terminal was asked to open. Nothing has confirmed a session exists yet.
 *   running   The agent is working: a hook said so, or the scan saw its transcript move.
 *   waiting   It needs you: a permission prompt or a question. Amber, like everywhere else.
 *   finished  It finished its turn. The work is there to look at; you may give it more.
 *   ended     The session closed (you quit Claude Code or closed the window).
 *   failed    It never started: the command is missing, Terminal would not open, or nothing
 *             appeared for so long that saying "starting" any longer would be a lie.
 *
 * A finished or ended run can come back to `running` when you type more, or resume it. A failed one
 * never does; resuming makes a new attempt visible as its own state change, not a quiet rewrite.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Session } from '../harnesses/types.ts'
import type { HookCall } from '../hooks/protocol.ts'
import { groveHome } from '../state/grove.ts'

export type RunHarness = 'claude-code' | 'codex'
export type RunState = 'starting' | 'running' | 'waiting' | 'finished' | 'ended' | 'failed'

export interface Run {
  /** The Grove's id for the run. For Claude Code it is also the session id, chosen before launch. */
  id: string
  harness: RunHarness
  agentId: string
  /** Kept as it was at launch, so a run still reads right after its agent is renamed or removed. */
  agentName: string
  /** The stone's id, which is the project folder's path. */
  stoneId: string
  /** The task as typed. Empty means Claude Code was opened in the folder with nothing to do yet. */
  task: string
  createdAt: number
  /** When the state last changed. */
  updatedAt: number
  state: RunState
  /**
   * The harness's own session id, once a session has been *seen*. For Claude Code this equals `id`
   * but stays empty until a hook or the scan confirms it; for Codex it is whatever the match found.
   */
  sessionId: string
  /** Why it failed, in words a person can act on. */
  error?: string
  /** PM runs: each worker's name in the session (`researcher`) and the agent it is on the tree. */
  team?: Record<string, string>
  /**
   * PM runs: the workers busy right now, by Claude Code's id for each subagent, as tree agent ids.
   * Drawn as their orbs above the stone. Live only: emptied when the session ends or the Grove restarts.
   */
  helping?: Record<string, string>
}

/** How long a run may say "starting" before that stops being believable. Covers a folder-trust prompt left unanswered. */
const GIVE_UP_AFTER_MS = 15 * 60_000
/** A Codex session this much older than the launch cannot be the one it started. Covers clock and write lag. */
const CODEX_MATCH_SLACK_MS = 5_000
/** Old runs are dropped past this many, newest kept. History, not an archive. */
const KEEP_RUNS = 200

export const runsPath = (): string => path.join(groveHome(), 'runs.json')

/**
 * What a hook moment means for a run. Differs from `statusAfter` in `hooks/protocol.ts` in one
 * place on purpose: for a stone, a finished turn and a question both mean "back with you"; for a
 * run you sent, "finished" and "needs you" are different news, and the hooks can tell them apart.
 */
function stateAfter(event: HookCall['event']): RunState {
  switch (event) {
    case 'Notification':
      return 'waiting'
    case 'Stop':
      return 'finished'
    case 'SessionEnd':
      return 'ended'
    default:
      return 'running'
  }
}

/** The same question answered from the scan, for when hooks are off. It cannot see "needs you" versus "finished". */
function stateFromScan(session: Session): RunState | null {
  switch (session.status) {
    case 'running':
      return 'running'
    case 'waiting':
      return 'finished'
    default:
      // Idle or errored says nothing new about a run the scan has only just found; keep what we had.
      return null
  }
}

export class RunBook {
  private runs: Run[] = []
  /**
   * Every save goes through this chain, one at a time, each writing the whole current list. The
   * review found `grove.json` losing updates when two saves overlapped; runs change far more
   * often, so they get the ordered queue from the start rather than after the same bug.
   */
  private saving: Promise<void> = Promise.resolve()
  /**
   * Runs a hook has spoken for since the Grove started. The scan cannot tell "needs you" from
   * "finished", so once the hooks are heard for a run, the scan is only allowed to confirm it
   * exists, never to overrule them. In memory: after a restart the scan leads until the next call.
   */
  private readonly heard = new Set<string>()
  /**
   * Told about every state change, with the state left and when it began. The attention rules in
   * `core/attention.ts` decide from this whether a change is worth a notification.
   */
  onStateChange: ((run: Run, from: RunState, since: number) => void) | null = null

  constructor(private readonly file = runsPath()) {}

  /** Read the file. A missing or unreadable file is an empty history, never a reason not to start. */
  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await fsp.readFile(this.file, 'utf8'))
      const list = typeof raw === 'object' && raw !== null ? (raw as { runs?: unknown }).runs : undefined
      // Who was helping belongs to sessions that may be long gone; the hooks will say again.
      this.runs = Array.isArray(list) ? list.filter(isRun).map(({ helping: _gone, ...run }) => run) : []
    } catch {
      this.runs = []
    }
  }

  /** Newest first. A copy, so nobody outside can change a run without going through here. */
  list(): Run[] {
    return [...this.runs].sort((a, b) => b.createdAt - a.createdAt).map((run) => ({ ...run }))
  }

  get(id: string): Run | undefined {
    const run = this.runs.find((each) => each.id === id)
    return run ? { ...run } : undefined
  }

  /** Record a launch about to happen. The id is made here so it can be handed to `claude --session-id`. */
  create(fields: Pick<Run, 'harness' | 'agentId' | 'agentName' | 'stoneId' | 'task' | 'team'>, now = Date.now()): Run {
    const run: Run = { ...fields, id: randomUUID(), createdAt: now, updatedAt: now, state: 'starting', sessionId: '' }
    this.runs.push(run)
    this.runs = this.list().slice(0, KEEP_RUNS)
    this.save()
    return { ...run }
  }

  fail(id: string, error: string, now = Date.now()): void {
    this.change(id, { state: 'failed', error }, now)
  }

  /** Resuming reopens the same session, so the run starts over from "starting" until it is seen again. */
  resumed(id: string, now = Date.now()): void {
    this.change(id, { state: 'starting', error: undefined }, now)
  }

  /** A hook call for one of our Claude Code sessions. Returns true when a run changed. */
  onHook(call: HookCall): boolean {
    const run = this.runs.find((each) => each.harness === 'claude-code' && each.id === call.sessionId)
    if (!run || run.state === 'failed') return false
    this.heard.add(run.id)
    if (call.event === 'SubagentStart' || call.event === 'SubagentStop') return this.onWorker(run, call)
    if (call.event === 'SessionEnd' && run.helping) this.change(run.id, { helping: undefined }, call.at)
    // Claude Code's "waiting for your input" reminder arrives a minute after every finished turn.
    // It is not a question, so a finished run stays finished rather than turning amber.
    if (call.idle) return false
    return this.change(run.id, { state: stateAfter(call.event), sessionId: call.sessionId }, call.at)
  }

  /**
   * A worker of a PM run started or stopped. Only workers on its team are shown, since only they
   * have an orb; Claude Code's own helpers (Explore, Plan) do their job unseen. The run's own state
   * is left alone: a background worker can finish after the run's turn has.
   */
  private onWorker(run: Run, call: HookCall): boolean {
    if (!call.agentId) return false
    const helping = { ...run.helping }
    if (call.event === 'SubagentStart') {
      const agent = run.team?.[call.agentType]
      if (!agent) return false
      helping[call.agentId] = agent
    } else {
      if (!(call.agentId in helping)) return false
      delete helping[call.agentId]
    }
    return this.change(run.id, { helping: Object.keys(helping).length ? helping : undefined }, call.at)
  }

  /**
   * Fold a scan in: confirm runs whose session has appeared, give Codex runs their session, and
   * give up on runs that never started. Returns true when anything changed.
   */
  onScan(sessions: Session[], now = Date.now()): boolean {
    let changed = false
    const claimed = new Set(this.runs.map((run) => run.sessionId).filter(Boolean))
    // Oldest first, so when two Codex runs wait in one folder the earlier launch takes the earlier session.
    for (const run of [...this.runs].sort((a, b) => a.createdAt - b.createdAt)) {
      if (run.state === 'failed') continue
      const session = this.findSession(run, sessions, claimed)
      if (session) {
        const id = session.id.slice(session.id.indexOf(':') + 1)
        claimed.add(id)
        // A first sighting always confirms the run. After that the scan moves it only while no
        // hook has spoken for it, because the hooks know "needs you" apart from "finished".
        const fromScan = this.heard.has(run.id) ? null : stateFromScan(session)
        const next = run.sessionId ? fromScan : (fromScan ?? (run.state === 'starting' ? 'running' : null))
        if (next && next !== run.state) changed = this.change(run.id, { state: next, sessionId: id }, now) || changed
        else if (!run.sessionId) changed = this.change(run.id, { sessionId: id }, now) || changed
      } else if (run.state === 'starting' && now - run.updatedAt > GIVE_UP_AFTER_MS) {
        this.fail(run.id, 'No session appeared. Was the Terminal window closed before it started?', now)
        changed = true
      }
    }
    return changed
  }

  private findSession(run: Run, sessions: Session[], claimed: Set<string>): Session | undefined {
    if (run.harness === 'claude-code') return sessions.find((session) => session.id === `claude-code:${run.id}`)
    if (run.sessionId) return sessions.find((session) => session.id === `codex:${run.sessionId}`)
    // Codex cannot be told which id to use, so the best honest match is the oldest Codex session
    // started in this folder after the launch that no other run has already taken.
    return sessions
      .filter(
        (session) =>
          session.harness === 'codex' &&
          session.createdAt >= run.createdAt - CODEX_MATCH_SLACK_MS &&
          (session.cwd === run.stoneId || session.cwd.startsWith(run.stoneId + path.sep)) &&
          !claimed.has(session.id.slice(session.id.indexOf(':') + 1))
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0]
  }

  private change(id: string, patch: Partial<Run>, now: number): boolean {
    const run = this.runs.find((each) => each.id === id)
    if (!run) return false
    const stateChanged = patch.state !== undefined && patch.state !== run.state
    const idChanged = patch.sessionId !== undefined && patch.sessionId !== run.sessionId
    const errorChanged = 'error' in patch && patch.error !== run.error
    const helpingChanged = 'helping' in patch && JSON.stringify(patch.helping ?? {}) !== JSON.stringify(run.helping ?? {})
    if (!stateChanged && !idChanged && !errorChanged && !helpingChanged) return false
    const from = run.state
    const since = run.updatedAt
    Object.assign(run, patch)
    if (patch.error === undefined && 'error' in patch) delete run.error
    if (patch.helping === undefined && 'helping' in patch) delete run.helping
    if (stateChanged) run.updatedAt = now
    this.save()
    if (stateChanged) this.onStateChange?.({ ...run }, from, since)
    return true
  }

  /** Queue a write of the whole list. Never throws: a failed save costs history, not the app. */
  private save(): void {
    const text = JSON.stringify({ runs: this.list() }, null, 2) + '\n'
    this.saving = this.saving.then(() => writeAtomically(this.file, text)).catch((error: unknown) => {
      console.warn(`agentic-grove: could not save runs: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** Resolves once every queued save has landed. For tests, and for quitting cleanly. */
  flushed(): Promise<void> {
    return this.saving
  }
}

/** Write through a uniquely named temporary file, so no two writes can ever share one. */
async function writeAtomically(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporary, text, 'utf8')
    await fsp.rename(temporary, file)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

const RUN_STATES: readonly RunState[] = ['starting', 'running', 'waiting', 'finished', 'ended', 'failed']

/** Anything malformed in the file is dropped rather than trusted. */
function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Record<string, unknown>
  return (
    typeof run.id === 'string' &&
    (run.harness === 'claude-code' || run.harness === 'codex') &&
    typeof run.agentId === 'string' &&
    typeof run.agentName === 'string' &&
    typeof run.stoneId === 'string' &&
    typeof run.task === 'string' &&
    typeof run.createdAt === 'number' &&
    typeof run.updatedAt === 'number' &&
    typeof run.sessionId === 'string' &&
    RUN_STATES.includes(run.state as RunState)
  )
}
