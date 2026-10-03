/**
 * What the hooks have said about each session, laid over what the scanner read from disk.
 *
 * The scan stays the baseline truth; this only corrects it where the hooks know better and more
 * recently. Two rules keep it from lying:
 *
 *   1. **Newer news wins.** If the transcript was written well after the last hook call, the disk
 *      is describing something the hooks missed (the Grove was closed, say), so the scan stands.
 *   2. **"Running" goes stale.** A session that crashes sends no `SessionEnd`, and its last hook
 *      said "running". After two minutes of silence, a scan that disagrees is believed instead.
 *
 * In memory only. Hook state describes the last few minutes, and after a restart the scan is a
 * better answer than anything remembered from before it.
 */
import type { Session } from '../harnesses/types.ts'
import { type HookCall, type LiveStatus, SUBAGENT_EVENTS, statusAfter } from './protocol.ts'

/** How much newer the transcript must be before the scan overrules a hook. Covers write lag. */
const DISK_WINS_AFTER_MS = 10_000
/** How long "running" is trusted with no further calls, when the scan says otherwise. */
const RUNNING_GOES_STALE_MS = 120_000
/** Ended sessions are forgotten after this, so the map cannot grow for ever. */
const FORGET_AFTER_MS = 60 * 60_000

interface Entry {
  status: LiveStatus
  at: number
}

export class LiveState {
  private readonly sessions = new Map<string, Entry>()
  /** When the last call of any kind arrived. The settings panel shows it as "heard from". */
  lastCallAt = 0

  /** Record a call. Returns true when it changed a session's status, so a redraw is worth it. */
  record(call: HookCall): boolean {
    this.lastCallAt = call.at
    // A worker starting or stopping is not news about the session itself: a background worker
    // can finish long after the session's own turn ended.
    if (SUBAGENT_EVENTS.has(call.event)) return false
    const status = statusAfter(call.event)
    const previous = this.sessions.get(call.sessionId)
    this.sessions.set(call.sessionId, { status, at: call.at })
    this.forgetOld(call.at)
    return previous?.status !== status
  }

  /** The scan's sessions, with each Claude Code one corrected by its hooks where they know better. */
  apply(sessions: Session[], now = Date.now()): Session[] {
    if (this.sessions.size === 0) return sessions
    return sessions.map((session) => {
      if (session.harness !== 'claude-code') return session
      const entry = this.sessions.get(session.id.replace(/^claude-code:/, ''))
      if (!entry) return session
      if (session.lastActivityAt - entry.at > DISK_WINS_AFTER_MS) return session
      if (entry.status === 'running' && now - entry.at > RUNNING_GOES_STALE_MS && session.status !== 'running') {
        return session
      }
      // `official`: Claude Code told us this itself, which is the strongest thing we can know.
      return { ...session, status: entry.status, statusProvenance: 'official' }
    })
  }

  private forgetOld(now: number): void {
    for (const [id, entry] of this.sessions) {
      if (now - entry.at > FORGET_AFTER_MS) this.sessions.delete(id)
    }
  }
}
