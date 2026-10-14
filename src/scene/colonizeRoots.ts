/**
 * Small TypeScript port of tree_grow_step's associate/average/grow/kill stages
 * and tree_compute_thickness from jakobrichert/space-colonization/src/tree.c.
 * Copyright (c) 2026 Jakob. MIT: licenses/space-colonization.txt.
 * Revision 34966a3cece4a1d6f69f26631db93ffec200f545.
 * The referenced method is by Adam Runions, Brendan Lane and Przemyslaw Prusinkiewicz.
 * Grove supplies existing path seeds and ground attraction points, caps growth,
 * uses a small linear nearest search and omits the raylib app/spatial grid.
 */
import * as THREE from 'three'

export interface RootNode { at: THREE.Vector3; parent: number; thickness: number }

export function colonizeRoots(seeds: THREE.Vector3[], attractions: THREE.Vector3[]): RootNode[] {
  const nodes = seeds.map((at): RootNode => ({ at: at.clone(), parent: -1, thickness: 1 }))
  let points = attractions.map((at) => at.clone())
  const step = 0.065, influence = 0.36, kill = 0.085
  for (let iteration = 0; iteration < 16 && nodes.length < 72 && points.length; iteration++) {
    const directions = nodes.map(() => new THREE.Vector3())
    const counts = nodes.map(() => 0)
    for (const point of points) {
      let nearest = -1, distance = influence * influence
      nodes.forEach((node, index) => {
        const d = node.at.distanceToSquared(point)
        if (d < distance) { distance = d; nearest = index }
      })
      if (nearest >= 0) {
        directions[nearest]!.add(point.clone().sub(nodes[nearest]!.at).normalize())
        counts[nearest] = counts[nearest]! + 1
      }
    }
    const before = nodes.length
    for (let index = 0; index < before && nodes.length < 72; index++) {
      if (!counts[index] || directions[index]!.lengthSq() < 1e-10) continue
      const at = nodes[index]!.at.clone().addScaledVector(directions[index]!.normalize(), step)
      // Reject near duplicates, including new nodes from this iteration.
      if (nodes.some((node) => node.at.distanceToSquared(at) < (step * 0.3) ** 2)) continue
      nodes.push({ at, parent: index, thickness: 1 })
    }
    points = points.filter((point) => !nodes.some((node) => node.at.distanceToSquared(point) < kill * kill))
    if (nodes.length === before) break
  }
  // Upstream's square-root leaf count gives thicker shared branches than terminal hairs.
  const leaves = nodes.map(() => 0)
  nodes.forEach((node) => { if (node.parent >= 0) leaves[node.parent] = leaves[node.parent]! + 1 })
  for (let index = 0; index < nodes.length; index++) leaves[index] = leaves[index] === 0 ? 1 : 0
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    node.thickness = Math.sqrt(leaves[index]!)
    if (node.parent >= 0) leaves[node.parent] = leaves[node.parent]! + leaves[index]!
  }
  return nodes
}
