/**
 * Where stones stand, and where the empty circles wait for the next one.
 *
 * The grove is a set of **places**. A new grove shows three of them as empty circles; connecting
 * or creating a project fills the next one, and once two are filled more appear, always keeping a
 * couple free. So the grove grows with you rather than arriving full.
 *
 * The first six places are the concept art's own, read off it by hand, in an order that fills the
 * frame evenly: back left, back right, front left, front right, then the two sides. Three rules
 * from that hand placement hold for every place after them too:
 *
 *   1. **Nothing front-centre.** The rune console sits there, and a stone behind it fights it.
 *   2. **Nothing straight behind the tree.** The trunk would hide it.
 *   3. **Wider than deep.** Stones sit further out sideways than towards the camera, which keeps
 *      them clear of the crown in an elevated view.
 *
 * A stone keeps the numbered place written for it in `grove.json`, so it never moves when another
 * project is added or removed; a removed one leaves an empty circle where it stood. The numbering
 * rules are in `core/state/places.ts`, shared with the node side that writes them.
 */
import type { Runestone as DerivedStone } from '../../core/state/stones.ts'
import { assignPlaces, freePlaces } from '../../core/state/places.ts'
import { runeFor } from './runes'
import type { StoneSpec } from './Runestone'

type Place = [number, number]

/** The concept art's six, in filling order. */
const ART_PLACES: Place[] = [
  [-3.7, -2.25],
  [3.9, -2.05],
  [-3.35, 3.1],
  [2.9, 3.2],
  [-5.25, 0.3],
  [5.3, 0.7],
]

/** Angle 0 is straight at the camera (+z); positive goes round to the right (+x). */
function pointAt(degrees: number, reach: number): Place {
  const radians = (degrees * Math.PI) / 180
  return [Math.sin(radians) * 5.2 * reach, Math.cos(radians) * 3.4 * reach]
}

/**
 * Places beyond the art's six: rings further out, each set in the gaps between the ring inside
 * it, alternating sides so the grove stays balanced as it grows.
 */
function outerPlace(index: number): Place {
  const ring = Math.floor(index / 6)
  const slot = index % 6
  const side = slot % 2 === 0 ? -1 : 1
  const angles = [118, 72, 34]
  const angle = angles[Math.floor(slot / 2)]!
  return pointAt(side * (angle + (ring % 2) * 8), 1.38 + ring * 0.32)
}

export function placeAt(index: number): Place {
  return index < ART_PLACES.length ? ART_PLACES[index]! : outerPlace(index - ART_PLACES.length)
}

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

/** The numbered place of each top-level stone, as the scene will draw it. */
export function stonePlaces(stones: DerivedStone[]): Map<string, number> {
  const ids = new Set(stones.map((stone) => stone.id))
  return assignPlaces(stones.filter((stone) => !stone.parent || !ids.has(stone.parent)).map((stone) => ({ id: stone.id, place: stone.place })))
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
export function twinPlace(anchor: Place, sibling: number): Place {
  const outward = Math.sign(anchor[0]) || 1
  const side = (sibling % 2 === 0 ? 1 : -1) * outward
  return [anchor[0] + side * TWIN_GAP * (1 + Math.floor(sibling / 2)), anchor[1]]
}

export function layoutStones(stones: DerivedStone[]): StoneSpec[] {
  const ids = new Set(stones.map((stone) => stone.id))
  const hasParent = (stone: DerivedStone) => Boolean(stone.parent && ids.has(stone.parent))
  const at = new Map<string, Place>()
  // Top-level stones stand on their numbered places, which is what keeps a stone still when
  // another arrives or leaves.
  const places = stonePlaces(stones)
  for (const [id, index] of places) at.set(id, placeAt(index))
  let place = Math.max(-1, ...places.values()) + 1
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
    at.set(stone.id, stone.twin ? twinPlace(from, n) : childPlace(from, n))
  }
  return stones.map((stone) => {
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
}
