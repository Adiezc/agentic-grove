/**
 * Claude's official limits, read from Claude Code's own `/usage` command.
 *
 * `claude -p /usage` prints the five-hour and weekly figures your plan is held to ("Current
 * session: 72% used · resets Oct 18 at 4am"). It asks Anthropic for the numbers but runs no model,
 * so it costs nothing against those limits: checked on 18 October 2026 with Claude Code 2.1.301,
 * after Codync (Apache-2.0) pointed out the command. This replaces the press-to-check probe
 * (`probe.ts`), which needed one small paid request, as the normal way to read Claude's limits:
 * it runs on a timer, every five minutes, so PM's allowance rules (`limits.ts`) work on real figures.
 *
 * Same housekeeping as the probe: run in its own empty folder with the session markers of any
 * parent Claude Code session removed, so it never looks like your work. The output is a few
 * lines of plain text meant for people, so the parser is strict: a line it cannot read gives no
 * figure rather than a guess.
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import { PROBE_FOLDER, type ClaudeReading, type OfficialWindow } from './probe.ts'
import type { WindowKey } from './types.ts'

const TIMEOUT_MS = 30_000

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * "Oct 18 at 4am", "Oct 22 at 7:30pm", read as this Mac's local time (Claude Code prints your own
 * time zone). The year is the one that puts the reset in the near future: a reset is never more
 * than a week away, so "Jan 2" read on 30 December is next year's.
 */
export function parseReset(text: string, now: number): number | null {
  const match = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text)
  if (!match) return null
  const month = MONTHS.indexOf(match[1]!.toLowerCase())
  if (month < 0) return null
  let hour = Number(match[4]) % 12
  if (match[6]!.toLowerCase() === 'pm') hour += 12
  const minute = match[5] ? Number(match[5]) : 0
  const thisYear = new Date(now).getFullYear()
  const candidates = match[3] ? [Number(match[3])] : [thisYear - 1, thisYear, thisYear + 1]
  const times = candidates.map((year) => new Date(year, month, Number(match[2]), hour, minute).getTime())
  // The nearest one not more than a day in the past.
  return times.filter((time) => time > now - 86_400_000).sort((a, b) => a - b)[0] ?? null
}

/** The two figures from `/usage`'s text. A window the text leaves out is absent. */
export function parseUsageCommand(output: string, now: number): ClaudeReading | null {
  const windows: Partial<Record<WindowKey, OfficialWindow>> = {}
  for (const line of output.split('\n')) {
    const key: WindowKey | null = /^\s*current session\b/i.test(line) ? 'five_hour' : /^\s*current week\s*\(all models\)/i.test(line) ? 'seven_day' : null
    if (!key) continue
    const percent = /(\d{1,3}(?:\.\d+)?)\s*%\s*used/i.exec(line)
    if (!percent) continue
    const used = Number(percent[1])
    if (!(used >= 0 && used <= 100)) continue
    const resets = /resets\s+(.*)$/i.exec(line)
    windows[key] = { usedPercent: used, resetsAt: resets ? parseReset(resets[1]!, now) : null }
  }
  return Object.keys(windows).length ? { at: now, windows } : null
}

const SESSION_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID']

/** Run `claude -p /usage` and read it. `null` when Claude Code did not answer or the text was not readable. */
export async function readUsageCommand(cli: string, now = Date.now(), folder = PROBE_FOLDER): Promise<ClaudeReading | null> {
  await fsp.mkdir(folder, { recursive: true }).catch(() => {})
  const env = { ...process.env }
  for (const marker of SESSION_MARKERS) delete env[marker]
  return new Promise((resolve) => {
    execFile(cli, ['-p', '/usage'], { cwd: folder, env, timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolve(error ? null : parseUsageCommand(String(stdout), now))
    })
  })
}
