/**
 * The root network: one grown system, from the trunk to every stone.
 *
 * This file exists because of a specific mistake in the first pass. The tree had roots and the
 * grove had mycelium, they were built by different files out of different curves, and they met
 * nowhere — the roots stopped in a neat flare at the trunk and the mycelium started as six
 * separate squiggles somewhere out on the floor. It read as a tree standing on a diagram.
 *
 * In the concept art there is no seam. Light comes down the inside of the trunk, bursts out of
 * the base as a delta of forking roots across the dais, and *those same lines* thin, cross the
 * dais edge and keep going until they arrive at a stone. Root and mycelium are the same organism
 * seen at two distances, which is also exactly what the metaphor claims: the tree holds the
 * definitions, and the network is how work reaches a project.
 *
 * So both are generated here, once, by one recursive walk, and `WorldTree` and `Mycelium` draw
 * parts of the same result. They cannot drift apart, because there is nothing to drift.
 *
 * ## What comes out
 *
 * A flat list of strands. Each knows how deep in the branching it sits, which stone it ultimately
 * serves (or none), and — the useful part — **where along that stone's path it lives**. A fork
 * two thirds of the way to a stone carries `from ≈ 0.66`. One travelling window in the shader
 * then lights the whole subtree in the right order as it sweeps past, with no per-fork state and
 * no work on the CPU. See `taperedTube`'s `vRange`.
 */
import * as THREE from 'three'
import { DAIS_INNER_RADIUS, DAIS_RADIUS, heightAt } from './stage'
import { seededRandom } from './geometry'

export interface Strand {
  curve: THREE.CatmullRomCurve3
  /** 0 for a root running all the way to a stone, 1 and up for the forks hanging off it. */
  depth: number
  /** The stone this strand ultimately feeds, or null for a branch that leads nowhere. */
  owner: string | null
  /** Where this strand sits along its owner's journey, 0 at the trunk and 1 at the stone. */
  from: number
  to: number
  /** Radius of the hot core at each end. */
  r0: number
  r1: number
}

export interface NetworkNode {
  at: THREE.Vector3
  size: number
  owner: string | null
  /** Where along the owner's journey this node sits, so it flares as the pulse passes it. */
  at01: number
}

export interface Network {
  strands: Strand[]
  nodes: NetworkNode[]
}

export interface NetworkTarget {
  id: string
  at: [number, number]
}

/**
 * Where the roots leave the trunk.
 *
 * Not the exact centre: in the art the light emerges from a ring around the base of the trunk,
 * because that is where the buttress roots are, and starting every strand at one point gives a
 * starburst instead. Small, but it is the difference between roots and a firework.
 */
const BASE_RADIUS = 0.62

/** How far a strand rises above whatever floor is under it, so it reads as light on the surface. */
const CORE_LIFT = 0.012

/**
 * Grow the network.
 *
 * `seed` is fixed by the caller so the grove is identical on every reload. That matters more than
 * it sounds: with `Math.random` here, every hot reload reshuffles every root and you can no
 * longer tell a change you made from a change the generator made.
 */
export function growNetwork(targets: NetworkTarget[], seed = 404): Network {
  const random = seededRandom(seed)
  const strands: Strand[] = []
  const nodes: NetworkNode[] = []

  for (const target of targets) {
    const primary = pathToStone(target.at, random)
    strands.push({ curve: primary, depth: 0, owner: target.id, from: 0, to: 1, r0: 0.023, r1: 0.009 })

    // A bright point where the root arrives at its stone. In the art this is the most emphatic
    // light at ground level: a small star sitting in the stone's rings.
    nodes.push({
      at: primary.getPointAt(1).clone(),
      size: 0.032,
      owner: target.id,
      at01: 1,
    })

    growForks(primary, target.id, 0, 1, 1, random, strands, nodes)
  }

  // The delta on the dais: dense, short, fine, and belonging to nobody. This is the part directly
  // under the tree, and in the art it is much busier than the long runs out to the stones — a
  // hundred hair-thin lines fanning out of the base and dying before the dais edge.
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2 + random() * 0.22
    const reach = 0.7 + random() * (DAIS_INNER_RADIUS - 0.6)
    const curve = groundPath(
      polar(angle, BASE_RADIUS),
      polar(angle + (random() - 0.5) * 0.5, reach),
      random,
      0.22
    )
    strands.push({ curve, depth: 1, owner: null, from: 0, to: 0, r0: 0.011, r1: 0.002 })
    growForks(curve, null, 1, 0, 0, random, strands, nodes)
  }

  return { strands, nodes }
}

/** A point on the ground plane at a given angle and distance, sitting on whatever floor is there. */
function polar(angle: number, radius: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    heightAt(radius) + CORE_LIFT,
    Math.sin(angle) * radius
  )
}

