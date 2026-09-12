/**
 * Filesystem helpers shared by every harness adapter.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing.
 *
 * Nothing in here knows about a particular harness, and an adapter is free to ignore the lot
 * and read its files however it likes. What these exist for is the awkward part of the job:
 * these files belong to other programs, which are writing to them *right now*, and some of
 * them are megabytes long. Every function here is shaped by one of those two facts.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * The first `bytes` of a file, with a trailing partial line dropped.
 *
 * Transcripts run to double-digit megabytes and everything we want — who, where, which branch,
 * the first prompt — is in the first few records. Reading the whole file to find them would
 * make a poll loop a memory problem.
 *
 * The trailing partial line is dropped so `JSON.parse` never sees half a record: the cut lands
 * wherever the byte count lands, which is mid-line more often than not.
 */
export async function readHead(file: string, bytes: number): Promise<string> {
  const handle = await fsp.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    return bytesRead === bytes ? text.slice(0, text.lastIndexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}

/**
 * The last `bytes` of a file, with a *leading* partial line dropped. The mirror of
 * {@link readHead}, for the questions only the end of a transcript answers — whose turn it is
 * right now, and whether the last thing that happened was an error.
 */
export async function readTail(file: string, bytes: number): Promise<string> {
  const handle = await fsp.open(file, 'r')
  try {
    const { size } = await handle.stat()
    const want = Math.min(bytes, size)
    const buffer = Buffer.allocUnsafe(want)
    const { bytesRead } = await handle.read(buffer, 0, want, size - want)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    return want === size ? text : text.slice(text.indexOf('\n') + 1)
  } finally {
    await handle.close()
  }
}

/**
 * Parse a JSONL blob, skipping the partial and malformed lines a live file always has.
 *
 * A session being written to this instant is the normal case, not the exception, so a bad line
 * costs us that line and nothing more. Throwing the whole pass away because one record was
 * caught mid-write would mean the busiest sessions — the ones most worth seeing — are the ones
 * that most often vanish from the grove.
 *
 * Records are `unknown`: what is on the line is another program's business and this function
 * has no idea what shape it should be. Each adapter narrows it at the point of use.
 */
export function jsonLines(text: string): unknown[] {
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      /* partial or malformed line — skip it and carry on */
    }
  }
  return out
}

/** Files in a directory matching `filter`, as absolute paths. An unreadable directory is empty. */
export async function listFiles(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    // A directory that is not there is the normal answer for a tool that is not installed.
    // Nothing about it is exceptional, so it is not reported as an exception.
    return []
  }
  return entries.filter((e) => e.isFile() && filter(e.name)).map((e) => path.join(dir, e.name))
}

/** Subdirectories of a directory, as absolute paths. An unreadable directory is empty. */
export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

/** Does this path exist at all? How adapters answer `detect()`. */
export async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * A number, or `0`.
 *
 * Timestamps arrive from other programs' JSON, where a field can be a number, a string, null,
 * or missing entirely between one version of that program and the next. Everything downstream
 * does arithmetic on them, and `NaN` propagating into a sort makes the whole grove's ordering
 * quietly wrong in a way that is very hard to see.
 */
export function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Read a small JSON file, or `null`.
 *
 * For the one-record-per-session files the Claude desktop app and the CLI keep. These are small
 * enough to read whole, and a `null` means "caught mid-write, try again next poll" rather than
 * anything worth reporting.
 */
export async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Narrow an `unknown` to something we can read properties off.
 *
 * Every record in these files is `unknown`, and this is the one-line guard that turns it into
 * something indexable without reaching for `any`. It says only that the value is an object —
 * each field still has to be checked or coerced at the point of use.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string field off an untrusted record, or `''`. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
