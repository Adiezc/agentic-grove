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
 *
 * ## Where the roots hand over
 *
 * The tree model is authored in Blender, and its roots used to be grown there independently of
 * this file: the wood stopped at one set of points and the light started at another, so the two
 * met nowhere. Now the Blender build writes out every root tip — where it ends, which way it was
 * heading and how thick it is there — to `world-tree-roots.json`, and every main strand here
 * *starts at a root tip and leaves in its direction*. `ReferenceTree` then continues the wood a
 * little way along the same curve, thinning to nothing, so a root visibly narrows into a line of
 * light instead of ending beside one.
 */
import * as THREE from 'three'
import treeRoots from '../../assets/models/world-tree-roots.json'
import { DAIS_INNER_RADIUS, DAIS_INNER_TOP, DAIS_RADIUS, heightAt, TREE_YAW } from './stage'
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
  /**
   * Set when the strand begins at one of the tree's root tips: the wood's radius there. The tree
   * draws the wood on along the strand from that radius down to nothing.
   */
  rootRadius?: number
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
  /** For a sub-stone: where its parent stands. Its roots grow from the parent, not the tree. */
  from?: [number, number]
}

/** One root tip of the tree model, in grove coordinates. */
interface RootTip {
  at: THREE.Vector3
  /** Flat on the ground: the way the root was heading as it ended. */
  direction: THREE.Vector3
  radius: number
  angle: number
}

/**
 * The model's root tips, moved from the tree's own space into the grove's. The tree stands on the
 * inner dais step, which is the only offset between the two.
 */
const UP = new THREE.Vector3(0, 1, 0)

const ROOT_TIPS: RootTip[] = treeRoots.tips.map((tip) => {
  const [x = 0, y = 0, z = 0] = tip.at
  const [dx = 1, , dz = 0] = tip.direction
  const at = new THREE.Vector3(x, y + DAIS_INNER_TOP, z).applyAxisAngle(UP, TREE_YAW)
  return {
    at,
    direction: new THREE.Vector3(dx, 0, dz).applyAxisAngle(UP, TREE_YAW).normalize(),
    radius: tip.radius,
    angle: Math.atan2(at.z, at.x),
  }
})

/** The model's fine rootlet ends. Same space as ROOT_TIPS; they have no useful radius. */
const ROOTLET_TIPS: { at: THREE.Vector3; direction: THREE.Vector3 }[] = (treeRoots.rootlets ?? []).map((tip) => {
  const [x = 0, y = 0, z = 0] = tip.at
  const [dx = 1, , dz = 0] = tip.direction
  return {
    at: new THREE.Vector3(x, y + DAIS_INNER_TOP, z).applyAxisAngle(UP, TREE_YAW),
    direction: new THREE.Vector3(dx, 0, dz).applyAxisAngle(UP, TREE_YAW).normalize(),
  }
})

/**
 * Where the light emerges from under the trunk, for the strands that do not start at a root tip.
 *
 * In the art there is light under the roots as well as along them: a web on the dais that the
 * wood lies over. These strands begin inside the root flare, so they appear from between the wood.
 */
const BASE_RADIUS = 0.4

/** How far a strand rises above whatever floor is under it, so it reads as light on the surface. */
const CORE_LIFT = 0.012

/**
 * How far past its tip a root's direction still steers the strand, in metres. Short enough that
 * the strand is free to turn towards its stone, long enough that it visibly *continues* the root.
 */
