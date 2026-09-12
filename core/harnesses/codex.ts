/**
 * Harness adapter: Codex (OpenAI) — the desktop app, the VS Code extension and the CLI.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing.
 *
 * Two stores, merged rather than picked between, the same shape `claude-code.ts` ended up in:
 *
 *   - `~/.codex/state_<n>.sqlite` holds one row per session — title, cwd, branch, model, effort,
 *     archived — which is everything we want and none of it inferred.
 *   - `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` holds the transcript, which is the only
 *     source for how big a session is and whether it is mid-turn, and the only source at all
 *     for a session the database has not caught up with.
 *
 * They join on the session id, which appears in the row, in the rollout's filename and in its
 * `session_meta` record.
 *
 * **Read-only, without exception, and no subprocess anywhere.** Codex has an archive of its own
 * that only its own CLI can set, so the Grove reports that flag and never writes it.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { HarnessAdapter, OpenResult, Provenance, Session, SessionStatus } from './types.ts'
import { exists, isRecord, jsonLines, listDirs, listFiles, num, readHead, readTail, str } from './fsutil.ts'

const HOME = os.homedir()
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex')
const SESSIONS_DIR = path.join(CODEX_HOME, 'sessions')
const SESSION_INDEX = path.join(CODEX_HOME, 'session_index.jsonl')

const HEAD_BYTES = 128 * 1024
const TAIL_BYTES = 64 * 1024
/** Codex writes nothing when it is killed, so a stale `task_started` needs a time bound too. */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

/**
 * Codex ids are UUIDv7, so the version nibble is `7` rather than `4`. The pattern deliberately
 * does not pin the version — it is a shape check to keep junk out of a URL, not a validation.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATE_DB = /^state_(\d+)\.sqlite$/

const ID = (raw: string) => `codex:${raw}`

/**
 * `node:sqlite` is imported lazily and its absence is survivable.
 *
 * It needs Node 22.13, which this project asks for — but asking is not enforcing, and a
 * top-level import would take the whole scan down on an older Node rather than costing one
 * harness its titles. This way the transcript half still works and `diagnostic()` explains the
 * rest. It matters more than it looks: Electron ships its own Node, which is not the one
 * `npm run scan` used.
 */
let sqlitePromise: Promise<typeof import('node:sqlite') | null> | undefined
const sqliteApi = () => (sqlitePromise ??= import('node:sqlite').catch(() => null))

/** The newest schema version, not the most recently touched WAL sibling. */
async function latestStateDatabase(): Promise<string> {
  let entries
  try {
    entries = await fsp.readdir(CODEX_HOME, { withFileTypes: true })
  } catch {
    return ''
  }
  const databases = entries
    .filter((e) => e.isFile() && STATE_DB.test(e.name))
    .map((e) => ({ file: path.join(CODEX_HOME, e.name), version: Number(STATE_DB.exec(e.name)?.[1]) }))
    .sort((a, b) => b.version - a.version)
  return databases[0]?.file ?? ''
}

/* -------------------------------------------------------------------------------------------
 * The database half
 * ---------------------------------------------------------------------------------------- */

interface Row {
  id: string
  cwd: string
  title: string
  preview: string
  first_user_message: string
  source: string
  thread_source: string
  git_branch: string
  model: string
  reasoning_effort: string
  archived: unknown
  created_at_ms: unknown
  updated_at_ms: unknown
}

/**
 * Every column is probed before it is named.
 *
 * This is undocumented private state that changes shape between Codex versions — the filename is
 * versioned precisely because it does. A `SELECT` naming a column that has gone throws and costs
 * the whole harness its sessions, so anything not load-bearing is asked for only if it is there.
 */
const column = (columns: Set<string>, name: string, fallback = "''") =>
  columns.has(name) ? `t.${name}` : fallback

/** Codex has recorded times in both seconds and milliseconds across versions. Take either. */
function timeExpr(columns: Set<string>, ms: string, secs: string): string {
  if (columns.has(ms) && columns.has(secs)) return `COALESCE(t.${ms}, t.${secs} * 1000)`
  if (columns.has(ms)) return `t.${ms}`
  if (columns.has(secs)) return `t.${secs} * 1000`
  return '0'
}

/**
 * Is this database row a subagent's rather than a person's?
 *
 * The `source` column is the reliable one: for machinery it holds a JSON *string* such as
 * `{"subagent":{"other":"guardian"}}`, and for a real session just `"vscode"`. It is substring
 * matched rather than parsed, because what matters is whether the word is in there and a shape
 * we have not seen yet should still be caught.
 */
function isSubagentRow(row: Row, spawnChildren: Set<string>): boolean {
  if (spawnChildren.has(row.id)) return true
  if (row.thread_source === 'subagent') return true
  return str(row.source).includes('subagent')
}

