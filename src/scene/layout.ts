/**
 * Where stones stand, and where the empty circles wait for the next one.
 *
 * The grove is a set of **places**. A new grove shows three of them as empty circles; connecting
 * or creating a project fills the next one, and once two are filled more appear, always keeping a
 * couple free. So the grove grows with you rather than arriving full.
 *
 * Laid out on 3 October 2026 around the home view Adrian chose: low, close, the tree filling the
 * window. Every place was picked as a spot on the screen first and then projected down onto the
 * floor (with `window.__groveCamera` in the dev preview), so that from the home view:
 *
 *   1. **Nothing in front of the tree.** The tree and the console own the front of the frame. The
 *      art's two front places used to fall below the window's bottom edge from this view.
 *   2. **Nothing straight behind it.** The trunk and canopy would hide it.
 *   3. **Inside the window, clear of the interface.** Away from the rail on the left, the counters
 *      bottom left and the console bottom centre, with room for a name under each stone.
 *   4. **Filling outwards and backwards.** Beside the trunk first, then further out, then further
 *      back, alternating sides so the grove stays balanced. The first twelve fit the home view;
 *      beyond that the rows go further back, still in the frame zoomed out.
 *
 * A stone keeps the numbered place written for it in `grove.json`, so it never moves when another
 * project is added or removed; a removed one leaves an empty circle where it stood. The numbering
 * rules are in `core/state/places.ts`, shared with the node side that writes them.
 */
import type { Runestone as DerivedStone } from '../../core/state/stones.ts'
import { assignPlaces, freePlaces, placeAt } from '../../core/state/places.ts'
import { clearingCentre, clearingsOf, coveredPlaces, followersOf, memberSpot, ringRadius } from '../../core/state/clearings.ts'

export { placeAt }
import { runeFor } from './runes'
import type { StoneSpec } from './Runestone'

type Place = [number, number]

