/**
 * Which numbered place each top-level stone stands on, and which places are empty circles.
 *
 * Places are numbered from 0 in the grove's filling order (see `src/scene/layout.ts` for where
 * each number stands). A stone keeps its number for good, written in `grove.json` as `"place"`, so
 * removing a project leaves an empty circle where it stood and every other stone stays still. The
 * review (30 September 2026, item 8) found stones sliding along one place whenever an earlier
 * project was removed, because places used to be handed out by list order every time.
 *
 * Older groves have no numbers yet. Their stones keep the order-based places they always had, and
 * the next change to the grove writes those numbers down, so the layout you know is the one kept.
 *
 * Sub-stones take no numbered place: they stand off their parent. Pure, and shared by the node side
 * (which writes numbers) and the scene (which draws them), so the two cannot disagree.
 */

export interface Placeable {
  id: string
  /** The number written in `grove.json`, if any. */
  place?: number
}

/**
 * The place of every stone given, all top-level. Written numbers first, in list order; a number
 * already taken (two entries edited by hand to the same place) goes to whichever came first, and
 * the other is treated as unnumbered. Unnumbered stones then fill the lowest free places, in order.
 */
export function assignPlaces(stones: Placeable[]): Map<string, number> {
  const at = new Map<string, number>()
  const taken = new Set<number>()
  for (const stone of stones) {
    if (stone.place === undefined || taken.has(stone.place)) continue
    at.set(stone.id, stone.place)
    taken.add(stone.place)
  }
  let next = 0
  for (const stone of stones) {
    if (at.has(stone.id)) continue
    while (taken.has(next)) next += 1
    at.set(stone.id, next)
    taken.add(next)
  }
  return at
}

/**
 * The empty circles: three to start, and once two stones stand, always two spare. The gaps a
 * removed stone left come first, lowest number first, so the grove refills from the middle out.
 */
export function freePlaces(used: Iterable<number>): number[] {
  const taken = new Set(used)
  const spare = taken.size < 2 ? 3 - taken.size : 2
  const free: number[] = []
  for (let index = 0; free.length < spare; index += 1) if (!taken.has(index)) free.push(index)
  return free
}

/** The place a new stone should take: the one asked for if it is free, otherwise the lowest free. */
export function placeFor(used: Iterable<number>, asked?: number): number {
  const taken = new Set(used)
  if (asked !== undefined && Number.isInteger(asked) && asked >= 0 && !taken.has(asked)) return asked
  let index = 0
  while (taken.has(index)) index += 1
  return index
}
