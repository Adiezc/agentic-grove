/** Continue the authored root boundary, preserving its full circumference and vertex normals. */
import * as THREE from 'three'
import type { Strand } from './network'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from './stage'
import authoredRoots from '../../assets/models/world-tree-roots.json'
import { ROOT_CONTINUATION, sharedRadius } from './rootTransition'

export interface BarkVertex {
  at: THREE.Vector3
  normal: THREE.Vector3
  colour: THREE.Color
  glow: number
  island: number
  grain?: THREE.Vector3
}

const islandCache = new WeakMap<THREE.BufferGeometry, Int32Array>()
/** The merged GLB still contains separate connected root surfaces. Keep nearby roots distinct. */
export function barkIslands(geometry: THREE.BufferGeometry): Int32Array {
  const cached = islandCache.get(geometry)
  if (cached) return cached
  const parents = Int32Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i)
  const find = (i: number): number => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]!]!; i = parents[i]! }
    return i
  }
  const index = geometry.getIndex()
  if (index) for (let i = 0; i < index.count; i += 3) {
    const a = find(index.getX(i)), b = find(index.getX(i + 1)), c = find(index.getX(i + 2))
    parents[b] = a; parents[c] = a
  }
  for (let i = 0; i < parents.length; i++) parents[i] = find(i)
  islandCache.set(geometry, parents)
  return parents
}

export function rootBoundary(strand: Strand, bark: BarkVertex[]): BarkVertex[] {
  const origin = strand.curve.getPointAt(0).sub(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
  const authored = authoredRoots.tips.find(tip => new THREE.Vector3(...tip.at as [number, number, number])
    .multiplyScalar(TREE_SCALE).applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW).distanceTo(origin) < 0.0002)
  if (!authored) return []
  const tangent = new THREE.Vector3(...authored.direction as [number, number, number])
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW).normalize()
  const islands = new Map<number, Map<string, BarkVertex>>()
  for (const vertex of bark) {
    const delta = vertex.at.clone().sub(origin)
    if (delta.length() > (strand.rootRadius ?? 0) * 1.65 || Math.abs(delta.dot(tangent)) > 0.002) continue
    const unique = islands.get(vertex.island) ?? new Map<string, BarkVertex>()
    islands.set(vertex.island, unique)
    const key = vertex.at.toArray().map(n => n.toFixed(5)).join(':')
    const existing = unique.get(key)
    // Exported cap vertices share positions with the side but have a different normal.
    if (!existing || Math.abs(vertex.normal.dot(tangent)) < Math.abs(existing.normal.dot(tangent))) unique.set(key, vertex)
  }
  const unique = [...islands.values()].sort((a, b) => b.size - a.size)[0]
  if (!unique || unique.size < 12) return [] // Runtime colony twigs do not have an authored boundary.
  const u = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize()
  const v = new THREE.Vector3().crossVectors(tangent, u).normalize()
  return [...unique.values()].sort((a, b) => {
    const x = a.at.clone().sub(origin), y = b.at.clone().sub(origin)
    return Math.atan2(x.dot(v), x.dot(u)) - Math.atan2(y.dot(v), y.dot(u))
  })
}

export function weldedRoot(strand: Strand, boundary: BarkVertex[]): THREE.BufferGeometry {
  const length = strand.curve.getLength()
  const segments = Math.max(24, Math.ceil(length * 36))
  const sides = boundary.length || 8
  const origin = strand.curve.getPointAt(0).sub(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
  const initial = strand.curve.getTangentAt(0)
  const u = new THREE.Vector3().crossVectors(initial, new THREE.Vector3(0, 1, 0)).normalize()
  const v = new THREE.Vector3().crossVectors(initial, u).normalize()
  const positions: number[] = [], colours: number[] = [], blends: number[] = [], glows: number[] = [], journeys: number[] = [], grains: number[] = [], uv: number[] = [], indices: number[] = []
  const colour = boundary[0]?.colour ?? new THREE.Color('#6a5d49')
  const rotation = new THREE.Quaternion()
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, distance = t * length
    const point = strand.curve.getPointAt(t).sub(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
    rotation.setFromUnitVectors(initial, strand.curve.getTangentAt(t))
    const round = THREE.MathUtils.smoothstep(distance, 0, 0.3)
    for (let j = 0; j < sides; j++) {
      const sample = boundary[j]
      const offset = sample ? sample.at.clone().sub(origin) : u.clone().multiplyScalar(Math.cos(j / sides * Math.PI * 2))
        .addScaledVector(v, Math.sin(j / sides * Math.PI * 2)).multiplyScalar(strand.rootRadius ?? 0.003)
      const authoredRadius = offset.length()
      const radial = offset.clone().addScaledVector(initial, -offset.dot(initial))
      offset.lerp(radial, round)
      offset.normalize().multiplyScalar(sharedRadius(strand, t) * THREE.MathUtils.lerp(authoredRadius / (strand.rootRadius ?? 0.003), 1, round)).applyQuaternion(rotation)
      const position = point.clone().add(offset)
      // Copy the boundary exactly, including the tiny longitudinal relief of its carved ring.
      if (i === 0 && sample) position.copy(sample.at)
      position.toArray(positions, positions.length)
      ;(sample?.colour ?? colour).toArray(colours, colours.length)
      blends.push(THREE.MathUtils.smoothstep(distance, 0, Math.min(ROOT_CONTINUATION, length)))
      glows.push(sample?.glow ?? 1.6)
      const along = sample?.grain?.y ?? 0
      grains.push(sample?.grain?.x ?? j / sides, along + distance * (along < 0.01 ? -1 : 1), sample?.grain?.z ?? 0)
      journeys.push(THREE.MathUtils.lerp(strand.from, strand.to, t))
      uv.push(j / sides, t)
      if (i < segments) {
        const a = i * sides + j, b = a + sides, d = i * sides + (j + 1) % sides, c = d + sides
        indices.push(a, d, b, b, d, c)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('_grain', new THREE.Float32BufferAttribute(grains, 3))
  geometry.setAttribute('_glow', new THREE.Float32BufferAttribute(glows, 1))
  geometry.setAttribute('rootBlend', new THREE.Float32BufferAttribute(blends, 1))
  geometry.setAttribute('rootJourney', new THREE.Float32BufferAttribute(journeys, 1))
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  boundary.forEach((vertex, j) => {
    normals.setXYZ(j, vertex.normal.x, vertex.normal.y, vertex.normal.z)
  })
  return geometry
}
