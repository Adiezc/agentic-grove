/**
 * How usage figures are worded, wherever they are shown.
 *
 * The crystal's readout and the menu-bar shard say the same things, so the wording lives here
 * once. If the two ever disagreed about a number, neither would be believed. Plain, short, and
 * never more precise than the source: a count of 767,412 tokens is shown as "767k", because the
 * extra digits add confidence the reader cannot use.
 */
import type { ProviderUsage, UsageWindow } from './types.ts'

export const WINDOW_NAME = { five_hour: '5 hours', seven_day: '7 days' } as const

/** Below this much headroom a figure is treated as "needs you". */
export const LOW_HEADROOM = 10

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`
  return `${tokens} tokens`
}

export function until(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((ms - now) / 60_000))
  if (minutes < 60) return `resets in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `resets in ${hours} h ${minutes % 60} min`
  const day = new Date(ms).toLocaleDateString('en-GB', { weekday: 'short' })
  const time = new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `resets ${day} ${time}`
}

export function ago(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** One window's figure: a percentage when there is a limit, a count when there is not. */
export function figure(window: UsageWindow, now: number): string {
  if (window.usedPercent !== null) {
    const reset = window.resetsAt !== null ? `, ${until(window.resetsAt, now)}` : ''
    return `${Math.round(window.usedPercent)}% used${reset}`
  }
  if (window.tokens !== null) return compactTokens(window.tokens)
  return 'unknown'
}

/** The provenance tag, plus how old an official figure is when it is not fresh. */
export function source(provider: ProviderUsage, now: number): string {
  const official = provider.windows.find((w) => w.provenance === 'official' && w.observedAt !== null)
  if (official?.observedAt && now - official.observedAt > 10 * 60_000) return `official, ${ago(official.observedAt, now)}`
  if (official) return 'official'
  if (provider.windows.some((w) => w.provenance === 'measured')) return 'measured'
  return 'unknown'
}

/**
 * The tightest official limit across every provider, or `null` when none is known. A week at 95%
 * matters more than five hours at 10%, so the most-used window wins.
 */
export function tightest(providers: ProviderUsage[]): { provider: ProviderUsage; window: UsageWindow } | null {
  let best: { provider: ProviderUsage; window: UsageWindow } | null = null
  for (const provider of providers) {
    for (const window of provider.windows) {
      if (window.provenance !== 'official' || window.usedPercent === null) continue
      if (!best || window.usedPercent > (best.window.usedPercent ?? 0)) best = { provider, window }
    }
  }
  return best
}
