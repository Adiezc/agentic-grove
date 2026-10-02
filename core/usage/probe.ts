/**
 * Claude's official limits, read by running your own Claude Code once when you press "Check now".
 *
 * **Why a probe.** The crystal can count Claude Code's tokens but not the limit they count
 * against (see `claude.ts`). Claude Code does know it: every reply from Anthropic carries the
 * five-hour and weekly figures, and in `--output-format stream-json` Claude Code prints them as a
 * `rate_limit_event` line. Nothing under `~/.claude` stores them (looked for on 2 October 2026),
 * so the only way to read them without touching a sign-in credential is to make one small request
 * and read what comes back. The idea and the field names are clodfarm's; see CREDITS.md.
 *
 * **The rules, from DECISIONS.md.** Off unless switched on in Settings. Only when you press the
 * button: no timer, and no check before a send. The cheapest model, no tools, none of your
 * settings or hooks loaded, in an empty folder of its own. A window the line leaves out, or whose
 * reset time has passed, gets no official figure; nothing is filled in.
 *
 * **What one check costs.** Measured on 2 October 2026 with Claude Code 2.1.286: about 620 tokens
 * (586 in, 37 out). The same request with your settings and hooks loaded cost about 9,200, which
 * is why they are left out. The check's own tokens are real use and are counted like any other:
 * its transcript is written, so `claude.ts` finds it.
 *
 * **Kept out of the scene.** Every check runs in one fixed folder, so the scan's sessions and any
 * hook calls from there can be recognised and left out of the grove and the notifications
 * (`isProbeFolder`). A fixed folder rather than a remembered session id, because it still works
 * after the Grove restarts and has forgotten which ids it chose.
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isRecord } from '../harnesses/fsutil.ts'
import type { ProviderUsage, UsageWindow, WindowKey } from './types.ts'

/** Where every check runs. Empty, in the temp folder, and the same every time. */
export const PROBE_FOLDER = path.join(os.tmpdir(), 'agentic-grove-limits-check')

/** Long enough for a slow connection; a check that takes longer is given up on, not waited for. */
const TIMEOUT_MS = 60_000

/** One window as Anthropic reported it. */
export interface OfficialWindow {
  /** Share of the limit used, 0 to 100. */
  usedPercent: number
  /** Epoch ms the window resets, or `null` when the line did not say. */
  resetsAt: number | null
}

/** What one check read. A window the line left out is simply absent. */
export interface ClaudeReading {
  /** Epoch ms the check ran. */
  at: number
  windows: Partial<Record<WindowKey, OfficialWindow>>
}

export interface ProbeResult {
  ok: boolean
  reading?: ClaudeReading
  /** What the check itself used, from Claude Code's own result line. */
  tokens?: number
  error?: string
}

/**
 * The words Claude Code is run with. The session uses the cheapest model, has no tools, loads no
 * settings (so none of your hooks, plugins or instructions are sent or run), and is given a
 * one-line system prompt in place of Claude Code's long one.
 */
export function probeArgs(): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--system-prompt', 'Reply with: ok',
    'Reply with: ok',
  ]
}

/** True for the probe's own folder, however the path is spelt (macOS has two names for /tmp and /var). */
export function isProbeFolder(cwd: string): boolean {
  const plain = (folder: string) => folder.replace(/^\/private(?=\/)/, '').replace(/\/+$/, '')
  return cwd !== '' && plain(cwd) === plain(PROBE_FOLDER)
}

/** One window from the line. Anything that is not a sensible share is treated as missing, not clamped. */
function officialWindow(raw: unknown): OfficialWindow | undefined {
  if (!isRecord(raw)) return undefined
  const used = typeof raw.utilization === 'number' ? raw.utilization : Number.NaN
  if (!Number.isFinite(used) || used < 0 || used > 1) return undefined
  // Claude Code writes seconds.
  const resets = typeof raw.resetsAt === 'number' && raw.resetsAt > 0 ? raw.resetsAt * 1000 : null
  return { usedPercent: used * 100, resetsAt: resets }
}

