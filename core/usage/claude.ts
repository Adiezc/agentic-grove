/**
 * Claude Code usage, counted from its own transcripts.
 *
 * **Why counted, not official.** The official five-hour and weekly percentages only reach a
 * program through Claude Code's statusline, and the desktop app does not run a statusline (tested
 * 27 September 2026: a fresh desktop session ran its hooks but never the statusline command). So
 * for anyone on the desktop app the only honest figure is the one we can count ourselves: tokens
 * per message, which every transcript records exactly. What we cannot know is the limit they
 * count against, so these windows always carry `usedPercent: null`. Terminal users will get the
 * official figure through the statusline later; see ROADMAP.md.
 *
 * **What is counted.** Input, cache writes and output. Cache *reads* are left out: they run to
 * tens of millions a day, cost a tenth as much, and would drown the number that actually moves
 * with how hard you are working.
 *
 * **Reading 100MB+ without rereading it.** A busy week is well over a hundred megabytes of
 * transcript. Each file is read once, then only from where the last read stopped, so after the
 * first pass a refresh reads just the lines written since. A file that shrank was rewritten, and
 * is read again from the start.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isRecord, listDirs, listFiles, num, str } from '../harnesses/fsutil.ts'
import type { ProviderUsage, UsageWindow, WindowKey } from './types.ts'

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')

const HOUR = 60 * 60 * 1000
const WINDOWS: { key: WindowKey; ms: number }[] = [
  { key: 'five_hour', ms: 5 * HOUR },
  { key: 'seven_day', ms: 7 * 24 * HOUR },
]
const LONGEST = 7 * 24 * HOUR
const CHUNK = 4 * 1024 * 1024

interface Message {
  at: number
  tokens: number
}

interface FileState {
  /** Bytes already read: always the end of a complete line. */
  offset: number
  /** Keyed by message id, because a message is written several times as it streams. */
  messages: Map<string, Message>
}

const files = new Map<string, FileState>()

/** Main transcripts plus the subagents' own, which spend tokens too. Only files touched this week. */
async function transcripts(since: number): Promise<string[]> {
  const out: string[] = []
  const recent = async (file: string) => (await fsp.stat(file).then((s) => s.mtimeMs, () => 0)) >= since
  for (const project of await listDirs(PROJECTS)) {
    for (const file of await listFiles(project, (n) => n.endsWith('.jsonl'))) {
      if (await recent(file)) out.push(file)
    }
    for (const session of await listDirs(project)) {
      for (const file of await listFiles(path.join(session, 'subagents'), (n) => n.endsWith('.jsonl'))) {
        if (await recent(file)) out.push(file)
      }
    }
  }
  return out
}

/** One transcript line, if it is an assistant message with usage from inside the window. */
function readLine(line: string, since: number): { id: string; message: Message } | null {
  // Most lines are tool results and prompts. Checking for the word first skips parsing them.
  if (!line.includes('"usage"')) return null
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(record) || record.type !== 'assistant' || !isRecord(record.message)) return null
  const { id, usage } = record.message
  if (typeof id !== 'string' || !isRecord(usage)) return null
  const at = Date.parse(str(record.timestamp))
  if (!Number.isFinite(at) || at < since) return null
  const tokens = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.output_tokens)
  return { id, message: { at, tokens } }
}

/** Read whatever has been added to one file since last time. */
async function catchUp(file: string, since: number): Promise<void> {
  let handle
  try {
    handle = await fsp.open(file, 'r')
  } catch {
    files.delete(file)
    return
  }
  try {
    const { size } = await handle.stat()
    let state = files.get(file)
    if (!state || size < state.offset) {
      state = { offset: 0, messages: new Map() }
      files.set(file, state)
    }
    const buffer = Buffer.allocUnsafe(CHUNK)
    let pending = ''
    while (state.offset + Buffer.byteLength(pending) < size) {
      const position = state.offset + Buffer.byteLength(pending)
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, position)
      if (!bytesRead) break
      const text = pending + buffer.subarray(0, bytesRead).toString('utf8')
      const cut = text.lastIndexOf('\n')
      // No newline yet: a single line longer than a chunk. Keep reading until it ends.
      if (cut < 0) {
        pending = text
        continue
      }
      for (const line of text.slice(0, cut).split('\n')) {
        const found = readLine(line, since)
        if (found) state.messages.set(found.id, found.message)
      }
      state.offset += Buffer.byteLength(text.slice(0, cut + 1))
      pending = text.slice(cut + 1)
    }
    // Whatever is in `pending` is a line still being written. It is read again, whole, next time.
  } finally {
    await handle.close()
  }
}

export async function claudeUsage(now = Date.now()): Promise<ProviderUsage | null> {
  const since = now - LONGEST
  const current = await transcripts(since)
  if (!current.length && !files.size) return null

  // Files that aged out of the week, or were deleted, are forgotten along with their counts.
  const keep = new Set(current)
  for (const file of files.keys()) if (!keep.has(file)) files.delete(file)
  for (const file of current) await catchUp(file, since)

  // A resumed or forked session can repeat earlier messages in a new file. Counting by message
  // id across every file means each message is counted once, wherever it appears.
  const all = new Map<string, Message>()
  for (const state of files.values()) {
    for (const [id, message] of state.messages) {
      if (message.at < since) state.messages.delete(id)
      else all.set(id, message)
    }
  }

  const windows: UsageWindow[] = WINDOWS.map(({ key, ms }) => {
    let tokens = 0
    for (const message of all.values()) if (message.at >= now - ms) tokens += message.tokens
    return { key, provenance: 'measured', usedPercent: null, resetsAt: null, tokens, observedAt: now }
  })

  return {
    provider: 'claude-code',
    name: 'Claude Code',
    windows,
    note: 'Counted from your transcripts on this Mac. Your plan limit is not visible to the Grove, so there is no percentage.',
  }
}