const HANDOFF = 0.16

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
  const uses = new Map<RootTip, number>()

  for (const target of targets) {
    if (target.from) {
      growFromParent(target, target.from, random, strands, nodes)
      continue
    }
    const tip = rootFor(target.at, uses)
    uses.set(tip, (uses.get(tip) ?? 0) + 1)
    const primary = pathToStone(target.at, tip, random)
    strands.push({
      curve: primary,
      depth: 0,
      owner: target.id,
      from: 0,
      to: 1,
      // A fifth thicker than the first pass, which read as thin on a large screen (30 September 2026).
      r0: 0.0145,
      r1: 0.0072,
      rootRadius: tip.radius,
    })

    // A bright point where the root arrives at its stone. In the art this is the most emphatic
    // light at ground level: a small star sitting in the stone's rings.
    nodes.push({ at: primary.getPointAt(1).clone(), size: 0.032, owner: target.id, at01: 1 })

    growForks(primary, target.id, 0, 0, 1, random, strands, nodes)

    // A second, finer run to the same stone from the next-nearest root, so each stone is fed by a
    // braid rather than a single line. Mycelium is never one hypha wide, and a lone strand is what
    // made the network look sparse. It belongs to the stone, so it lights with it.
    const companionTip = rootFor(target.at, uses)
    uses.set(companionTip, (uses.get(companionTip) ?? 0) + 1)
    const companion = pathToStone(target.at, companionTip, random)
    strands.push({ curve: companion, depth: 1, owner: target.id, from: 0, to: 1, r0: 0.0075, r1: 0.004, rootRadius: companionTip.radius })
    growForks(companion, target.id, 1, 0, 1, random, strands, nodes)
  }

  // Every root with no stone still carries on as light, out to about the dais edge, so no root in
  // the model just stops. These belong to nobody.
  for (const tip of ROOT_TIPS) {
    if (uses.has(tip)) continue
    const reach = Math.min(tip.at.length() + 0.35 + random() * 0.55, DAIS_RADIUS - 0.05)
    const curve = leaveRoot(tip, polar(tip.angle + (random() - 0.5) * 0.35, reach), random)
    strands.push({ curve, depth: 1, owner: null, from: 0, to: 0, r0: 0.009, r1: 0.002, rootRadius: tip.radius })
    growForks(curve, null, 1, 0, 0, random, strands, nodes)
  }

  // Every rootlet of the model carries on as a hair of light. The rootlets brighten towards their
  // ends in the model, so the hair starts at the same brightness the wood finishes at.
  for (const tip of ROOTLET_TIPS) {
    const length = 0.22 + random() * 0.45
    const end = tip.at.clone().addScaledVector(tip.direction, length)
    const side = new THREE.Vector3(-tip.direction.z, 0, tip.direction.x)
    end.addScaledVector(side, (random() - 0.5) * length * 0.6)
    end.y = heightAt(Math.hypot(end.x, end.z)) + CORE_LIFT
    const curve = leaveRoot({ ...tip, radius: 0, angle: 0 }, end, random, 0.05)
    strands.push({ curve, depth: 2, owner: null, from: 0, to: 0, r0: 0.0034, r1: 0.0007 })
    growForks(curve, null, 2, 0, 0, random, strands, nodes)
  }

  // The web under the tree: short, fine, and belonging to nobody. In the art the ground right
  // under the trunk is much busier than the long runs out to the stones — hair-thin lines fanning
  // out of the base and dying before the dais edge.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + random() * 0.3
    const reach = 0.7 + random() * (DAIS_INNER_RADIUS - 0.6)
    const curve = wrinkle(
      groundPath(polar(angle, BASE_RADIUS), polar(angle + (random() - 0.5) * 0.5, reach), random, 0.22),
      random,
      0.02,
      0
    )
    strands.push({ curve, depth: 1, owner: null, from: 0, to: 0, r0: 0.008, r1: 0.0015 })
    growForks(curve, null, 1, 0, 0, random, strands, nodes)
  }

  return { strands, nodes }
}

/**
 * A sub-stone's roots: a braid of two strands from its parent stone's foot out to it, forking as
 * they go. The whole run belongs to the sub-stone, so it lights when work happens there, and it
 * starts at the parent, so the light reads as the project branching rather than a new root.
 */
