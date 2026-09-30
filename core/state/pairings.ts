/**
 * Which projects you work on together: the data behind the mushrooms.
 *
 * Two stones pair when each had a session start, or last do something, in the same clock hour.
 * Those are the only two moments a session reliably records, so they are the only ones used: a
 * desktop session left open for three days has not been *worked on* for three days, and treating
 * its whole span as activity would pair it with everything.
 *
 * A pairing is only drawn while it is recent. Shared hours older than a week are not counted at
 * all, and `freshness` falls from 1 to 0 over that week, so mushrooms fade out when you stop
 * working on the two together rather than vanishing the moment a scan disagrees.
 *
 * A sub-stone and its parent never pair: they are one project, already joined by their roots.
 *
 * Pure, like `stones.ts`: stones and a clock in, pairs out.
 */
import type { Runestone } from './stones.ts'

export interface Pairing {
  /** The two stone ids, in a fixed order so the same pair always has the same key. */
  a: string
  b: string
  /** How many different hours in the last week had work on both. */
  hours: number
  /** 1 when the latest shared hour is this one, falling to 0 a week later. */
  freshness: number
}

const HOUR_MS = 60 * 60_000
export const PAIRING_WINDOW_MS = 7 * 24 * HOUR_MS

/** The clock hours in which this stone's sessions started or last moved, within the window. */
function hoursOf(stone: Pick<Runestone, 'sessions'>, since: number): Set<number> {
  const hours = new Set<number>()
  for (const session of stone.sessions) {
    for (const at of [session.createdAt, session.lastActivityAt]) {
      if (at >= since) hours.add(Math.floor(at / HOUR_MS))
    }
  }
  return hours
}

export function pairings(stones: Pick<Runestone, 'id' | 'sessions' | 'parent'>[], now: number): Pairing[] {
  const since = now - PAIRING_WINDOW_MS
  const hours = stones.map((stone) => hoursOf(stone, since))
  const out: Pairing[] = []
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const one = stones[i]!
      const two = stones[j]!
      if (one.parent === two.id || two.parent === one.id) continue
      let shared = 0
      let latest = -Infinity
      for (const hour of hours[i]!) {
        if (!hours[j]!.has(hour)) continue
        shared += 1
        latest = Math.max(latest, hour)
      }
      if (!shared) continue
      const age = now - latest * HOUR_MS
      const [a, b] = one.id < two.id ? [one.id, two.id] : [two.id, one.id]
      out.push({ a, b, hours: shared, freshness: Math.max(0, Math.min(1, 1 - age / PAIRING_WINDOW_MS)) })
    }
  }
  return out
}
