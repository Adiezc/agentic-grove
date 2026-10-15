/**
 * Clearings: stones grouped by theme, such as work, side projects or experiments.
 *
 * A clearing is a name written on each of its stones in `grove.json` (`"clearing": "Work"`), so it
 * is as easy to change by hand as anything else in there and there is no second list to keep in
 * step. Names match ignoring case and spaces at the ends; the first spelling met is the one shown.
 *
 * **Its stones stand together.** A clearing keeps one numbered place, its *anchor*'s: the first of
 * its stones that has a place written. The others give theirs up and stand round that spot, so a
 * clearing is a small group on the floor rather than a ring stretched across the grove. Places a
 * clearing's ring covers are counted as taken, so no new stone or empty circle lands inside it.
 *
 * **Yours to make.** Only top-level stones join one (a sub-stone or a twin stands off its own
 * stone, wherever that is). The Grove may suggest a clearing for projects you keep working on
 * together, using the same shared hours as the mushrooms, but it never files a stone on its own,
 * and a suggestion you turn down is not offered again.
 *
 * Pure, like `places.ts`: shared by the node side (which writes places) and the scene (which
 * draws them), so the two cannot disagree about who stands where.
 */
import { placeAt, type Place } from './places.ts'
import type { Pairing } from './pairings.ts'

/** Longest clearing name. It is written on the ground, so short reads better anyway. */
export const MAX_CLEARING_NAME = 32

/** The same clearing however it was typed: "Work", "work " and "WORK" are one. */
export const clearingKey = (name: string): string => name.trim().toLowerCase()

/** A name as it will be kept: trimmed, single spaces, or '' when it cannot be one. */
export function cleanClearingName(name: unknown): string {
  if (typeof name !== 'string') return ''
  const clean = name.trim().replace(/\s+/g, ' ')
  return clean.length <= MAX_CLEARING_NAME ? clean : ''
}

export interface ClearingMember {
  id: string
  clearing?: string
  /** The numbered place written for it, if any. */
  place?: number
}

export interface Clearing {
  /** As first written. */
  name: string
  /** The stone whose place the clearing stands on. Always `members[0]`. */
  anchor: string
  /** Anchor first, then the rest in the order they are listed. */
  members: string[]
}

/** The clearings among these stones, in the order their first stone is listed. */
export function clearingsOf(stones: ClearingMember[]): Clearing[] {
  const groups = new Map<string, { name: string; stones: ClearingMember[] }>()
  for (const stone of stones) {
    const name = stone.clearing?.trim()
    if (!name) continue
    const key = clearingKey(name)
    const group = groups.get(key) ?? { name, stones: [] }
    group.stones.push(stone)
    groups.set(key, group)
  }
  return [...groups.values()].map(({ name, stones: members }) => {
    const anchor = members.find((stone) => stone.place !== undefined) ?? members[0]!
    return { name, anchor: anchor.id, members: [anchor.id, ...members.filter((stone) => stone !== anchor).map((stone) => stone.id)] }
  })
}

/** The stones that stand round another's place rather than on one of their own. */
export function followersOf(stones: ClearingMember[]): Set<string> {
  return new Set(clearingsOf(stones).flatMap((clearing) => clearing.members.slice(1)))
}

/* -------------------------------------------------------------------------------------------
 * Where a clearing's stones stand
 * ---------------------------------------------------------------------------------------- */

/** How far apart neighbouring stones in a clearing stand: room for a twin between, not much more. */
export const CLEARING_SPACING = 1.9
/** How far the ring of small stones stands outside the clearing's own stones. */
export const RING_MARGIN = 0.9

/** How far from the centre a clearing's stones stand: none for one, a widening circle after. */
export const memberRadius = (count: number): number => (count <= 1 ? 0 : CLEARING_SPACING / (2 * Math.sin(Math.PI / count)))

export const ringRadius = (count: number): number => memberRadius(count) + RING_MARGIN

/**
 * How far from the trunk a clearing's ring must stay: the dais (`DAIS_RADIUS`, 2.45, in
 * `src/scene/stage.ts`) and the burst of roots just beyond it. Copied here because `core/` cannot
 * reach into the scene; change both together.
 */
export const TREE_CLEARANCE = 3.1