function growFromParent(
  target: NetworkTarget,
  from: [number, number],
  random: () => number,
  strands: Strand[],
  nodes: NetworkNode[]
): void {
  const start = new THREE.Vector3(from[0], CORE_LIFT, from[1])
  const end = new THREE.Vector3(target.at[0], CORE_LIFT, target.at[1])
  for (const [wander, r0, depth] of [
    [0.28, 0.011, 0],
    [0.4, 0.006, 1],
  ] as const) {
    const curve = wrinkle(groundPath(start.clone(), end.clone(), random, wander), random, 0.035, 1)
    strands.push({ curve, depth, owner: target.id, from: 0, to: 1, r0, r1: r0 * 0.5 })
    growForks(curve, target.id, depth, 0, 1, random, strands, nodes)
  }
  nodes.push({ at: end.clone(), size: 0.028, owner: target.id, at01: 1 })
}

/**
 * The root a stone's strand grows from: the one pointing most nearly at it.
 *
 * A root already feeding a stone counts as a little further away, so neighbouring stones spread
 * over neighbouring roots rather than all hanging off one. With more stones than roots, some roots
 * feed two, which is also what a real root does.
 */
function rootFor(to: [number, number], uses: Map<RootTip, number>): RootTip {
  const angle = Math.atan2(to[1], to[0])
  let best = ROOT_TIPS[0]!
  let bestScore = Infinity
  for (const tip of ROOT_TIPS) {
    const score = Math.abs(wrapAngle(tip.angle - angle)) + (uses.get(tip) ?? 0) * 0.35
    if (score < bestScore) {
      best = tip
      bestScore = score
    }
  }
  return best
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/** A point on the ground plane at a given angle and distance, sitting on whatever floor is there. */
function polar(angle: number, radius: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    heightAt(radius) + CORE_LIFT,
    Math.sin(angle) * radius
  )
}

/** The first two points of any strand leaving a root: the tip itself, then a step on along it. */
function handoff(tip: RootTip, distance = HANDOFF): THREE.Vector3[] {
  const onward = tip.at.clone().addScaledVector(tip.direction, distance)
  onward.y = heightAt(Math.hypot(onward.x, onward.z)) + CORE_LIFT
  return [tip.at.clone(), onward]
}

/** A short run from a root tip out to a point on the ground. */
function leaveRoot(
  tip: RootTip,
  to: THREE.Vector3,
  random: () => number,
  step = HANDOFF
): THREE.CatmullRomCurve3 {
  const [start, onward] = handoff(tip, step)
  const mid = onward!.clone().lerp(to, 0.5)
  mid.y = heightAt(Math.hypot(mid.x, mid.z)) + CORE_LIFT
  return wrinkle(new THREE.CatmullRomCurve3([start!, onward!, mid, to]), random, 0.025, 2)
}

/**
 * The main run from a root tip to one stone.
 *
 * Three things stop this being a wire. It starts by carrying on the way its root was going, and
 * only then turns towards its stone, so the root and the light are one line. It wanders — the
 * midpoints are pushed sideways off the direct line by a good fraction of the distance, so no two
 * roots arrive at the angle they left at. And it has a control point exactly at the dais edge, so
 * the step down off the platform happens *there*, as a step, rather than as a ramp.
 */
function pathToStone(to: [number, number], tip: RootTip, random: () => number): THREE.CatmullRomCurve3 {
  const target = new THREE.Vector3(to[0], 0, to[1])
  const distance = target.length()
  const targetAngle = Math.atan2(to[1], to[0])
  const turn = wrapAngle(targetAngle - tip.angle)

  const points = handoff(tip)
  const clear = Math.hypot(points[1]!.x, points[1]!.z) + 0.25
  const stops = [0.3, 0.45, DAIS_RADIUS / distance, 0.72, 0.88]
  for (const t of stops) {
    const radius = distance * t
    if (t <= 0 || t >= 1 || radius < clear) continue
    // Turn from the root's heading to the stone's bearing over the first stretch.
    const eased = THREE.MathUtils.smoothstep(t, 0.2, 0.7)
    const angle = tip.angle + turn * eased
    // The wander is strongest in the middle and settles as the strand nears its stone, because a
    // root that arrives sideways looks like it missed.
    const settle = Math.sin(t * Math.PI) ** 0.8
    const sway = (random() - 0.5) * distance * 0.26 * settle
    const point = polar(angle, radius)
    point.x += -Math.sin(angle) * sway
    point.z += Math.cos(angle) * sway
    point.y = heightAt(Math.hypot(point.x, point.z)) + CORE_LIFT
    points.push(point)
  }
  points.push(target.setY(CORE_LIFT))
  return wrinkle(new THREE.CatmullRomCurve3(points), random, 0.04, 2)
}

