/**
 * Is what the grove shows current and complete? One short answer for the health line.
 *
 * A calm grove is only trustworthy if a *broken* grove cannot look calm. A scanner that stopped,
 * a tool whose files could not be read, or a `grove.json` with a typo all used to show the same
 * quiet scene as a Mac with nothing happening; the review (30 September 2026, item 6) asked for
 * a small persistent line that tells them apart. In order of what matters most:
 *
 *   1. **Stale.** No fresh picture for several scan intervals: everything on screen may be old.
 *   2. **Something could not be read.** A tool's sessions, or `grove.json`. The rest is current,
 *      but a part is missing, and the line names which.
 *   3. **Live updates paused.** Hooks are installed but the listener is not running (another copy
 *      of the Grove holds its port), so changes arrive every few seconds instead of at once.
 *   4. **Fine.** "Live" when the hooks are working, "Watching" when the scan alone is.
 *
 * Pure: a snapshot's facts and a clock in, one line out. Checked in `test/verify-health.ts`.
 */

export type HealthTone = 'fine' | 'stale' | 'problem'

export interface Health {
  tone: HealthTone
  /** Two or three words, for the line itself. */
  text: string
  /** A sentence for hover and screen readers. */
  detail: string
}

export interface HealthFacts {
  /** When the picture on screen was taken, epoch ms. */
  at: number
  scanIntervalMs: number
  /** Tools whose sessions could not be read this pass, by their display name. */
  unreadable: string[]
  /** How many problems `grove.json` has. */
  groveProblems: number
  hooks: { state: 'off' | 'on' | 'outdated' | 'unreadable'; listening: boolean }
}

/** Stale after three missed scans, and never sooner than twenty seconds, so one slow pass is not an alarm. */
export const staleAfter = (scanIntervalMs: number) => Math.max(20_000, scanIntervalMs * 3)

function sinceText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return minutes === 1 ? 'a minute' : `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'an hour' : `${hours} hours`
}

export function healthOf(facts: HealthFacts, now: number): Health {
  const age = now - facts.at
  if (age > staleAfter(facts.scanIntervalMs)) {
    return {
      tone: 'stale',
      text: `Updated ${sinceText(age)} ago`,
      detail: `Nothing new from the scanner for ${sinceText(age)}. What you see may be out of date.`,
    }
  }
  if (facts.unreadable.length) {
    const [first, ...rest] = facts.unreadable
    return {
      tone: 'problem',
      text: rest.length ? `${first} and ${rest.length} more unread` : `${first} unread`,
      detail: `${facts.unreadable.join(', ')} could not be read this time, so ${
        facts.unreadable.length === 1 ? 'its' : 'their'
      } sessions are missing from the grove. Activity has the reason.`,
    }
  }
  if (facts.groveProblems) {
    return {
      tone: 'problem',
      text: 'grove.json has an error',
      detail: 'Part of grove.json could not be read, so the Grove is using defaults for it. Activity says where.',
    }
  }
  const hooksOn = facts.hooks.state === 'on' || facts.hooks.state === 'outdated'
  if (hooksOn && !facts.hooks.listening) {
    return {
      tone: 'stale',
      text: 'Live updates paused',
      detail: 'Claude Code’s hooks are on, but the Grove cannot listen for them (is another copy open?). Changes arrive every few seconds instead.',
    }
  }
  return hooksOn
    ? { tone: 'fine', text: 'Live', detail: 'Up to date. Claude Code tells the Grove about changes as they happen.' }
    : { tone: 'fine', text: 'Watching', detail: 'Up to date. The Grove reads your sessions every few seconds.' }
}
