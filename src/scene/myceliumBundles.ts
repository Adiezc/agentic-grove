/** Fine reticulated hyphae: irregular paths, local fusions and pipe-model branches.
 * Uses the credited Jakob/Space Colonization port in colonizeRoots.ts, following
 * Runions, Lane and Prusinkiewicz's 2007 space-colonization/generalized-cylinder method.
 * This is a stylized geometry model, not a simulation of fungal biology.
 */
import * as THREE from 'three'
import type { NetworkNode, Strand } from './network'
import { seededRandom } from './geometry'
import { colonizeRoots } from './colonizeRoots'
import { NetworkCurve } from './networkCurve'
import { ROOT_CONTINUATION, sharedRadius } from './rootTransition'

export function bundleHyphae(strands: Strand[], junctions?: NetworkNode[]): Strand[] {
  const additions: Strand[] = []
  for (const strand of strands) {
    if (strand.owner === null || strand.bridge || (strand.depth !== 0 && strand.rootRadius === undefined)) continue
    const length = strand.curve.getLength()
    if (length < 0.4) continue
    const origin = strand.curve.getPointAt(0)
    const random = seededRandom(Math.round(length * 10000 + origin.x * 713 + origin.z * 991))
    const paths: THREE.CatmullRomCurve3[] = [strand.curve]
    // Fine, irregular hyphae share endpoints but weave through a broad envelope.
    // Staggered phases and varying excursions avoid evenly spaced parallel lanes.
    const fibreCount = strand.depth === 0 ? 12 : 6
    for (let fibre = 0; fibre < fibreCount; fibre++) {
      const lane = (fibre + 0.5) / fibreCount * 2 - 1
      const phase = random() * Math.PI * 2, frequency = 5 + random() * 4
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= 56; i++) {
        const t = i / 56, point = strand.curve.getPointAt(t)
        const tangent = strand.curve.getTangentAt(t)
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
        // Root fibres already have a physical-distance peel below. A second
        // normalized envelope made them pinch into a cable and then swell suddenly.
        const envelope = (strand.rootRadius === undefined ? THREE.MathUtils.smoothstep(t, 0.06, 0.22) : 1)
          * (1 - THREE.MathUtils.smoothstep(t, 0.87, 1))
        const swell = 0.64 + 0.36 * Math.sin(t * Math.PI * 2.3 - 0.35) ** 2
        const wander = Math.sin(t * frequency + phase) * Math.min(0.065, length * 0.035) + Math.sin(t * 21 + phase * 2) * Math.min(0.012, length * 0.007)
        const spread = (lane * Math.min(0.32, length * 0.11) * swell + wander) * envelope
        const lift = Math.sin(Math.PI * t) ** 2 * (0.012 + 0.012 * Math.sin(t * 17 + phase))
        if (strand.rootRadius !== undefined) {
          // Hyphae run along the root skin, then peel into a fan at staggered
          // physical distances. Their departure no longer depends on stone distance.
          const peel = 0.12 + (fibre % 4) * 0.085
          const release = THREE.MathUtils.smoothstep(t * length, peel, ROOT_CONTINUATION + 0.4)
          const radius = sharedRadius(strand, t)
          // Start inside the carved root's irregular ring, then emerge through
          // the continuous surface. A circular skin at the tip left exposed fibre
          // endpoints hovering over the authored bark's narrower grooves.
          const skinRadius = radius * THREE.MathUtils.lerp(0.55, 1,
            THREE.MathUtils.smoothstep(t * length, 0, 0.18))
          const skinSide = lane * skinRadius * 0.78
          const skinTop = Math.sqrt(Math.max(0, skinRadius * skinRadius - skinSide * skinSide))
          point.addScaledVector(side, THREE.MathUtils.lerp(skinSide, spread, release))
          point.y += THREE.MathUtils.lerp(skinTop, lift, release)
        } else {
          point.addScaledVector(side, spread)
          point.y += lift
        }
        points.push(point)
      }
      // On a tight bend the inside offset can fold over itself. Reduce that
      // excursion until the fibre's local direction agrees with its parent.
      const centres = points.map((_, i) => strand.curve.getPointAt(i / 56))
      let curve = new NetworkCurve(points)
      for (let attempt = 0; attempt < 8; attempt++) {
        let forward = true
        for (let i = 1; i < 112; i++) {
          const t = i / 112
          if (curve.getTangent(t).dot(strand.curve.getTangentAt(t)) < 0.15) { forward = false; break }
        }
        if (forward) break
        points.forEach((point, i) => { if (i > 0 || strand.rootRadius === undefined) point.lerp(centres[i]!, 0.5) })
        curve = new NetworkCurve(points)
      }
      paths.push(curve)
      additions.push({ curve, owner: strand.owner, depth: 1, from: strand.from, to: strand.to,
        r0: 0.0012, r1: 0.0006, bundle: true, cordR0: 0.0028, cordR1: 0.0012,
        glow: 0.5 + 0.4 * (1 - Math.abs(lane)) + random() * 0.12 })
    }
    // Branch-and-rejoin fans replace individual transverse stitches. Each Y has
    // a shared skeleton junction and exact attachment to three existing hyphae.
    // A fine pipe-radius hierarchy makes the stem distinct from its daughters.
    const fanCount = strand.depth === 0 ? 32 : 16
    for (let fan = 0, attempts = 0; fan < fanCount && attempts < 384; attempts++) {
      const lane = 1 + Math.floor(random() * (paths.length - 3))
      const mirrored = random() < 0.5
      const pathAt = (i: number) => paths[mirrored ? paths.length - i : i]!
      const t0 = 0.12 + (fan + random()) / fanCount * 0.72
      let t1 = Math.min(0.97, t0 + (0.14 + random() * 0.2) / Math.max(1, length))
      const start = pathAt(lane).getPointAt(t0)
      const direction = strand.curve.getTangentAt(t0).setY(0).normalize()
      let endA = pathAt(lane + 1).getPointAt(t1), endB = pathAt(lane + 2).getPointAt(t1)
      const progress = (end: THREE.Vector3) => end.clone().sub(start).dot(direction)
      while (Math.min(progress(endA), progress(endB)) < 0.06 && t1 < 0.98) {
        t1 = Math.min(0.98, t1 + 0.025)
        endA = pathAt(lane + 1).getPointAt(t1); endB = pathAt(lane + 2).getPointAt(t1)
      }
      if (Math.min(progress(endA), progress(endB)) < 0.06 || Math.max(start.distanceTo(endA), start.distanceTo(endB)) > 0.5) continue
      fan++
      const across = new THREE.Vector3(-direction.z, 0, direction.x)
      const average = endA.clone().add(endB).multiplyScalar(0.5).sub(start)
      const junction = start.clone()
        .addScaledVector(direction, Math.min(progress(endA), progress(endB)) * 0.46)
        .addScaledVector(across, average.dot(across) * 0.46)
      junction.y = Math.max(start.y, endA.y, endB.y) + 0.008
      const split = THREE.MathUtils.lerp(t0, t1, 0.46)
      const emit = (from: THREE.Vector3, to: THREE.Vector3, a: number, b: number, stem: boolean) => {
        const middle = from.clone().lerp(to, 0.5)
        middle.y += 0.003
        additions.push({ curve: new NetworkCurve([from.clone(), middle, to.clone()]), owner: strand.owner,
          depth: 2, from: THREE.MathUtils.lerp(strand.from, strand.to, a),
          to: THREE.MathUtils.lerp(strand.from, strand.to, b), bridge: true, bundle: true,
          r0: stem ? 0.0009 : 0.0006, r1: 0.0005,
          cordR0: stem ? 0.002 : 0.00117, cordR1: stem ? Math.SQRT2 * 0.00117 : 0.00065,
          glow: stem ? 1.12 : 0.72 })
      }
      emit(start, junction, t0, split, true)
      emit(junction, endA, split, t1, false)
      emit(junction, endB, split, t1, false)
      // Sparse pinpoints emphasize shared growth junctions without lighting every crossing.
      if (fan % 4 === 0) junctions?.push({ at: junction.clone(), owner: strand.owner,
        at01: THREE.MathUtils.lerp(strand.from, strand.to, split), size: 0.065 })
    }
    // Seed a small 3D growth system on the connected paths. Its parent pointers,
    // not a regular cross-grid, determine where the finer root branches meet.
    const seeds: THREE.Vector3[] = [], seedTravel: number[] = []
    for (const path of [paths[1]!, paths[Math.ceil(fibreCount / 2)]!, paths[fibreCount]!]) for (let i = 0; i < 7; i++) {
      const t = 0.22 + i * 0.105
      seeds.push(path.getPointAt(t)); seedTravel.push(t)
    }
    const attractions: THREE.Vector3[] = []
    for (let i = 0; i < 60; i++) {
      const t = 0.2 + random() * 0.7
      const point = strand.curve.getPointAt(t), tangent = strand.curve.getTangentAt(t)
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      point.addScaledVector(side, (random() - 0.5) * Math.min(0.65, length * 0.25))
      point.y += 0.015 + random() * 0.065
      attractions.push(point)
    }
    const colony = colonizeRoots(seeds, attractions)
    const children = colony.map(() => [] as number[])
    colony.forEach((node, index) => { if (node.parent >= 0) children[node.parent]!.push(index) })
    const travel = colony.map((_, i) => seedTravel[i] ?? 0)
    for (let i = seeds.length; i < colony.length; i++) {
      const node = colony[i]!
      travel[i] = Math.min(1, travel[node.parent]! + node.at.distanceTo(colony[node.parent]!.at) / length)
    }
    // sqrt(descendant tips) is the n=2 pipe rule: parent area sums child areas.
    const radius = (index: number) => 0.0015 * colony[index]!.thickness
    for (let i = seeds.length; i < colony.length; i++) {
      const node = colony[i]!, parent = colony[node.parent]!
      if (parent.parent >= 0 && children[node.parent]!.length === 1) continue
      const points = [parent.at.clone(), node.at.clone()]
      let end = i
      while (children[end]!.length === 1) { end = children[end]![0]!; points.push(colony[end]!.at.clone()) }
      additions.push({ curve: new NetworkCurve(points), owner: strand.owner, depth: 2,
        from: THREE.MathUtils.lerp(strand.from, strand.to, travel[node.parent]!),
        to: THREE.MathUtils.lerp(strand.from, strand.to, travel[end]!),
        r0: 0.0006, r1: 0.0003, bundle: true, cordR0: radius(node.parent),
        cordR1: children[end]!.length ? radius(end) : 0.00005, terminal: children[end]!.length === 0 })
    }
  }
  return additions
}