/**
 * The centre of a clearing standing on this place: the place itself, unless the ring would reach
 * the tree. Then the clearing steps straight back, away from the camera, until it clears it. Back
 * rather than out to the side, because the home view was framed for the places as they are: a step
 * sideways from a front place walks the clearing off the edge of the window.
 */
export function clearingCentre(place: Place, count: number): Place {
  const needed = TREE_CLEARANCE + ringRadius(count)
  if (Math.hypot(place[0], place[1]) >= needed) return place
  return [place[0], -Math.sqrt(Math.max(0, needed * needed - place[0] * place[0]))]
}

/**
 * Where the n-th of a clearing's stones stands, round its centre. Turned so that the group reads
 * from the front: two stand side by side, three make a triangle with its point at the back, and
 * an even number has a flat edge facing you, so no stone stands straight in front of another.
 */
export function memberSpot(centre: Place, index: number, count: number): Place {
  if (count <= 1) return centre
  const start = count % 2 === 0 ? -Math.PI / 2 + Math.PI / count : -Math.PI / 2
  const angle = start + (index / count) * Math.PI * 2
  const radius = memberRadius(count)
  return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]
}

/**
 * The numbered places a clearing's ring covers, besides its own: counted as taken, so no new stone
 * and no empty circle lands inside a clearing. A stone already standing on one stays where it is.
 */
export function coveredPlaces(clearings: { place: number; size: number }[], beyond = 0): Set<number> {
  const covered = new Set<number>()
  const last = Math.max(beyond, ...clearings.map((clearing) => clearing.place)) + 24
  for (const clearing of clearings) {
    const centre = clearingCentre(placeAt(clearing.place), clearing.size)
    const reach = ringRadius(clearing.size) + 0.9
    for (let index = 0; index <= last; index += 1) {
      if (index === clearing.place) continue
      const at = placeAt(index)
      if (Math.hypot(at[0] - centre[0], at[1] - centre[1]) < reach) covered.add(index)
    }
  }
  return covered
}

/* -------------------------------------------------------------------------------------------
 * Suggesting one
 * ---------------------------------------------------------------------------------------- */

export interface ClearingSuggestion {
  /** The stones, busiest pairing first. */
  stones: string[]
  /** Shared hours across the group in the last week, the strength of the suggestion. */
  hours: number
}

/** Shared hours a pair needs before the Grove suggests they stand together: a habit, not a coincidence. */
export const SUGGEST_HOURS = 3

/** A group of stones as a declined suggestion is written: the same group however it is ordered. */
export const groupKey = (stones: string[]): string => [...stones].sort().join('\n')

/**
 * Groups of stones you keep working on together that are in no clearing yet: joined wherever two
 * shared at least `SUGGEST_HOURS` hours in the last week. Two at most, strongest first, and never
 * one you have turned down.
 */
export function suggestClearings(
  stones: { id: string; parent?: string; clearing?: string }[],
  pairs: Pairing[],
  declined: string[][] = []
): ClearingSuggestion[] {
  const free = new Set(stones.filter((stone) => !stone.parent && !stone.clearing?.trim()).map((stone) => stone.id))
  const root = new Map<string, string>()
  const find = (id: string): string => {
    let at = id
    while (root.get(at) && root.get(at) !== at) at = root.get(at)!
    return at
  }
  const strong = pairs.filter((pair) => pair.hours >= SUGGEST_HOURS && free.has(pair.a) && free.has(pair.b))
  for (const pair of strong) {
    for (const id of [pair.a, pair.b]) if (!root.has(id)) root.set(id, id)
    root.set(find(pair.a), find(pair.b))
  }
  const groups = new Map<string, { stones: Map<string, number>; hours: number }>()
  for (const pair of strong) {
    const key = find(pair.a)
    const group = groups.get(key) ?? { stones: new Map<string, number>(), hours: 0 }
    group.hours += pair.hours
    for (const id of [pair.a, pair.b]) group.stones.set(id, (group.stones.get(id) ?? 0) + pair.hours)
    groups.set(key, group)
  }
  const turnedDown = new Set(declined.map(groupKey))
  return [...groups.values()]
    .map((group) => ({ stones: [...group.stones.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id), hours: group.hours }))
    .filter((group) => group.stones.length >= 2 && group.stones.length <= 6 && !turnedDown.has(groupKey(group.stones)))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 2)
}
