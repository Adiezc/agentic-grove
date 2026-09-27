/**
 * The shape every harness adapter hands back, and the interface each one implements.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing. Its `Thread`
 * is our `Session`; ./README.md carries the field-by-field mapping between the two.
 *
 * Nothing outside `core/harnesses/` should need to know what a Claude session id or a Codex
 * rollout path looks like. That is the whole job of this file: one shape, so the scan loop, the
 * interface and eventually the grove scene can be written once rather than per tool.
 */

/**
 * How much we actually know about a claim, rather than how confident we would like to sound.
 *
 * Principle two of this project is "never invent a number", and this type is how that survives
 * contact with code. A session's status is not a fact we are given — it is inferred from files
 * on disk, and the strength of that inference varies:
 *
 * - `measured`  — we tested something real. A pid we signalled and got an answer from.
 * - `inferred`  — a defensible reading of file contents and timestamps. Usually right.
 * - `unknown`   — the harness records nothing that answers this. Not the same as "no".
 *
 * `official` is reserved for figures a provider tells us outright, which so far means Claude's
 * rate limits via the statusline hook. Nothing in the poll layer earns it.
 */
export type Provenance = 'official' | 'measured' | 'inferred' | 'unknown'

/**
 * What a session is doing, as far as can honestly be told from disk.
 *
 * `waiting` is the one worth understanding, and it is bot-crossing's best idea. A live process
 * is not the same as work in progress: the CLI holds its process open while sitting at the
 * prompt, so a session that finished four minutes ago and asked you a question looks exactly
 * like one grinding away. The difference is in the tail of the transcript — whether the last
 * assistant message called a tool (mid-turn, so `running`) or called nothing (the turn is back
 * with you, so `waiting`).
 *
 * For the grove these are different colours entirely: `running` is a stone lit from within,
 * `waiting` is a stone that has sent up a mote asking for you.
 */
export type SessionStatus = 'running' | 'waiting' | 'idle' | 'errored'

/**
 * A sign that a session's work may be worth a second look: repeated failures, an edit undone,
 * a turn that ended on an error. A flag, never a verdict; `detail` says what triggered it so a
 * person can judge it. Adapters that cannot tell simply leave `tells` off.
 */
export interface Tell {
  kind: 'repeated-failure' | 'undone-edit' | 'ended-on-error'
  /** Epoch ms of the record that triggered it. */
  at: number
  /** One plain sentence, such as "Bash failed 3 times in a row". */
  detail: string
}

/** One agent session, from any tool. Epoch-millisecond timestamps throughout. */
export interface Session {
  /**
   * Unique across every harness, and stable across scans — prefixed with the harness id, so
   * `claude-code:3f2a…`. Anything the Grove remembers about a session (a hidden stone, a saved
   * position) is keyed on this string, so two harnesses handing back the same id would merge
   * two unrelated sessions into one.
   */
  id: string
  /** Which adapter produced this. Filled in by the scan loop, not by the adapter. */
  harness: string
  /** What a person sees for that harness: "Claude Code", "Codex". */
  harnessName: string

  /** Session title, or `'Untitled session'` where the harness records none. */
  title: string
  /** The first prompt, trimmed. What the session is actually about. */
  preview: string

  /** Folder name — this is what claims a runestone in the grove. */
  project: string
  /** Absolute path to the project root. */
  projectPath: string
  /** Git worktree name, or `''` where there is none or the harness has no concept of one. */
  worktree: string
  /** Where the session is actually working — the worktree, not the repo root. */
  cwd: string
  /** Branch name, or `''`. */
  gitBranch: string

  /** Model name as the harness recorded it, or `''`. Never guessed. */
  model: string
  /** Reasoning effort where the harness records one, or `''`. */
  effort: string

  createdAt: number
  /** Sorts everything, and drives how a neglected stone dims over weeks. */
  lastActivityAt: number
  /** When you last looked at it. `0` where the harness keeps no focus history. */
  lastFocusedAt: number

  status: SessionStatus
  /** How much to trust `status`. See {@link Provenance}. */
  statusProvenance: Provenance
  /** Moved on since you last looked. `false` where unknowable — see `unreadProvenance`. */
  unread: boolean
  unreadProvenance: Provenance

  /** Transcript size in bytes. A rough proxy for how much work a session represents. */
  sizeBytes: number
  /** Archived in the harness's own records. Read-only: reporting it is all an adapter does. */
  archived: boolean
  /** Adapter bookkeeping — the Claude adapter uses `desktop` / `cli`. Free-form. */
  source: string

  /** Signs the work may need checking, newest last. Absent where the adapter cannot tell. */
  tells?: Tell[]

  /** Whether this session can be handed back to its own tool. The UI greys the button out. */
  canOpen: boolean
  /**
   * Opaque. Whatever the adapter needs to find this session again — and nothing between the
   * adapter and the button ever looks inside it.
   *
   * Keep it small and serialisable: it makes a round trip through JSON on every action, so no
   * file handles, no class instances, and never a secret.
   */
  ref: Record<string, unknown>
}

/** What `openThread`-style calls hand back. A URL the OS opener can resolve, or a reason why not. */
export type OpenResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * A harness is any tool that runs agent sessions we want to see.
 *
 * Adding support for one is meant to be **one new file in this directory plus one line in
 * `index.ts`**. If landing a harness means editing `core/scan.ts`, that is a bug in this seam
 * and worth saying so, because the next person will hit it too.
 */
export interface HarnessAdapter {
  /** Stable, kebab-case, used as a key and as an id prefix. Never change it after release. */
  id: string
  /** What a person sees. */
  name: string

  /**
   * Is this harness on this machine at all? Usually just "does its data directory exist".
   * Must be cheap: it runs on every scan, so that installing a tool while the Grove is open is
   * noticed on the next poll rather than at the next restart.
   */
  detect(): Promise<boolean>

  /**
   * The real work: one `Session` per session the harness knows about.
   *
   * Throwing is survivable — the scan loop logs it and carries on with the other harnesses, so
   * one broken adapter costs its own sessions and nothing else. Prefer throwing over returning
   * something invented.
   */
  scanSessions(): Promise<Session[]>

  /** Hand a session back to its own tool. */
  openSession(ref: Record<string, unknown>): Promise<OpenResult> | OpenResult

  /** Start a fresh session in a directory, in that tool. */
  newSession(dir: string): Promise<OpenResult> | OpenResult

  /**
   * Optional. Why a harness that is plainly installed might still look thin — an unreadable
   * database, a store version we do not understand. Without somewhere to say it, that failure
   * is invisible: sessions quietly lose their titles and nothing explains why.
   */
  diagnostic?(): Promise<string>

  /** Where this adapter looks. Printed by the scan command so the paths are checkable. */
  paths: Record<string, string>
}
