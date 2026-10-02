/**
 * Codex's rate limits, as Codex itself recorded them.
 *
 * Every `token_count` event in a Codex rollout carries a `rate_limits` block: how much of the
 * five-hour (`primary`) and weekly (`secondary`) windows are used, and when each resets. Codex
 * copies these from OpenAI's responses, so they are `official`, which is better than the brief
 * expected (it had Codex down as an estimate).
 *
 * The catch is freshness. The figure is true as of the last Codex turn on this machine, and
 * usage elsewhere (the ChatGPT app, Codex in the cloud) moves the real number without us
 * seeing it. So the time it was observed travels with it, and once a window's reset time has
 * passed the old percentage says nothing at all about the new window: it becomes `unknown`.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isRecord, jsonLines, listDirs, listFiles, num, readTail, str } from '../harnesses/fsutil.ts'
import type { ProviderUsage, UsageWindow, WindowKey } from './types.ts'

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const SESSIONS_DIR = path.join(CODEX_HOME, 'sessions')

/** The last `token_count` is near the end; a long final answer can push it back a little. */
const TAIL_BYTES = 256 * 1024
/** Only this many of the newest rollouts are opened. The newest reading is the only one used. */
const NEWEST_FILES = 6

interface Reading {
  observedAt: number
  primary: unknown
  secondary: unknown
}

/**
 * How many day folders back to look. A conversation is filed under the day it *started*, and
 * resuming it writes to that same old file, so the newest reading can sit in an older folder than
 * a quieter, newer conversation. Stopping at the first six files found (as this once did) missed
 * it. Thirty folders is thirty days Codex was actually used, which costs a few hundred `stat`
 * calls once a minute; a conversation resumed after longer than that is not seen until its next
 * new session.
 */
const DAY_FOLDERS = 30

/** The newest day folders, newest first. Names are YYYY/MM/DD, so sorting them walks back in time. */
async function newestDays(): Promise<string[]> {
  const days: string[] = []
  for (const year of (await listDirs(SESSIONS_DIR)).sort().reverse()) {
    for (const month of (await listDirs(year)).sort().reverse()) {
      for (const day of (await listDirs(month)).sort().reverse()) {
        days.push(day)
        if (days.length >= DAY_FOLDERS) return days
      }
    }
  }
  return days
}

/** The newest rollout files, by modification time, newest first. */
async function newestRollouts(): Promise<string[]> {
  const found: { file: string; mtime: number }[] = []
  for (const day of await newestDays()) {
    for (const file of await listFiles(day, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
      const mtime = await fsp.stat(file).then((s) => s.mtimeMs, () => 0)
      if (mtime) found.push({ file, mtime })
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, NEWEST_FILES).map((f) => f.file)
}

/** The last rate-limit reading in one rollout, or `null` if it has none. */
async function lastReading(file: string): Promise<Reading | null> {
  const records = jsonLines(await readTail(file, TAIL_BYTES).catch(() => ''))
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (!isRecord(record) || !isRecord(record.payload)) continue
    const limits = record.payload.rate_limits ?? record.rate_limits
    if (str(record.payload.type) !== 'token_count' || !isRecord(limits)) continue
    const observedAt = Date.parse(str(record.timestamp))
    if (!Number.isFinite(observedAt)) continue
    return { observedAt, primary: limits.primary, secondary: limits.secondary }
  }
  return null
}

function toWindow(key: WindowKey, raw: unknown, observedAt: number, now: number): UsageWindow {
  const empty: UsageWindow = { key, provenance: 'unknown', usedPercent: null, resetsAt: null, tokens: null, observedAt }
  if (!isRecord(raw)) return empty
  // Codex writes seconds. Anything that is not a sensible percentage is treated as missing
  // rather than clamped, because clamping would be inventing the number we did not get.
  const resetsAt = num(raw.resets_at) * 1000 || null
  const used = Number(raw.used_percent)
  if (!Number.isFinite(used) || used < 0 || used > 100) return { ...empty, resetsAt }
  // The window this reading describes is over. The new one started empty, but something other
  // than this machine may have used it since, so the honest answer is that we do not know.
  if (resetsAt !== null && resetsAt <= now) return { ...empty, resetsAt: null }
  return { key, provenance: 'official', usedPercent: used, resetsAt, tokens: null, observedAt }
}

export async function codexUsage(now = Date.now()): Promise<ProviderUsage | null> {
  const files = await newestRollouts()
  if (!files.length) return null

  let newest: Reading | null = null
  for (const file of files) {
    const reading = await lastReading(file)
    if (reading && (!newest || reading.observedAt > newest.observedAt)) newest = reading
  }

  if (!newest) {
    return {
      provider: 'codex',
      name: 'Codex',
      windows: [
        { key: 'five_hour', provenance: 'unknown', usedPercent: null, resetsAt: null, tokens: null, observedAt: null },
        { key: 'seven_day', provenance: 'unknown', usedPercent: null, resetsAt: null, tokens: null, observedAt: null },
      ],
      note: 'No recent Codex session has recorded its limits yet.',
    }
  }

  const windows = [
    toWindow('five_hour', newest.primary, newest.observedAt, now),
    toWindow('seven_day', newest.secondary, newest.observedAt, now),
  ]
  const lapsed = windows.some((w) => w.provenance === 'unknown')
  return {
    provider: 'codex',
    name: 'Codex',
    windows,
    note: lapsed
      ? 'A window has reset since your last Codex session, so its new level is unknown until the next one.'
      : 'Reported by OpenAI to Codex, as of your last Codex session.',
  }
}
