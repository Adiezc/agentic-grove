/**
 * Harness adapter: Claude Code — the desktop app and the CLI together.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing. Its Windows and
 * Linux paths are deliberately not here; see DECISIONS.md, "macOS only means the Windows and
 * Linux branches go".
 *
 * Everything that knows the shape of Claude Code's own files lives in this one module. The scan
 * loop never reaches past the adapter interface, so adding another tool means writing a sibling
 * of this file rather than editing the scanner. The contract is in ./README.md.
 *
 * **Read-only, without exception.** Nothing here writes to Claude Code's files.
 *
 * Two stores, deliberately merged rather than picked between:
 *   - the desktop app keeps one JSON record per session — title, cwd, model, timestamps
 *   - the CLI keeps the raw transcript, which is the only source for terminal-started work
 *
 * Reading only the first loses every session started from a terminal. Reading only the second
 * means reconstructing metadata the app already has correct.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readTells } from './claude-tells.ts'
import type { HarnessAdapter, OpenResult, Provenance, Session, SessionStatus, Tell } from './types.ts'
import {
  exists,
  isRecord,
  jsonLines,
  listDirs,
  listFiles,
  num,
  readHead,
  readJsonFile,
  readTail,
  str,
} from './fsutil.ts'

const HOME = os.homedir()

/** One JSON record per session, written by the desktop app. */
const DESKTOP_SESSIONS = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
/** Raw CLI transcripts: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl */
const CLI_PROJECTS = path.join(HOME, '.claude', 'projects')
/** One file per live CLI process: { pid, sessionId, cwd, … }. Stale files outlive their pid. */
const CLI_LIVE = path.join(HOME, '.claude', 'sessions')

/** Enough of a transcript's head to hold its metadata records, and no more. */
const HEAD_BYTES = 192 * 1024
/** How much of a transcript's end it takes to see whose turn it is. One record is plenty. */
const TAIL_BYTES = 64 * 1024

/**
 * How recently a session must have done something to count as active now.
 *
 * A live process on its own is not enough: the desktop app pre-warms idle sessions, so sessions
 * untouched for days still hold a process. Measured against real data by bot-crossing, the
 * warmed ones sat 16 hours to 3 days idle while genuinely active work was minutes old.
 */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

/**
 * A desktop record with no transcript, no title and no live process is not a conversation —
 * it is the app's own bookkeeping. This grace period keeps a genuinely new session, opened
 * seconds ago with nothing written yet, from being mistaken for one.
 */
const NEW_SESSION_MS = 10 * 60 * 1000

