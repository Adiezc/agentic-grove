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

/* -------------------------------------------------------------------------------------------
 * Where each numbered place stands on the floor, as [x, z]. Here rather than in the scene so the
 * node side can tell which places a clearing covers (`core/state/clearings.ts`). How they were
 * picked is in the header of `src/scene/layout.ts`.
 * ---------------------------------------------------------------------------------------- */

export type Place = [number, number]

/** The places that fit the home view, in filling order, before `PLACE_SPREAD`. Picked on screen, see the header of `src/scene/layout.ts`. */
export const HOME_PLACES: Place[] = [
  [-3.7, -0.6],
  [3.9, -0.5],
  [-5.6, -3.6],
  [6.1, -3.4],
  [-3.9, -5.9],
  [4.5, -5.8],
  [-7.4, -6.2],
  [7.8, -6.0],
  [-2.6, -8.4],
  [3.4, -8.4],
  [-6.0, -9.0],
  [6.6, -8.8],
]

/**
 * Places beyond those: rows further back, each a little wider than the last, alternating sides.
 * Seen from the home view they sit behind the canopy; zoomed out, they are in the open.
 */
function outerPlace(index: number): Place {
  const row = Math.floor(index / 6)
  const slot = index % 6
  const side = slot % 2 === 0 ? -1 : 1
  const across = 2.6 + Math.floor(slot / 2) * 2.7 + row * 0.6
  return [side * across, -10.2 - row * 2.6 - Math.floor(slot / 2) * 0.5]
}

/**
 * How far out every place stands compared with where it was first picked. Set on 15 October 2026
 * at Adrian's request, with the home camera pulled back by the same factor (`camera` in
 * `src/theme/palette.ts`): the stones keep their spots on screen, but the tree reads smaller among
 * them and they, and any clearing, have more room round the trunk. Change the two together.
 */
export const PLACE_SPREAD = 1.3

export function placeAt(index: number): Place {
  const [x, z] = index < HOME_PLACES.length ? HOME_PLACES[index]! : outerPlace(index - HOME_PLACES.length)
  return [x * PLACE_SPREAD, z * PLACE_SPREAD]
}