/** The session index, keyed by session id. Empty when there is no readable database. */
async function databaseRows(): Promise<Map<string, Row>> {
  const [file, sqlite] = await Promise.all([latestStateDatabase(), sqliteApi()])
  if (!file || !sqlite?.DatabaseSync) return new Map()

  let db
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true })
  } catch {
    // A WAL database whose shared-memory file cannot be used refuses a read-only open. The
    // transcripts still answer everything needed to draw something, so this is not fatal.
    return new Map()
  }
  try {
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    const tables = new Set(tableRows.map((r) => String(r.name)))
    if (!tables.has('threads')) return new Map()

    const columnRows = db.prepare('PRAGMA table_info(threads)').all()
    const columns = new Set(columnRows.map((r) => String(r.name)))
    if (!['id', 'cwd'].every((name) => columns.has(name))) return new Map()

    // Sessions a task spawned for itself are not conversations anybody had. Each would stand in
    // the grove as a stone nobody has ever typed at. See DECISIONS.md.
    //
    // Three signals, because no one of them catches every case. On real data here, 20 of 29 rows
    // were machinery, and the seven `guardian_review` ones carried neither `thread_source =
    // 'subagent'` nor a spawn edge — only a `source` column holding `{"subagent":{…}}`. Testing
    // just the first two, as bot-crossing does, put seven review passes in the grove as though
    // somebody had had a conversation with them.
    const children = new Set<string>()
    if (tables.has('thread_spawn_edges')) {
      const edgeRows = db.prepare('PRAGMA table_info(thread_spawn_edges)').all()
      const edge = new Set(edgeRows.map((r) => String(r.name)))
      if (edge.has('child_thread_id')) {
        for (const row of db.prepare('SELECT child_thread_id FROM thread_spawn_edges').all()) {
          if (typeof row.child_thread_id === 'string') children.add(row.child_thread_id)
        }
      }
    }

    const rows = db
      .prepare(
        `SELECT
           t.id,
           t.cwd,
           ${column(columns, 'title')} AS title,
           ${column(columns, 'preview')} AS preview,
           ${column(columns, 'first_user_message')} AS first_user_message,
           ${column(columns, 'source')} AS source,
           ${column(columns, 'thread_source')} AS thread_source,
           ${column(columns, 'git_branch')} AS git_branch,
           ${column(columns, 'model')} AS model,
           ${column(columns, 'reasoning_effort')} AS reasoning_effort,
           ${column(columns, 'archived', '0')} AS archived,
           ${timeExpr(columns, 'created_at_ms', 'created_at')} AS created_at_ms,
           ${timeExpr(columns, 'updated_at_ms', 'updated_at')} AS updated_at_ms
         FROM threads t`
      )
      .all()
      .map((r) => r as unknown as Row)
      .filter((r) => UUID.test(str(r.id)) && !isSubagentRow(r, children))

    return new Map(rows.map((r) => [r.id, r]))
  } catch {
    // Any shape we did not expect costs the database half and nothing else.
    return new Map()
  } finally {
    try {
      db.close()
    } catch {
      /* already gone */
    }
  }
}

/* -------------------------------------------------------------------------------------------
 * The transcript half
 * ---------------------------------------------------------------------------------------- */

interface Rollout {
  id: string
  file: string
  size: number
  mtime: number
}

/** Every rollout transcript on disk, keyed by the session id in its filename. */
async function scanRollouts(): Promise<Map<string, Rollout>> {
  const byId = new Map<string, Rollout>()
  for (const year of await listDirs(SESSIONS_DIR)) {
    for (const month of await listDirs(year)) {
      for (const day of await listDirs(month)) {
        const files = await listFiles(day, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))
        for (const file of files) {
          const id = /([0-9a-f-]{36})\.jsonl$/i.exec(file)?.[1]
          if (!id || !UUID.test(id)) continue
          try {
            const stat = await fsp.stat(file)
            byId.set(id, { id, file, size: stat.size, mtime: stat.mtimeMs })
          } catch {
            /* vanished between listing and stat */
          }
        }
      }
    }
  }
  return byId
}

/** A `thread_name` per session, where Codex has written one. Optional; transcripts are truth. */
async function readIndex(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    for (const row of jsonLines(await fsp.readFile(SESSION_INDEX, 'utf8'))) {
      if (!isRecord(row)) continue
      const id = str(row.id)
      if (id && UUID.test(id)) out.set(id, str(row.thread_name))
    }
  } catch {
    /* no index — every field it carries has another source */
  }
  return out
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part === 'string' ? part : isRecord(part) ? str(part.text) || str(part.input_text) : ''))
    .filter(Boolean)
    .join('\n')
}