/**
 * The main run from the trunk to one stone.
 *
 * Two things stop this being a wire. It wanders — the midpoints are pushed sideways off the
 * direct line by a good fraction of the distance, so no two roots leave at the same angle they
 * arrive at. And it has a control point exactly at the dais edge, so the step down off the
 * platform happens *there*, as a step, rather than being smoothed into a ramp across the whole
 * floor.
 */
function pathToStone(to: [number, number], random: () => number): THREE.CatmullRomCurve3 {
  const target = new THREE.Vector3(to[0], 0, to[1])
  const distance = target.length()
  const direction = target.clone().normalize()
  const side = new THREE.Vector3(-direction.z, 0, direction.x)
  const angle = Math.atan2(direction.z, direction.x)

  const points: THREE.Vector3[] = [polar(angle, BASE_RADIUS)]
  const stops = [0.18, 0.36, DAIS_RADIUS / distance, 0.72, 0.88]
  for (const t of stops) {
    if (t <= 0 || t >= 1) continue
    const radius = distance * t
    // The wander is strongest in the middle and settles as the strand nears its stone, because a
    // root that arrives sideways looks like it missed.
    const settle = Math.sin(t * Math.PI) ** 0.8
    const sway = (random() - 0.5) * distance * 0.3 * settle
    points.push(
      direction
        .clone()
        .multiplyScalar(radius)
        .add(side.clone().multiplyScalar(sway))
        .setY(heightAt(radius) + CORE_LIFT)
    )
  }
  points.push(target.setY(CORE_LIFT))
  return new THREE.CatmullRomCurve3(points)
}

/** A short wandering run between two points already sitting on the ground. */
function groundPath(
  from: THREE.Vector3,
  to: THREE.Vector3,
  random: () => number,
  wander: number
): THREE.CatmullRomCurve3 {
  const delta = to.clone().sub(from)
  const length = delta.length()
  const side = new THREE.Vector3(-delta.z, 0, delta.x).normalize()
  const mid = from
    .clone()
    .addScaledVector(delta, 0.5)
    .addScaledVector(side, (random() - 0.5) * length * wander)
  const midRadius = Math.hypot(mid.x, mid.z)
  mid.y = heightAt(midRadius) + CORE_LIFT
  return new THREE.CatmullRomCurve3([from, mid, to])
}

/**
 * Hang forks off a strand, and forks off those.
 *
 * Recursion depth three, thinning hard each generation. Most of these lead nowhere and stop, and
 * that is the point — a network where every branch arrives somewhere is a wiring diagram. Real
 * mycelium is mostly dead ends, and putting them in is the single cheapest thing that makes the
 * floor read as grown rather than drawn.
 *
 * `from01` and `to01` are the parent's position along its owner's journey, carried down so a
 * fork three generations deep still knows when the pulse will reach it.
 */
function growForks(
  parent: THREE.CatmullRomCurve3,
  owner: string | null,
  depth: number,
  parentFrom: number,
  parentTo: number,
  random: () => number,
  strands: Strand[],
  nodes: NetworkNode[]
): void {
  if (depth >= 3) return

  // Fewer, longer forks near the stone; more, shorter ones near the trunk, which is what the
  // delta in the art actually does.
  const count = depth === 0 ? 4 : depth === 1 ? 2 : 1
  for (let i = 0; i < count; i++) {
    const t = 0.12 + (i + random() * 0.7) / (count + 0.4)
    if (t >= 0.94) continue

    const origin = parent.getPointAt(t)
    const tangent = parent.getTangentAt(t).setY(0).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(random() < 0.5 ? 1 : -1)

    // A fork leaves at a shallow angle and curves away, rather than branching at ninety degrees.
    const reach = (depth === 0 ? 0.75 : 0.4) * (0.45 + random() * 0.85)
    const spread = 0.4 + random() * 0.5
    const end = origin
      .clone()
      .addScaledVector(tangent, reach * (1 - spread * 0.5))
      .addScaledVector(side, reach * spread)
    const endRadius = Math.hypot(end.x, end.z)
    end.y = heightAt(endRadius) + CORE_LIFT

    const curve = groundPath(origin.clone(), end, random, 0.3)
    // A fork occupies a short window of its owner's journey rather than a point, so the light
    // runs out along it instead of the whole thing flashing at once.
    const from01 = parentFrom + (parentTo - parentFrom) * t
    const to01 = Math.min(from01 + 0.06 / (depth + 1), 1)

    const r0 = depth === 0 ? 0.009 : 0.005
    strands.push({ curve, depth: depth + 1, owner, from: from01, to: to01, r0, r1: r0 * 0.28 })

    // Only the first generation of forks gets a node. Every junction lit is a starfield.
    if (depth === 0 && random() < 0.55) {
      nodes.push({ at: origin.clone(), size: 0.016 + random() * 0.01, owner, at01: from01 })
    }

    growForks(curve, owner, depth + 1, from01, to01, random, strands, nodes)
  }
}