/** Ids are prefixed so they stay unique across harnesses. See `Session.id`. */
const ID = (raw: string) => `claude-code:${raw}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DESKTOP_ID = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The `typeof` check matters wherever an id came back from the interface: `RegExp.test`
// stringifies its argument, so a one-element array holding a valid id would pass the pattern
// and then travel on as an array.
const isCliId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const isDesktopId = (v: unknown): v is string => typeof v === 'string' && DESKTOP_ID.test(v)

/* -------------------------------------------------------------------------------------------
 * Reading a transcript
 * ---------------------------------------------------------------------------------------- */

/** The first readable text out of a message `content`, which may be a string or a parts array. */
function firstText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  for (const part of content) {
    if (typeof part === 'string') return part
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') return part.text
  }
  return ''
}

/**
 * Strip the `<system-reminder>` and `<command-…>` wrappers the CLI puts around prompts.
 *
 * Without this the preview of half the sessions in the grove is machinery rather than anything
 * a person typed.
 */
function cleanPrompt(value: string): string {
  return value
    .replace(/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface TranscriptMeta {
  customTitle: string
  aiTitle: string
  summary: string
  firstPrompt: string
  cwd: string
  gitBranch: string
  startedAt: number
}

/**
 * Whatever a transcript knows about itself.
 *
 * The title fields are kept separate rather than collapsed here because the precedence —
 * custom, then AI-generated, then summary, then first prompt — is Claude Code's own, and
 * mirroring it means a session is called the same thing in the grove as in the app it came from.
 */
function readTranscriptMeta(records: unknown[]): TranscriptMeta {
  const meta: TranscriptMeta = {
    customTitle: '',
    aiTitle: '',
    summary: '',
    firstPrompt: '',
    cwd: '',
    gitBranch: '',
    startedAt: 0,
  }
  for (const record of records) {
    if (!isRecord(record)) continue
    if (!meta.customTitle) meta.customTitle = str(record.customTitle)
    if (!meta.aiTitle) meta.aiTitle = str(record.aiTitle)
    if (!meta.summary && record.type === 'summary') meta.summary = str(record.summary)
    if (!meta.cwd) meta.cwd = str(record.cwd)
    // 'HEAD' is a detached checkout rather than a branch name, and putting it on a stone would
    // read as a branch called HEAD.
    if (!meta.gitBranch && str(record.gitBranch) !== 'HEAD') meta.gitBranch = str(record.gitBranch)
    if (!meta.startedAt && record.timestamp) {
      const parsed = Date.parse(str(record.timestamp))
      if (!Number.isNaN(parsed)) meta.startedAt = parsed
    }
    if (!meta.firstPrompt && record.type === 'user' && isRecord(record.message)) {
      const text = cleanPrompt(firstText(record.message.content))
      // A prompt that still begins with a tag after cleaning is all machinery.
      if (text && !text.startsWith('<')) meta.firstPrompt = text
    }
  }
  return meta
}

/**
 * Whether a transcript ends with the turn handed back to you.
 *
 * This is the single best idea in bot-crossing's adapter and the reason `waiting` exists as a
 * status. A live process is not the same thing as work in progress: the CLI holds its process
 * open while it sits at the prompt, so "the pid exists and the file moved recently" marks a
 * session that finished four minutes ago and asked you a question as *working*.
 *
 * The transcript says which it is. A last assistant message that called a tool is mid-turn; one
 * that called nothing has handed the turn back and the reply is yours. `stop_reason` alone will
 * not do — it is `end_turn` on a main session's last message and empty on some others — so what
 * the message *called* is the half worth testing.
 *
 * Only sessions that could plausibly be running pay for this, so it costs one small read each.
 */
async function awaitingReply(file: string): Promise<boolean> {
  let records: unknown[]
  try {
    records = jsonLines(await readTail(file, TAIL_BYTES))
  } catch {
    return false
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (!isRecord(record)) continue
    // A user turn, a tool result or an attachment all mean the model speaks next — whatever the
    // process is doing, it is not waiting on anyone.
    if (record.type === 'user') return false
    if (record.type !== 'assistant') continue
    const message = isRecord(record.message) ? record.message : null
    const content = message?.content
    const calling = Array.isArray(content) && content.some((c) => isRecord(c) && c.type === 'tool_use')
    return !calling && message?.stop_reason !== 'tool_use'
  }
  return false
}

/* -------------------------------------------------------------------------------------------
 * Finding the files
 * ---------------------------------------------------------------------------------------- */

interface TranscriptEntry {
  id: string
  file: string
  projectDir: string
  size: number
  mtime: number
}

/**
 * Index every CLI transcript on disk, keyed by session id.
 *
 * **One level deep, deliberately.** Claude Code keeps subagent transcripts in a nested folder,
 * `<project>/<parentSessionId>/subagents/agent-*.jsonl`, and those are not conversations anybody
 * had — they are the machinery of one session, each of whose records carries
 * `isSidechain: true`. On this machine they are 18 of the 44 transcripts on disk. Recursing here
 * would put eighteen stones in the grove that nobody has ever typed at, so do not make this a
 * recursive walk without filtering them back out.
 */
async function scanTranscripts(): Promise<Map<string, TranscriptEntry>> {
  const byId = new Map<string, TranscriptEntry>()
  for (const projectDir of await listDirs(CLI_PROJECTS)) {
    for (const file of await listFiles(projectDir, (name) => name.endsWith('.jsonl'))) {
      const id = path.basename(file, '.jsonl')
      try {
        const stat = await fsp.stat(file)
        byId.set(id, { id, file, projectDir, size: stat.size, mtime: stat.mtimeMs })
      } catch {
        /* vanished between listing and stat */
      }
    }
  }
  return byId
}

/**
 * Parsing a transcript head is the most expensive thing this adapter does, so the result is kept
 * until the file changes. Without this, a poll every few seconds reparses every megabyte on
 * disk — which is the ground rule "never block the scan" in practice rather than in principle.
 */
const metaCache = new Map<string, { mtime: number; meta: TranscriptMeta }>()

async function transcriptMeta(entry: TranscriptEntry): Promise<TranscriptMeta> {
  const cached = metaCache.get(entry.id)
  if (cached && cached.mtime === entry.mtime) return cached.meta
  let meta: TranscriptMeta
  try {
    meta = readTranscriptMeta(jsonLines(await readHead(entry.file, HEAD_BYTES)))
  } catch {
    meta = readTranscriptMeta([])
  }
  metaCache.set(entry.id, { mtime: entry.mtime, meta })
  return meta
}

/**
 * Sessions with a CLI process actually alive right now.
 *
 * The registry keeps files for processes that have exited, so every pid is probed before it
 * counts. `process.kill(pid, 0)` sends no signal at all — it only asks whether that process
 * exists — which makes this the one genuinely *measured* fact in the whole adapter.
 */
async function scanLiveSessions(): Promise<Set<string>> {
  const live = new Set<string>()
  for (const file of await listFiles(CLI_LIVE, (name) => name.endsWith('.json'))) {
    const record = await readJsonFile(file)
    if (!isRecord(record)) continue
    const sessionId = str(record.sessionId)
    const pid = num(record.pid)
    if (!sessionId || !pid) continue
    try {
      process.kill(pid, 0)
      live.add(sessionId)
    } catch {
      /* the process is gone; the file outlived it */
    }
  }
  return live
}

/** Every session the desktop app has a record for. */
async function scanDesktopSessions(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (const account of await listDirs(DESKTOP_SESSIONS)) {
    for (const org of await listDirs(account)) {
      const files = await listFiles(org, (n) => n.startsWith('local_') && n.endsWith('.json'))
      for (const file of files) {
        const record = await readJsonFile(file)
        // `null` here means a session mid-write. Skipped this pass, picked up on the next.
        if (isRecord(record)) out.push(record)
      }
    }
  }
  return out
}

/* -------------------------------------------------------------------------------------------
 * Working out where a session lives
 * ---------------------------------------------------------------------------------------- */

/** `/repo/.claude/worktrees/feature-abc` -> project `/repo`, worktree `feature-abc`. */
const WORKTREE = /\/\.claude\/worktrees\/([^/]+)/

function splitWorktree(cwd: string): { root: string; worktree: string } {
  const match = WORKTREE.exec(cwd)
  if (!match) return { root: cwd, worktree: '' }
  return { root: cwd.slice(0, match.index), worktree: match[1] ?? '' }
}

function projectOf(cwd: string, originCwd: string) {
  const { root, worktree } = splitWorktree(cwd || '')
  const projectPath = originCwd || root || cwd || ''
  return { projectPath, project: path.basename(projectPath) || projectPath || 'unknown', worktree }
}

/**
 * Best-effort reverse of the CLI's project-folder encoding: `-Users-you-Some-Dir` back to
 * `/Users/you/Some/Dir`.
 *
 * Lossy, because a dash already in a folder name became a dash too, and there is no way to tell
 * the two apart from the name alone. Only used as a fallback when the transcript itself carries
 * no `cwd` — which it almost always does, so the lossy case is rare.
 */
function decodeProjectDir(name: string): string {
  return name.startsWith('-') ? '/' + name.slice(1).replace(/-/g, '/') : name
}

/* -------------------------------------------------------------------------------------------
 * Assembling sessions
 * ---------------------------------------------------------------------------------------- */

/**
 * The adapter's own working shape: a `Session` plus the private bookkeeping needed to build one.
 * Folded down to a `Session` by {@link toSession} on the way out, so nothing outside this file
 * sees a Claude session id.
 */
interface Draft {
  id: string
  cliSessionId: string
  desktopSessionId: string
  desktopSessionIds: string[]
  /** Whether the desktop app gave this record a real title. Distinguishes an app twin. */
  titled: boolean
  title: string
  preview: string
  project: string
  projectPath: string
  worktree: string
  cwd: string
  gitBranch: string
  model: string
  effort: string
  createdAt: number
  lastActivityAt: number
  /** The app's own activity stamp, kept apart from `lastActivityAt`. See below. */
  recordActivityAt: number
  lastFocusedAt: number
  hasLiveProcess: boolean
  hasError: boolean
  archived: boolean
  hasTranscript: boolean
  sizeBytes: number
  transcriptFile: string
  source: string
}

/**
 * Two desktop records can point at one transcript — resuming a session that is already open
 * makes the app write a second, untitled record. Keep the richer of the two.
 */
function mergeDrafts(existing: Draft, next: Draft): Draft {
  const better = (a: string, b: string) => (a && a !== 'Untitled session' ? a : b || a)
  // The titled record is the real session; an untitled twin is the import ghost. Point the
  // canonical id at the real one, but keep both ids so an action covers the ghost too.
  const keepExisting = existing.titled || !next.titled
  return {
    ...existing,
    ...next,
    title: better(existing.title, next.title),
    titled: existing.titled || next.titled,
    preview: existing.preview || next.preview,
    desktopSessionId: keepExisting ? existing.desktopSessionId : next.desktopSessionId,
    desktopSessionIds: [...new Set([...existing.desktopSessionIds, ...next.desktopSessionIds])],
    model: existing.model || next.model,
    effort: existing.effort || next.effort,
    gitBranch: existing.gitBranch || next.gitBranch,
    cwd: existing.cwd || next.cwd,
    createdAt: Math.min(existing.createdAt || Infinity, next.createdAt || Infinity) || 0,
    lastActivityAt: Math.max(existing.lastActivityAt, next.lastActivityAt),
    recordActivityAt: Math.max(existing.recordActivityAt, next.recordActivityAt),
    lastFocusedAt: Math.max(existing.lastFocusedAt, next.lastFocusedAt),
    hasError: existing.hasError || next.hasError,
    hasLiveProcess: existing.hasLiveProcess || next.hasLiveProcess,
    archived: existing.archived && next.archived,
    hasTranscript: existing.hasTranscript || next.hasTranscript,
    transcriptFile: existing.transcriptFile || next.transcriptFile,
    sizeBytes: Math.max(existing.sizeBytes, next.sizeBytes),
  }
}

/**
 * Status, and how much to trust it.
 *
 * Claude Code is the only harness with a live-process registry, which makes the *absence* of a
 * process a measured fact rather than a guess: a session with no live pid is definitely not
 * running. Telling `running` from `waiting` is a reading of the transcript's last record, so
 * that half stays `inferred`. An error is the app's own flag, so it is measured.
 */
function statusOf(draft: Draft, waiting: boolean, fresh: boolean): {
  status: SessionStatus
  statusProvenance: Provenance
} {
  if (draft.hasError) return { status: 'errored', statusProvenance: 'measured' }
  if (draft.hasLiveProcess && fresh) {
    return { status: waiting ? 'waiting' : 'running', statusProvenance: 'inferred' }
  }
  return { status: 'idle', statusProvenance: 'measured' }
}

function toSession(draft: Draft, status: SessionStatus, statusProvenance: Provenance): Session {
  // Unread compares against when you last *looked*, so both sides have to come from the app's
  // own bookkeeping. A session with no desktop record has no focus history at all, which makes
  // "have you read this" unknowable rather than false — hence the provenance, and hence not
  // measuring a transcript mtime against `lastFocusedAt`, which would put a mote over half the
  // grove on every background write.
  const seenAt = draft.recordActivityAt || draft.lastActivityAt
  const knowsFocus = draft.desktopSessionIds.length > 0
  // A session that handed the turn back wants you whether or not the app has ever seen it —
  // the only way a terminal-only session can ask for anything at all.
  const unread = status === 'waiting' || (knowsFocus && seenAt > draft.lastFocusedAt)

  return {
    id: draft.id,
    harness: '',
    harnessName: '',
    title: draft.title,
    preview: draft.preview,
    project: draft.project,
    projectPath: draft.projectPath,
    worktree: draft.worktree,
    cwd: draft.cwd,
    gitBranch: draft.gitBranch,
    model: draft.model,
    effort: draft.effort,
    createdAt: draft.createdAt,
    lastActivityAt: draft.lastActivityAt,
    lastFocusedAt: draft.lastFocusedAt,
    status,
    statusProvenance,
    unread,
    unreadProvenance: knowsFocus || status === 'waiting' ? 'inferred' : 'unknown',
    sizeBytes: draft.sizeBytes,
    archived: draft.archived,
    source: draft.source,
    canOpen: isDesktopId(draft.desktopSessionId) || isCliId(draft.cliSessionId),
    // The cwd rides along because resuming from a terminal has to happen in the folder the
    // session ran in — the worktree, not the repo root.
    ref: {
      desktopSessionId: draft.desktopSessionId,
      desktopSessionIds: draft.desktopSessionIds,
      cliSessionId: draft.cliSessionId,
      cwd: draft.cwd,
    },
  }
}

async function scanSessions(): Promise<Session[]> {
  const [desktop, transcripts, live] = await Promise.all([
    scanDesktopSessions(),
    scanTranscripts(),
    scanLiveSessions(),
  ])

  const byId = new Map<string, Draft>()
  const add = (draft: Draft) => {
    const existing = byId.get(draft.id)
    byId.set(draft.id, existing ? mergeDrafts(existing, draft) : draft)
  }
  /** Transcripts already accounted for by a desktop record, so they are not added twice. */
  const claimed = new Set<string>()

  for (const record of desktop) {
    const cliSessionId = str(record.cliSessionId)
    const entry = cliSessionId ? transcripts.get(cliSessionId) : undefined
    if (entry) claimed.add(cliSessionId)

    const cwd = str(record.cwd) || str(record.originCwd)
    const { projectPath, project, worktree } = projectOf(cwd, str(record.originCwd))
    const meta = entry ? await transcriptMeta(entry) : null
    const desktopSessionId = str(record.sessionId)
    const recordActivityAt =
      num(record.lastActivityAt) || num(record.lastFocusedAt) || num(record.createdAt)

    add({
      id: ID(cliSessionId || desktopSessionId),
      cliSessionId,
      desktopSessionId,
      desktopSessionIds: desktopSessionId ? [desktopSessionId] : [],
      titled: Boolean(str(record.title)),
      title:
        str(record.title) ||
        meta?.customTitle ||
        meta?.aiTitle ||
        meta?.summary ||
        meta?.firstPrompt ||
        'Untitled session',
      preview: meta?.firstPrompt ? meta.firstPrompt.slice(0, 240) : '',
      project,
      projectPath,
      worktree,
      cwd,
      gitBranch: meta?.gitBranch ?? '',
      model: str(record.model),
      effort: str(record.effort),
      createdAt: num(record.createdAt) || meta?.startedAt || 0,
      // The desktop record's own stamp lags: the app writes it when the session is focused, so a
      // session running in a terminal — or in a window you are not looking at — reads as hours
      // old while its transcript is being written to right now. The later of the two is true.
      lastActivityAt: Math.max(recordActivityAt, entry?.mtime ?? 0),
      recordActivityAt,
      lastFocusedAt: num(record.lastFocusedAt),
      hasLiveProcess: live.has(cliSessionId),
      hasError: Boolean(record.error),
      archived: record.isArchived === true || record.isArchived === 'True',
      hasTranscript: Boolean(entry),
      sizeBytes: entry?.size ?? 0,
      transcriptFile: entry?.file ?? '',
      source: 'desktop',
    })
  }

  // Transcripts with no desktop record — sessions started straight from the terminal.
  for (const [id, entry] of transcripts) {
    if (claimed.has(id)) continue
    const meta = await transcriptMeta(entry)
    const cwd = meta.cwd || decodeProjectDir(path.basename(entry.projectDir))
    const { projectPath, project, worktree } = projectOf(cwd, '')
    add({
      id: ID(id),
      cliSessionId: id,
      desktopSessionId: '',
      desktopSessionIds: [],
      titled: Boolean(meta.customTitle || meta.aiTitle),
      title: meta.customTitle || meta.aiTitle || meta.summary || meta.firstPrompt || 'Untitled session',
      preview: meta.firstPrompt ? meta.firstPrompt.slice(0, 240) : '',
      project,
      projectPath,
      worktree,
      cwd,
      gitBranch: meta.gitBranch,
      model: '',
      effort: '',
      createdAt: meta.startedAt || entry.mtime,
      lastActivityAt: entry.mtime,
      recordActivityAt: 0,
      lastFocusedAt: 0,
      hasLiveProcess: live.has(id),
      hasError: false,
      archived: false,
      hasTranscript: true,
      sizeBytes: entry.size,
      transcriptFile: entry.file,
      source: 'cli',
    })
  }

  const now = Date.now()

  /**
   * Drop the app's empty bookkeeping records.
   *
   * Resuming a session makes the desktop app write a second record for the same conversation,
   * and one of the two carries the title and the transcript link while the other carries
   * nothing. With no `cliSessionId` on the empty one there is no key to merge the pair on, so it
   * survives as a session of its own: an untitled entry with no transcript behind it, which
   * would stand in the grove as a nameless twin of a stone you have already dealt with.
   *
   * A record with no transcript, no title and no live process is not a conversation.
   */
  const drafts = [...byId.values()].filter(
    (draft) =>
      draft.hasTranscript ||
      draft.titled ||
      draft.hasLiveProcess ||
      now - (draft.lastActivityAt || draft.createdAt) < NEW_SESSION_MS
  )

  const sessions: Session[] = []
  for (const draft of drafts) {
    const fresh = now - draft.lastActivityAt < ACTIVE_WINDOW_MS
    // Only sessions that could plausibly be mid-turn pay for the tail read.
    const waiting =
      draft.hasLiveProcess && fresh && draft.transcriptFile
        ? await awaitingReply(draft.transcriptFile)
        : false
    const { status, statusProvenance } = statusOf(draft, waiting, fresh)
    const session = toSession(draft, status, statusProvenance)
    if (draft.transcriptFile && now - draft.lastActivityAt < TELLS_WINDOW_MS) {
      session.tells = await cachedTells(draft.transcriptFile, draft.sizeBytes, now)
    }
    sessions.push(session)
  }
  return sessions
}

/**
 * Tells are looked for only in sessions touched in the last day, and re-read only when the file
 * has grown. A tell older than the window is dropped: yesterday's retries are not news.
 */
const TELLS_WINDOW_MS = 24 * 60 * 60 * 1000
const tellsCache = new Map<string, { size: number; tells: Tell[] }>()

async function cachedTells(file: string, size: number, now: number): Promise<Tell[]> {
  let cached = tellsCache.get(file)
  if (!cached || cached.size !== size) {
    cached = { size, tells: await readTells(file) }
    tellsCache.set(file, cached)
  }
  return cached.tells.filter((tell) => now - tell.at < TELLS_WINDOW_MS)
}

/* -------------------------------------------------------------------------------------------
 * Handing a session back to Claude Code
 * ---------------------------------------------------------------------------------------- */

/**
 * `epitaxy/<local_…>` *navigates* the desktop app to a session it already has.
 * `resume?session=` *imports* the transcript, which spawns a second untitled session and
 * rewrites the .jsonl — so it is only ever the fallback for sessions the app has never seen.
 *
 * Ids are pattern-checked before they reach the opener, because `ref` came back from the
 * interface and anything from there is untrusted by the time it arrives.
 */
function openSession(ref: Record<string, unknown>): OpenResult {
  const desktopSessionId = ref?.desktopSessionId
  const cliSessionId = ref?.cliSessionId
  if (isDesktopId(desktopSessionId)) {
    return { ok: true, url: `claude://claude.ai/epitaxy/${desktopSessionId}` }
  }
  if (isCliId(cliSessionId)) {
    return { ok: true, url: `claude://resume?session=${cliSessionId}` }
  }
  return { ok: false, error: 'No openable session id on that session' }
}

/**
 * A new session rooted in a folder — the same deep link Finder's "New Claude Code Session Here"
 * quick action uses. Nothing is resumed and nothing is written: the app opens an empty session
 * with that folder as its workspace.
 */
function newSession(dir: string): OpenResult {
  return { ok: true, url: `claude://code/new?${new URLSearchParams({ folder: dir })}` }
}

const adapter: HarnessAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  /** Only claim this machine if one of the two stores is actually there. */
  detect: async () => (await exists(DESKTOP_SESSIONS)) || (await exists(CLI_PROJECTS)),
  scanSessions,
  openSession,
  newSession,
  paths: { DESKTOP_SESSIONS, CLI_PROJECTS, CLI_LIVE },
}

export default adapter