/**
 * Read a check's printed lines. `reading` is `null` when no line reported limits, which is a
 * valid answer (Claude Code may stop printing it) and is said as such, never guessed around.
 */
export function parseProbe(output: string, now: number): { reading: ClaudeReading | null; tokens: number | null } {
  let reading: ClaudeReading | null = null
  let tokens: number | null = null
  for (const line of output.split('\n')) {
    if (!line.includes('"rate_limit_event"') && !line.includes('"result"')) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(record)) continue
    if (record.type === 'rate_limit_event' && isRecord(record.rate_limit_info)) {
      const unified = record.rate_limit_info.unifiedWindows
      const windows: ClaudeReading['windows'] = {}
      if (isRecord(unified)) {
        const five = officialWindow(unified.five_hour)
        const week = officialWindow(unified.seven_day)
        if (five) windows.five_hour = five
        if (week) windows.seven_day = week
      }
      if (windows.five_hour || windows.seven_day) reading = { at: now, windows }
    }
    if (record.type === 'result' && isRecord(record.usage)) {
      const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
      tokens = count(record.usage.input_tokens) + count(record.usage.cache_creation_input_tokens) + count(record.usage.output_tokens)
    }
  }
  return { reading, tokens }
}

/**
 * Run one check with the `claude` at `cli`. Never retries by itself: a check that fails says why
 * and waits for you to press again.
 */
export async function runProbe(cli: string, now = Date.now(), folder = PROBE_FOLDER): Promise<ProbeResult> {
  try {
    await fsp.mkdir(folder, { recursive: true })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return new Promise((resolve) => {
    const child = execFile(cli, probeArgs(), { cwd: folder, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      const { reading, tokens } = parseProbe(String(stdout), now)
      const used = tokens ?? undefined
      if (reading) return resolve({ ok: true, reading, tokens: used })
      if (error && 'killed' in error && error.killed) return resolve({ ok: false, tokens: used, error: 'Claude Code did not answer in time.' })
      if (error) return resolve({ ok: false, tokens: used, error: 'Claude Code could not run the check. It may be signed out.' })
      resolve({ ok: false, tokens: used, error: 'Claude Code did not report limits.' })
    })
    // Claude Code waits a few seconds for piped input before starting; closing it says there is none.
    child.stdin?.end()
  })
}

/**
 * Lay a reading over the counted figures. A window gets the official percentage only while its
 * reset time is still ahead; once it has passed, the old percentage describes a window that is
 * over, so the counted figure stands alone again and the note says to check again.
 */
export function withOfficial(counted: ProviderUsage | null, reading: ClaudeReading | null, now: number): ProviderUsage | null {
  if (!reading) return counted
  const keys: WindowKey[] = ['five_hour', 'seven_day']
  let official = 0
  const windows: UsageWindow[] = keys.map((key) => {
    const base = counted?.windows.find((w) => w.key === key) ?? {
      key,
      provenance: 'unknown' as const,
      usedPercent: null,
      resetsAt: null,
      tokens: null,
      observedAt: null,
    }
    const read = reading.windows[key]
    if (!read || (read.resetsAt !== null && read.resetsAt <= now)) return base
    official += 1
    return { ...base, provenance: 'official', usedPercent: read.usedPercent, resetsAt: read.resetsAt, observedAt: reading.at }
  })
  if (!official) {
    return counted
      ? { ...counted, note: 'Your last check is out of date: its windows have reset. Check again in Settings for the official figures.' }
      : null
  }
  return {
    provider: 'claude-code',
    name: 'Claude Code',
    windows,
    note:
      official === keys.length
        ? 'Reported by Anthropic to Claude Code when you last pressed Check now.'
        : 'Reported by Anthropic to Claude Code when you last pressed Check now. One window was not reported or has reset since, so it is counted instead.',
  }
}
