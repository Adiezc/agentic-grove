/**
 * Harness adapter: Cursor (Anysphere) — agent transcripts.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing.
 *
 * **UNVERIFIED.** Cursor is not installed on the machine this was written on — `~/.cursor` does
 * not exist — so nothing here has been run against real data. It is ported because it is small
 * and because leaving a gap would look like a decision rather than an absence. It will compile,
 * `detect()` will return false, and it will contribute nothing.
 *
 * What it does *not* do is guess. No file format is invented for a directory nobody has looked
 * in; every field below comes from bot-crossing, where it was verified on a machine that does
 * run Cursor. The first person to use the Grove with Cursor installed should expect to fix
 * something here, and should tell us what.
 *
 * Cursor writes one JSONL per agent session at
 * `~/.cursor/projects/<encoded-cwd>/agent-transcripts/<uuid>/<uuid>.jsonl`. The records are
 * plainer than most: `{ role, message }` per turn and, in recent versions, a
 * `{ type: 'turn_ended', status }` marker closing each one. There is no title, no cwd, no model
 * and no branch anywhere in the file — the encoded directory name and the first user message
 * are the whole of the metadata.
 *
 * Not covered: the composer and sidebar conversations. Their bodies are not in these files —
 * the per-workspace `state.vscdb` holds only pane layout, and the global one is a couple of
 * gigabytes on a working machine and held open read-write by the editor. Reading that on a
 * fifteen-second poll is its own piece of work, and guessing at its shape would be worse than
 * leaving it out and saying so here.
 *
 * **Read-only, no subprocess, and nothing is ever read from inside `Cursor.app`.**
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { HarnessAdapter, OpenResult, Session } from './types.ts'
import { exists, isRecord, jsonLines, listDirs, listFiles, readHead, readTail, str } from './fsutil.ts'

const HOME = os.homedir()
const PROJECTS = path.join(HOME, '.cursor', 'projects')
const TRANSCRIPTS = 'agent-transcripts'

const HEAD_BYTES = 96 * 1024
const TAIL_BYTES = 32 * 1024
/** Cursor writes nothing when it is killed, so an unclosed turn needs a time bound as well. */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ID = (raw: string) => `cursor:${raw}`