/** A small stable number from a string, so size and turn vary per project but never flicker. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/** One line for the stone's panel: what was last worked on there. */
function lastWork(stone: DerivedStone): string | undefined {
  const title = stone.sessions[0]?.title?.replace(/^[#\s>*`-]+/, '').trim()
  if (!title) return undefined
  return title.length > 46 ? `${title.slice(0, 45).trimEnd()}…` : title
}

export interface EmptyPlace {
  index: number
  at: Place
}

/** The empty circles, given the places the stones stand on. Gaps left by removed stones come first. */
export function emptyPlaces(used: number[]): EmptyPlace[] {
  return freePlaces(used).map((index) => ({ index, at: placeAt(index) }))
}

/** Stones standing on their own: not hanging from another stone in the grove. */
function standing(stones: DerivedStone[]): DerivedStone[] {
  const ids = new Set(stones.map((stone) => stone.id))
  return stones.filter((stone) => !stone.parent || !ids.has(stone.parent))
}

/**
 * The numbered place of each top-level stone, as the scene will draw it. A stone standing round
 * another's place in a clearing has none; its clearing's first stone holds the place for all of them.
 */
export function stonePlaces(stones: DerivedStone[]): Map<string, number> {
  const tops = standing(stones)
  const followers = followersOf(tops)
  return assignPlaces(tops.filter((stone) => !followers.has(stone.id)).map((stone) => ({ id: stone.id, place: stone.place })))
}

/** Every place in use: those stones stand on, and those a clearing's ring covers, so no empty circle lands in one. */
export function usedPlaces(stones: DerivedStone[]): number[] {
  const places = stonePlaces(stones)
  const areas = clearingsOf(standing(stones)).flatMap((clearing) => {
    const place = places.get(clearing.anchor)
    return place === undefined ? [] : [{ place, size: clearing.members.length }]
  })
  const taken = [...places.values()]
  return [...taken, ...coveredPlaces(areas, Math.max(0, ...taken))]
}

/** A clearing as the scene draws it: a ring round its stones, its name on the ground. */
export interface ClearingSpec {
  name: string
  centre: Place
  radius: number
  /** Its stones, in the order they stand round the centre. */
  members: string[]
}

/**
 * Where a sub-stone stands: further out from the tree than its parent, fanned either side of the
 * line from the trunk through the parent, so a project that splits into two or three reads as one
 * stone branching rather than a cluster. Siblings alternate sides, nearest the line first.
 */
export function childPlace(parent: Place, sibling: number): Place {
  const angle = Math.atan2(parent[0], parent[1])
  const side = sibling % 2 === 0 ? 1 : -1
  const fan = side * (0.42 + Math.floor(sibling / 2) * 0.32)
  const reach = Math.hypot(parent[0], parent[1]) + 2.1 + Math.floor(sibling / 2) * 0.4
  return [Math.sin(angle + fan / (reach / 4)) * reach, Math.cos(angle + fan / (reach / 4)) * reach * 0.82]
}

/**
 * Where a twin stands: right beside its anchor, close enough that the two share one base.
 *
 * Sideways as the camera sees it, not across the line from the trunk. The first version went across
 * that line, and at a back corner of the grove "across" points half towards the viewer, so the twin
 * stood in front of its anchor and hid its rune. Straight sideways, the pair always reads as two
 * stones side by side. The first twin goes the way that takes it further from the centre line,
 * keeping the layout's own rules (nothing front-centre, nothing straight behind the trunk); further
 * twins alternate sides and step outwards.
 */
export const TWIN_GAP = 1.05
export function twinPlace(anchor: Place, sibling: number, from: Place = [0, 0]): Place {
  // Away from `from`: the centre line, or for a stone in a clearing, the clearing's centre, so a
  // twin never lands between two stones of the same clearing.
  const outward = Math.sign(anchor[0] - from[0]) || 1
  const side = (sibling % 2 === 0 ? 1 : -1) * outward
  return [anchor[0] + side * TWIN_GAP * (1 + Math.floor(sibling / 2)), anchor[1]]
}

export function layoutStones(stones: DerivedStone[]): StoneSpec[] {
  return layoutGrove(stones).stones
}

export function layoutGrove(stones: DerivedStone[]): { stones: StoneSpec[]; clearings: ClearingSpec[] } {
  const ids = new Set(stones.map((stone) => stone.id))
  const hasParent = (stone: DerivedStone) => Boolean(stone.parent && ids.has(stone.parent))
  const at = new Map<string, Place>()
  // Top-level stones stand on their numbered places, which is what keeps a stone still when
  // another arrives or leaves.
  const places = stonePlaces(stones)
  for (const [id, index] of places) at.set(id, placeAt(index))
  let place = Math.max(-1, ...places.values()) + 1
  // A clearing's stones stand in a small circle round its first stone's place.
  const clearings: ClearingSpec[] = []
  const centreOf = new Map<string, Place>()
  for (const clearing of clearingsOf(standing(stones))) {
    const count = clearing.members.length
    const centre = clearingCentre(at.get(clearing.anchor) ?? placeAt(place++), count)
    clearing.members.forEach((id, index) => {
      at.set(id, memberSpot(centre, index, count))
      centreOf.set(id, centre)
    })
    clearings.push({ name: clearing.name, centre, radius: ringRadius(count), members: clearing.members })
  }
  // Then sub-stones, shortest path first: a parent's folder is always a prefix of its child's, so
  // every parent is placed before anything that hangs from it.
  // Twins last, since an anchor may itself be a sub-stone. Sub-stones and twins count separately,
  // so a project's first twin is always beside it, however many parts have split off.
  const siblings = new Map<string, number>()
  const byDepth = [...stones].filter(hasParent).sort((a, b) => a.id.length - b.id.length)
  for (const stone of [...byDepth.filter((each) => !each.twin), ...byDepth.filter((each) => each.twin)]) {
    const key = `${stone.twin ? 'twin' : 'part'}:${stone.parent}`
    const n = siblings.get(key) ?? 0
    siblings.set(key, n + 1)
    const from = at.get(stone.parent!) ?? placeAt(place++)
    at.set(stone.id, stone.twin ? twinPlace(from, n, centreOf.get(stone.parent!)) : childPlace(from, n))
  }
  const specs = stones.map((stone): StoneSpec => {
    const h = hash(stone.id)
    const child = hasParent(stone)
    return {
      id: stone.id,
      name: stone.name,
      rune: runeFor(stone.id),
      status: stone.status,
      at: at.get(stone.id)!,
      parent: child ? stone.parent : undefined,
      twin: child && stone.twin ? true : undefined,
      clearing: child ? undefined : stone.clearing,
      branch: stone.branch,
      splits: stone.splits,
      scale: (0.92 + h * 0.14) * (child ? (stone.twin ? 0.86 : 0.78) : 1),
      turn: (h - 0.5) * 0.44,
      line: lastWork(stone) ?? 'Nothing yet.',
      tells: stone.tells,
      workers: [
        ...new Set(
          stone.sessions
            .filter((session) => session.status === 'running' || session.status === 'waiting')
            .map((session) => session.harness)
        ),
      ],
    }
  })
  return { stones: specs, clearings }
}
