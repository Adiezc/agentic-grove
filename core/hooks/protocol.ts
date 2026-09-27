/**
 * What Claude Code sends when one of its hooks fires, and what the Grove keeps of it.
 *
 * A hook is a command Claude Code runs at a moment in a session's life, with a JSON description
 * of that moment on stdin. Ours is one line of `curl` that forwards the JSON to the Grove's
 * listener (see `install.ts`), so this file is the only place that needs to know the payload's
 * shape. The fields read here are the documented common ones; anything else is ignored rather
 * than trusted, since the payload grows between Claude Code releases.
 */

/** The moments the Grove listens for, and why each one earns a place. */
export const HOOK_EVENTS = [
  /** A session opened. Lets a brand-new session light its stone before its transcript exists. */
  'SessionStart',
  /** You sent a prompt: the turn is Claude's now. */
  'UserPromptSubmit',
  /** About to use a tool, and has just used one. The steady beat of a working session. */
  'PreToolUse',
  'PostToolUse',
  /** Wants permission, or has sat waiting for you. Nothing on disk records this at all. */
  'Notification',
  /** Finished its turn. The turn is back with you. */
  'Stop',
  /** The session closed. */
  'SessionEnd',
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

/** Tool events take a matcher (which tools); the others do not. `*` means every tool. */
export const TOOL_EVENTS: ReadonlySet<HookEvent> = new Set(['PreToolUse', 'PostToolUse'])

/**
 * Where the listener sits. Loopback only, so nothing off this Mac can reach it.
 *
 * A fixed port rather than a random one, because the port is written into Claude Code's settings
 * and a new one every launch would mean asking to rewrite them every launch.
 */
export const HOOK_HOST = '127.0.0.1'
export const HOOK_PORT = 47819

/** The path prefix that marks a hook as ours. `install.ts` finds and removes our entries by it. */
export const HOOK_PATH_MARK = '/agentic-grove/'

export type LiveStatus = 'running' | 'waiting' | 'idle'

/** One hook call, reduced to what the Grove uses. */
export interface HookCall {
  event: HookEvent
  /** Claude Code's own session id: the same one the scanner uses, minus its `claude-code:` prefix. */
  sessionId: string
  cwd: string
  /** For tool events, which tool. Kept for a future "what is it doing" readout; empty otherwise. */
  tool: string
  at: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Session ids are uuids. Anything else is not from Claude Code, or not a session worth tracking. */
const SESSION_ID = /^[0-9a-f-]{8,64}$/i

/** Read a hook payload, or return null for anything malformed. Never throws. */
export function parseHookCall(raw: unknown, now = Date.now()): HookCall | null {
  if (!isRecord(raw)) return null
  const event = str(raw.hook_event_name) as HookEvent
  if (!(HOOK_EVENTS as readonly string[]).includes(event)) return null
  const sessionId = str(raw.session_id)
  if (!SESSION_ID.test(sessionId)) return null
  return { event, sessionId, cwd: str(raw.cwd), tool: str(raw.tool_name), at: now }
}

/**
 * What each moment says about the session.
 *
 * `Stop` maps to `waiting`, matching the scanner: a finished turn means the turn is back with you,
 * which in the grove is the same state as a question asked. `Notification` is the one the scanner
 * can never see, since a permission prompt writes nothing to the transcript.
 */
export function statusAfter(event: HookEvent): LiveStatus {
  switch (event) {
    case 'Notification':
    case 'Stop':
      return 'waiting'
    case 'SessionEnd':
      return 'idle'
    default:
      return 'running'
  }
}