const isDir = async (target: string) => {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Turn `Users-you-Documents-agentic-grove` back into a path, by asking the disk.
 *
 * Every separator became a dash and so did every dash already in a folder name, which makes the
 * encoding lossy and the obvious reverse — replace each dash with a slash — wrong for most real
 * repositories. bot-crossing found it wrong for *every* project on their machine:
 * `emra-app-builder` came back as `emra/app/builder`. Since the folder name is what claims a
 * runestone, that is not cosmetic.
 *
 * So the disk decides. Walk the tokens and at each step take the longest run of them that names
 * a directory which actually exists, backtracking when a greedy match leads nowhere.
 */
async function resolvePath(tokens: string[], from = ''): Promise<string> {
  if (!tokens.length) return from
  for (let take = tokens.length; take >= 1; take--) {
    const candidate = `${from}/${tokens.slice(0, take).join('-')}`
    if (!(await isDir(candidate))) continue
    const rest = await resolvePath(tokens.slice(take), candidate)
    if (rest) return rest
  }
  return ''
}

const decodeCache = new Map<string, string>()

async function decodeProjectDir(name: string): Promise<string> {
  const cached = decodeCache.get(name)
  if (cached !== undefined) return cached

  const tokens = name.split('-').filter(Boolean)
  let out = await resolvePath(tokens)
  if (!out) {
    // Nothing on disk answers to it any more — a repository since deleted cannot be resolved by
    // anyone. Keep the deepest ancestor that does exist and let the remainder stand as one
    // name, which is the likelier reading: a folder name containing dashes is far more common
    // than four nested single-word folders.
    let dir = ''
    let i = 0
    while (i < tokens.length && (await isDir(`${dir}/${tokens[i]}`))) dir = `${dir}/${tokens[i++]}`
    out = i < tokens.length ? `${dir}/${tokens.slice(i).join('-')}` : dir
  }
  decodeCache.set(name, out)
  return out
}

/**
 * Cursor wraps a prompt in tags of its own — a timestamp, a note about attached images, the
 * query itself. Only the query is something a person typed, and it is the only part worth
 * putting on a stone.
 */
function userText(record: unknown): string {
  if (!isRecord(record) || !isRecord(record.message)) return ''
  const parts = record.message.content
  const raw = Array.isArray(parts)
    ? parts.map((p) => (typeof p === 'string' ? p : isRecord(p) ? str(p.text) : '')).join('\n')
    : String(parts ?? '')
  const query = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(raw)
  const text = query?.[1] ?? raw.replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>/gi, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

/** `Tuesday, Sep 8, 2026, 4:08 PM (UTC-7)`, if the first turn carried one. */
function stamp(record: unknown): number {
  if (!isRecord(record) || !isRecord(record.message)) return 0
  const parts = record.message.content
  const raw = Array.isArray(parts) ? parts.map((p) => (isRecord(p) ? str(p.text) : '')).join('\n') : ''
  const match = /<timestamp>(.*?)<\/timestamp>/.exec(raw)
  if (!match?.[1]) return 0
  const parsed = Date.parse(match[1].replace(/\s*\(UTC[^)]*\)\s*$/, ''))
  return Number.isNaN(parsed) ? 0 : parsed
}

interface Entry {
  id: string
  file: string
  dirName: string
  size: number
  mtime: number
  born: number
}

async function scanTranscripts(): Promise<Entry[]> {
  const out: Entry[] = []
  for (const projectDir of await listDirs(PROJECTS)) {
    for (const sessionDir of await listDirs(path.join(projectDir, TRANSCRIPTS))) {
      const id = path.basename(sessionDir)
      if (!UUID.test(id)) continue
      for (const file of await listFiles(sessionDir, (n) => n.endsWith('.jsonl'))) {
        try {
          const stat = await fsp.stat(file)
          if (!stat.size) continue
          out.push({
            id,
            file,
            dirName: path.basename(projectDir),
            size: stat.size,
            mtime: stat.mtimeMs,
            born: stat.birthtimeMs,
          })
        } catch {
          /* vanished between listing and stat */
        }
      }
    }
  }
  return out
}

interface Facts {
  prompt: string
  startedAt: number
  closed: boolean
  /** Whether this file's version of Cursor writes `turn_ended` markers at all. See below. */
  modern: boolean
  errored: boolean
}

const cache = new Map<string, { mtime: number; size: number; facts: Facts }>()

async function transcriptFacts(entry: Entry): Promise<Facts> {
  const hit = cache.get(entry.id)
  if (hit && hit.mtime === entry.mtime && hit.size === entry.size) return hit.facts

  const facts: Facts = { prompt: '', startedAt: 0, closed: true, modern: false, errored: false }
  try {
    for (const record of jsonLines(await readHead(entry.file, HEAD_BYTES))) {
      if (!isRecord(record) || record.role !== 'user') continue
      facts.prompt = userText(record)
      facts.startedAt = stamp(record)
      break
    }
    const tail = jsonLines(await readTail(entry.file, TAIL_BYTES))
    // `turn_ended` is a recent addition, and transcripts written before it exist in numbers and
    // carry none at all. Treating "no marker" as "mid-turn" would light up every old session in
    // the grove, so a file is only read that way once it has proved it writes them.
    const ended = tail.filter((r) => isRecord(r) && r.type === 'turn_ended')
    facts.modern = ended.length > 0
    const last = tail[tail.length - 1]
    facts.closed = isRecord(last) && last.type === 'turn_ended'
    const lastEnded = ended[ended.length - 1]
    facts.errored = isRecord(lastEnded) && lastEnded.status !== 'success'
  } catch {
    /* mid-write, or gone */
  }
  cache.set(entry.id, { mtime: entry.mtime, size: entry.size, facts })
  return facts
}

async function scanSessions(): Promise<Session[]> {
  const now = Date.now()
  const sessions: Session[] = []

  for (const entry of await scanTranscripts()) {
    const facts = await transcriptFacts(entry)
    const projectPath = await decodeProjectDir(entry.dirName)
    const running = facts.modern && !facts.closed && now - entry.mtime < ACTIVE_WINDOW_MS

    sessions.push({
      id: ID(entry.id),
      harness: '',
      harnessName: '',
      title: (facts.prompt || 'Untitled session').slice(0, 120),
      preview: facts.prompt.slice(0, 240),
      project: path.basename(projectPath) || 'unknown',
      projectPath,
      worktree: '',
      cwd: projectPath,
      gitBranch: '',
      model: '',
      effort: '',
      createdAt: facts.startedAt || entry.born || entry.mtime,
      lastActivityAt: entry.mtime,
      lastFocusedAt: 0,
      status: facts.errored ? 'errored' : running ? 'running' : 'idle',
      // Everything about Cursor's status is read out of markers that older versions do not
      // write at all, so this is the weakest signal of the three adapters.
      statusProvenance: 'inferred',
      unread: false,
      unreadProvenance: 'unknown',
      sizeBytes: entry.size,
      archived: false,
      source: 'agent',
      canOpen: false,
      ref: { sessionId: entry.id, cwd: projectPath },
    })
  }
  return sessions
}

/**
 * Cursor registers `cursor://`, but only for files and folders — nothing found so far addresses
 * a single agent session, and inventing a route would be a link that silently does nothing.
 * Saying so is the honest offer, and the interface shows this message instead of a dead button.
 */
function openSession(): OpenResult {
  return {
    ok: false,
    error: 'Cursor has no link to a single session — open the repo and pick it from the agent list.',
  }
}

/** `cursor://file/<abs>` is answered by the installed app; the OS opener does the finding. */
function newSession(dir: string): OpenResult {
  if (!dir.startsWith('/')) return { ok: false, error: 'That folder is not somewhere Cursor can open' }
  return { ok: true, url: `cursor://file${dir.split('/').map(encodeURIComponent).join('/')}` }
}

const adapter: HarnessAdapter = {
  id: 'cursor',
  name: 'Cursor',
  detect: () => exists(PROJECTS),
  scanSessions,
  openSession,
  newSession,
  /** Said out loud rather than buried in a comment, so `npm run scan` prints it. */
  diagnostic: async () =>
    (await exists(PROJECTS))
      ? 'This adapter has never been run against real Cursor data — please report anything that looks wrong.'
      : '',
  paths: { PROJECTS },
}

export default adapter