/**
 * Small, irregular kinks along a strand.
 *
 * The long curves on their own are smooth splines, and a smooth spline reads as a cable. The
 * strands in the art are crooked at a small scale the way lightning and hyphae are: they change
 * direction every few centimetres. So the curve is resampled and every point nudged sideways by
 * a random amount, with the first `keep` points left alone so a root's hand-off stays exact.
 */
function wrinkle(
  curve: THREE.CatmullRomCurve3,
  random: () => number,
  amplitude: number,
  keep: number
): THREE.CatmullRomCurve3 {
  const length = curve.getLength()
  const count = Math.max(4, Math.round(length / 0.14))
  const points: THREE.Vector3[] = curve.points.slice(0, keep).map((point) => point.clone())
  // Find how far along the kept points reach, so resampling begins after them.
  let from = 0
  if (keep > 0) {
    const last = curve.points[keep - 1]!
    let closest = Infinity
    for (let i = 0; i <= 60; i++) {
      const distanceToLast = curve.getPointAt(i / 60).distanceTo(last)
      if (distanceToLast < closest) {
        closest = distanceToLast
        from = i / 60
      }
    }
  }
  for (let i = 1; i <= count; i++) {
    // Clamped: rounding can land a hair past 1, and three reads past the end of the curve there.
    const t = Math.min(1, from + ((1 - from) * i) / count)
    const point = curve.getPointAt(t)
    if (i < count) {
      const tangent = curve.getTangentAt(t)
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      // Quieter where the strand arrives, so it still lands in its stone's rings.
      point.addScaledVector(side, (random() - 0.5) * 2 * amplitude * Math.sin(Math.PI * t) ** 0.5)
      point.y = heightAt(Math.hypot(point.x, point.z)) + CORE_LIFT
    }
    points.push(point)
  }
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

  // More forks than the first pass had, spread along the whole run: the art's strands are hairy
  // from end to end, not bare cables with a tuft at each end.
  const count = depth === 0 ? 10 : depth === 1 ? 3 : 1
  for (let i = 0; i < count; i++) {
    const t = 0.1 + (i + random() * 0.8) / (count + 0.3)
    if (t >= 0.95) continue

    const origin = parent.getPointAt(t)
    const tangent = parent.getTangentAt(t).setY(0).normalize()
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(random() < 0.5 ? 1 : -1)

    // A fork leaves at a shallow angle and curves away, rather than branching at ninety degrees.
    const reach = (depth === 0 ? 0.7 : 0.38) * (0.45 + random() * 0.85)
    const spread = 0.35 + random() * 0.5
    const end = origin
      .clone()
      .addScaledVector(tangent, reach * (1 - spread * 0.5))
      .addScaledVector(side, reach * spread)
    const endRadius = Math.hypot(end.x, end.z)
    end.y = heightAt(endRadius) + CORE_LIFT

    const curve = wrinkle(groundPath(origin.clone(), end, random, 0.3), random, 0.018, 1)
    // A fork occupies a short window of its owner's journey rather than a point, so the light
    // runs out along it instead of the whole thing flashing at once.
    const from01 = parentFrom + (parentTo - parentFrom) * t
    const to01 = Math.min(from01 + 0.06 / (depth + 1), 1)

    const r0 = depth === 0 ? 0.006 : 0.0038
    strands.push({ curve, depth: depth + 1, owner, from: from01, to: to01, r0, r1: r0 * 0.25 })

    // Only the first generation of forks gets a node. Every junction lit is a starfield.
    if (depth === 0 && random() < 0.5) {
      nodes.push({ at: origin.clone(), size: 0.016 + random() * 0.01, owner, at01: from01 })
    }

    growForks(curve, owner, depth + 1, from01, to01, random, strands, nodes)
  }
}