interface HeadMeta {
  cwd: string
  gitBranch: string
  model: string
  effort: string
  createdAt: number
  prompt: string
  /**
   * Whether this rollout is a session a person had, or machinery one of those sessions spawned
   * for itself — a review pass, a guardian check. See {@link isSubagent}.
   */
  subagent: boolean
}

/**
 * Is this rollout a subagent's rather than a person's?
 *
 * Codex writes a rollout for every thread it runs, including the ones a task spawns for itself.
 * On a working machine those are the clear majority of files on disk, and each would stand in
 * the grove as a stone nobody ever typed at. The `session_meta` record names them three ways
 * and any one is enough.
 */
function isSubagent(payload: Record<string, unknown>): boolean {
  if (str(payload.parent_thread_id)) return true
  if (isRecord(payload.source) && 'subagent' in payload.source) return true
  return str(payload.thread_source) === 'subagent'
}

/*
 * Note what this deliberately does *not* do: test `thread_source` against a list of values
 * known to be fine. An earlier version did, and it would have thrown away every
 * `chatgpt_handoff` session — a real conversation, handed over from ChatGPT, with a
 * `thread_source` that simply was not on the list. Checked across every rollout on this
 * machine, `parent_thread_id` and a subagent `source` agree perfectly and neither ever appears
 * on a session a person had, so the positive tests above are enough on their own. Recognising
 * machinery by what it *is* fails safely; recognising it by not being on a list of the known
 * good fails by hiding people's work as Codex adds new kinds.
 */

/** What the head of a transcript knows about itself. */
function readHeadMeta(records: unknown[]): HeadMeta {
  const meta: HeadMeta = {
    cwd: '',
    gitBranch: '',
    model: '',
    effort: '',
    createdAt: 0,
    prompt: '',
    subagent: false,
  }
  for (const record of records) {
    if (!isRecord(record)) continue
    const payload = record.payload
    if (!isRecord(payload)) continue

    if (record.type === 'session_meta') {
      meta.cwd ||= str(payload.cwd)
      meta.gitBranch ||= isRecord(payload.git) ? str(payload.git.branch) : ''
      meta.createdAt ||= Date.parse(str(payload.timestamp) || str(record.timestamp)) || 0
      if (isSubagent(payload)) meta.subagent = true
    } else if (record.type === 'turn_context') {
      // Later than session_meta and more specific, so it overwrites rather than fills in.
      meta.cwd = str(payload.cwd) || meta.cwd
      meta.model = str(payload.model) || meta.model
      meta.effort = str(payload.effort) || meta.effort
    } else if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      meta.prompt ||= clean(contentText(payload.content))
    }
  }
  return meta
}

/**
 * The last lifecycle record.
 *
 * `task_started` with nothing after it is mid-turn. `turn_aborted` is somebody pressing escape,
 * which is not an error and must not light a stone up red.
 */
function readLifecycle(records: unknown[]): { type: string; error: boolean } | null {
  let last: { type: string; error: boolean } | null = null
  for (const record of records) {
    if (!isRecord(record) || record.type !== 'event_msg') continue
    const payload = record.payload
    if (!isRecord(payload)) continue
    const type = str(payload.type)
    if (['task_started', 'task_complete', 'turn_aborted'].includes(type)) {
      last = { type, error: Boolean(payload.error) }
    }
  }
  return last
}

interface Facts {
  lifecycle: { type: string; error: boolean } | null
  meta: HeadMeta | null
}

/** Kept against mtime and size, so an unchanged transcript is read once. */
const parseCache = new Map<string, { mtime: number; size: number; facts: Facts }>()

async function transcriptFacts(entry: Rollout): Promise<Facts> {
  const cached = parseCache.get(entry.id)
  if (cached && cached.mtime === entry.mtime && cached.size === entry.size) return cached.facts

  const facts: Facts = { lifecycle: null, meta: null }
  try {
    facts.lifecycle = readLifecycle(jsonLines(await readTail(entry.file, TAIL_BYTES)))
    // Unlike bot-crossing we always read the head, because the subagent test lives there and it
    // decides whether this rollout becomes a session at all. The cache means it is paid once
    // per file rather than once per poll.
    facts.meta = readHeadMeta(jsonLines(await readHead(entry.file, HEAD_BYTES)))
  } catch {
    /* mid-write, or gone */
  }
  parseCache.set(entry.id, { mtime: entry.mtime, size: entry.size, facts })
  return facts
}

/* -------------------------------------------------------------------------------------------
 * Assembling sessions
 * ---------------------------------------------------------------------------------------- */

function projectOf(cwd: string) {
  const dir = path.isAbsolute(cwd) ? cwd : ''
  return { projectPath: dir, project: dir ? path.basename(dir) : 'unknown' }
}

