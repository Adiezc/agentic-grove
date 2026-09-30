/**
 * The live transcript view: the last few things a Claude Code session said and did, read from the
 * transcript it is writing.
 *
 * Read-only, like every other read of another tool's files, and only the tail: a long session's
 * transcript runs to many megabytes and the view shows the last screenful. What comes back is
 * reduced to three kinds of line (what you asked, what the agent wrote, and one short line per
 * tool it used), because the view is for glancing at progress, not for reading the whole thing.
 * "Resume in Terminal" is the way into the full conversation.
 *
 * Claude Code only for now. Codex writes its rollouts in a different shape, and a Codex run's
 * window is always open in Terminal anyway.
 */
import os from 'node:os'
import path from 'node:path'
import { exists, isRecord, jsonLines, listDirs, readTail, str } from '../harnesses/fsutil.ts'

export interface TranscriptLine {
  kind: 'you' | 'agent' | 'tool'
  text: string
  /** Epoch ms, or 0 where the record carries no time. */
  at: number
}

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
/** Enough for the last few dozen records of a busy session. */
const TAIL_BYTES = 256 * 1024
/** A screenful. The view scrolls, but past this it is the Terminal's job. */
const KEEP_LINES = 60
/** A long answer is cut here; the rest is one click away in Terminal. */
const MAX_TEXT = 700
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Claude Code names each project's folder after its path with every character that is not a letter
 * or digit turned into a dash. Checked first because it is one `stat`; the full search below covers
 * any case where that rule does not hold (a session resumed from another folder, say).
 */
async function findTranscript(sessionId: string, cwd: string): Promise<string | null> {
  const guess = path.join(PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
  if (await exists(guess)) return guess
  for (const dir of await listDirs(PROJECTS)) {
    const file = path.join(dir, `${sessionId}.jsonl`)
    if (await exists(file)) return file
  }
  return null
}

/** The machinery Claude Code wraps round prompts (`<system-reminder>`, `<command-name>`), removed. */
const clean = (text: string) =>
  text
    .replace(/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()

const cut = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text)

/** One short line for a tool call: which tool, and on what. Never the file contents it carried. */
function toolLine(name: string, input: unknown): string {
  const field = (key: string) => (isRecord(input) ? str(input[key]) : '')
  const file = field('file_path') || field('path') || field('notebook_path')
  if (file) return `${name} ${path.basename(file)}`
  if (name === 'Bash') return `Bash: ${field('description') || field('command').split('\n')[0]}`
  const pattern = field('pattern') || field('query') || field('url')
  return pattern ? `${name}: ${pattern}` : name
}

function linesOf(record: unknown): TranscriptLine[] {
  if (!isRecord(record) || record.isMeta === true || record.isSidechain === true) return []
  const at = Date.parse(str(record.timestamp)) || 0
  const message = isRecord(record.message) ? record.message : null
  if (!message) return []
  const content = message.content
  const out: TranscriptLine[] = []
  if (record.type === 'user') {
    // A user record holding tool results is the tool answering, not you; only typed text counts.
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (isRecord(part) && part.type === 'text' ? str(part.text) : '')).join('\n') : ''
    const said = clean(text)
    if (said) out.push({ kind: 'you', text: cut(said), at })
  } else if (record.type === 'assistant' && Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && str(part.text).trim()) out.push({ kind: 'agent', text: cut(str(part.text).trim()), at })
      if (part.type === 'tool_use') out.push({ kind: 'tool', text: cut(toolLine(str(part.name), part.input)), at })
    }
  }
  return out
}

/** The last lines of a session, oldest first. `null` when there is no transcript yet. */
export async function readTranscript(sessionId: string, cwd: string): Promise<TranscriptLine[] | null> {
  if (!SESSION.test(sessionId)) return null
  const file = await findTranscript(sessionId, cwd)
  if (!file) return null
  const records = jsonLines(await readTail(file, TAIL_BYTES))
  return records.flatMap(linesOf).slice(-KEEP_LINES)
}
