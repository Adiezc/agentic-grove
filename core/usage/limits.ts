/**
 * How much of a plan's allowance is left, turned into what PM may do about it.
 *
 * Three steps, agreed with Adrian on 17 October 2026, measured on the tool's own five-hour window
 * and its week:
 *
 *   - Above 70% of the five hours: no Opus (or Fable, or extra effort) without asking you first.
 *   - Above 90% of the five hours: the lightest model only, and new jobs wait for the reset.
 *   - Above 80% of the week: a warning, and PM sends less at once.
 *
 * The three numbers are yours to change in Settings; these are the defaults.
 *
 * **Unknown never blocks.** A figure nobody reported, or one that is out of date, is unknown, and
 * unknown means carry on as normal and say so. Stopping work on a guess would be inventing a
 * number, which the Grove does not do. "Out of date" follows `routing.ts`: a window that has reset
 * since the reading, or a five-hour reading more than five hours old, describes a window that is
 * over. A week-old weekly reading is out of date for the same reason.
 *
 * Pure. `npm run verify:model-policy` checks it.
 */
import type { UsageReport, UsageWindow } from './types.ts'

export interface UsageThresholds {
  /** Five-hour use above this, in percent: costly models need your OK. */
  noOpusAbove: number
  /** Five-hour use above this: the lightest model only, and new jobs queue. */
  haikuOnlyAbove: number
  /** Weekly use above this: warn and slow down. */
  weeklyWarnAbove: number
}

export const DEFAULT_THRESHOLDS: UsageThresholds = { noOpusAbove: 70, haikuOnlyAbove: 90, weeklyWarnAbove: 80 }

export type UsageLevel = 'ok' | 'no-opus-without-asking' | 'haiku-only'

export interface UsageTier {
  level: UsageLevel
  weeklyWarn: boolean
  /** Used percent of each window, or `null` when unknown or out of date. Never a guess. */
  fiveHour: number | null
  weekly: number | null
  /** One sentence PM can say. */
  reason: string
}

const HOUR_MS = 60 * 60_000
const MAX_AGE_MS = { five_hour: 5 * HOUR_MS, seven_day: 7 * 24 * HOUR_MS } as const

/** A window's used percent if it is known and still describes the current window. */
function currentPercent(window: UsageWindow | undefined, now: number): number | null {
  if (!window || window.usedPercent === null) return null
  if (window.resetsAt !== null && window.resetsAt <= now) return null
  if (window.observedAt !== null && now - window.observedAt > MAX_AGE_MS[window.key]) return null
  return Math.max(0, Math.min(100, Math.round(window.usedPercent)))
}

const TOOL_NAME = { 'claude-code': 'Claude', codex: 'Codex' } as const

export function usageTier(
  report: UsageReport | null,
  thresholds: UsageThresholds = DEFAULT_THRESHOLDS,
  now: number = Date.now(),
  provider: 'claude-code' | 'codex' = 'claude-code'
): UsageTier {
  const windows = report?.providers.find((each) => each.provider === provider)?.windows ?? []
  const fiveHour = currentPercent(windows.find((each) => each.key === 'five_hour'), now)
  const weekly = currentPercent(windows.find((each) => each.key === 'seven_day'), now)
  const name = TOOL_NAME[provider]

  const level: UsageLevel =
    fiveHour === null ? 'ok' : fiveHour > thresholds.haikuOnlyAbove ? 'haiku-only' : fiveHour > thresholds.noOpusAbove ? 'no-opus-without-asking' : 'ok'
  const weeklyWarn = weekly !== null && weekly > thresholds.weeklyWarnAbove

  const parts: string[] = []
  if (fiveHour === null) parts.push(`${name}'s five-hour use is unknown, so nothing is held back`)
  else if (level === 'haiku-only') parts.push(`${name}'s five-hour window is ${fiveHour}% used, so only the lightest model runs and new jobs wait for the reset`)
  else if (level === 'no-opus-without-asking') parts.push(`${name}'s five-hour window is ${fiveHour}% used, so the costly models need your OK`)
  else parts.push(`${name}'s five-hour window is ${fiveHour}% used`)
  if (weeklyWarn) parts.push(`the week is ${weekly}% used, so PM sends less at once`)

  return { level, weeklyWarn, fiveHour, weekly, reason: `${parts.join('; ')}.` }
}