/**
 * Codex keeps no live-process registry, so unlike Claude Code there is no pid to test. Every
 * status here is read out of the transcript's own lifecycle records, which makes the lot
 * `inferred` — including `idle`, since a killed Codex writes nothing to say so.
 */
function statusOf(lifecycle: Facts['lifecycle'], lastActivityAt: number, now: number): {
  status: SessionStatus
  statusProvenance: Provenance
} {
  if (lifecycle?.type === 'task_complete' && lifecycle.error) {
    return { status: 'errored', statusProvenance: 'inferred' }
  }
  if (lifecycle?.type === 'task_started' && now - lastActivityAt < ACTIVE_WINDOW_MS) {
    return { status: 'running', statusProvenance: 'inferred' }
  }
  return { status: 'idle', statusProvenance: 'inferred' }
}

async function scanSessions(): Promise<Session[]> {
  const [rows, rollouts, index] = await Promise.all([databaseRows(), scanRollouts(), readIndex()])
  const ids = new Set([...rows.keys(), ...rollouts.keys()])
  const now = Date.now()
  const out: Session[] = []

  for (const id of ids) {
    const row = rows.get(id)
    const entry = rollouts.get(id)
    const facts: Facts = entry ? await transcriptFacts(entry) : { lifecycle: null, meta: null }
    const meta = facts.meta

    // A rollout the database does not know about *and* whose own header says it is a subagent
    // is machinery. A row in the database means Codex itself considers it a thread worth
    // listing, and the query has already filtered that table's own subagents.
    if (!row && meta?.subagent) continue

    const cwd = row?.cwd || meta?.cwd || ''
    const { projectPath, project } = projectOf(cwd)
    const prompt = clean(row?.preview || row?.first_user_message || meta?.prompt || '')
    const title = clean(row?.title) || clean(index.get(id)) || prompt || 'Untitled session'
    const lastActivityAt = Math.max(num(row?.updated_at_ms), entry?.mtime ?? 0)
    const { status, statusProvenance } = statusOf(facts.lifecycle, lastActivityAt, now)

    out.push({
      id: ID(id),
      harness: '',
      harnessName: '',
      title: title.slice(0, 120),
      preview: prompt.slice(0, 240),
      project,
      projectPath,
      // Codex has no worktree concept of its own, and guessing one from the path would put a
      // branch name on a session that never had one.
      worktree: '',
      cwd,
      gitBranch: row?.git_branch || meta?.gitBranch || '',
      model: row?.model || meta?.model || '',
      effort: row?.reasoning_effort || meta?.effort || '',
      createdAt: num(row?.created_at_ms) || meta?.createdAt || entry?.mtime || 0,
      lastActivityAt,
      // Codex records no focus history at all.
      lastFocusedAt: 0,
      status,
      statusProvenance,
      unread: false,
      // Not `false` because nothing has moved on — `unknown` because there is no way to tell.
      unreadProvenance: 'unknown',
      // Bytes, like every other harness: a token count would make Codex sessions look larger
      // than Claude ones for the same amount of work.
      sizeBytes: entry?.size ?? 0,
      archived: row?.archived === 1 || row?.archived === true,
      source: row?.source === 'vscode' ? 'vscode' : 'cli',
      canOpen: true,
      ref: { sessionId: id },
    })
  }

  return out
}

/** `codex://` is registered by the Codex desktop app; the OS opener does the rest. */
function openSession(ref: Record<string, unknown>): OpenResult {
  const id = ref?.sessionId
  if (typeof id !== 'string' || !UUID.test(id)) {
    return { ok: false, error: 'No openable Codex session id on that session' }
  }
  return { ok: true, url: `codex://threads/${id}` }
}

function newSession(dir: string): OpenResult {
  return { ok: true, url: `codex://threads/new?${new URLSearchParams({ path: dir })}` }
}

/** Claim the machine if either store is there — a CLI-only install has no database. */
async function detect(): Promise<boolean> {
  return (await exists(SESSIONS_DIR)) || Boolean(await latestStateDatabase())
}

/**
 * Why a present Codex might still look thin. Without this the old-Node case is invisible: the
 * database is simply skipped, every session loses its title and model, and nothing says why.
 */
async function diagnostic(): Promise<string> {
  if (!(await latestStateDatabase())) return ''
  const sqlite = await sqliteApi()
  if (!sqlite?.DatabaseSync) {
    return `Codex sessions need Node 22.13 or newer for their titles and models (running ${process.versions.node})`
  }
  return ''
}

const adapter: HarnessAdapter = {
  id: 'codex',
  name: 'Codex',
  detect,
  diagnostic,
  scanSessions,
  openSession,
  newSession,
  paths: { CODEX_HOME, SESSIONS_DIR },
}

export default adapter
