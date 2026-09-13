/**
 * Geometry helpers: the shapes Three.js does not ship.
 *
 * Only one real idea in here, and everything in the grove is built from it. Three.js's
 * `TubeGeometry` follows a curve at a *constant* radius, and nothing in this scene is a constant
 * radius: a trunk is fat at the root and thin at the tip, a root thins as it leaves the tree, a
 * monolith tapers to a point. `taperedTube` is a tube that takes a radius *function* instead of a
 * number, which turns out to be the whole difference between a scene made of pipes and one made
 * of grown things.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * A tube along `curve` whose radius is given by `radiusAt(t)`, for `t` from 0 to 1.
 *
 * Built the way `TubeGeometry` is: walk the curve, take a Frenet frame at each step, and ring
 * vertices around it. The single change is that the ring's radius is asked for rather than
 * assumed.
 *
 * `closed` caps both ends. Left open for anything that disappears into something else — a root
 * entering the ground, a branch meeting the trunk — since a cap you cannot see is triangles you
 * are paying for.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  segments = 64,
  radialSegments = 8,
  closed = false
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    const radius = Math.max(radiusAt(t), 1e-5)
    const frameNormal = frames.normals[i]
    const frameBinormal = frames.binormals[i]
    if (!frameNormal || !frameBinormal) continue

    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = -Math.cos(angle)

      normal.set(
        cos * frameNormal.x + sin * frameBinormal.x,
        cos * frameNormal.y + sin * frameBinormal.y,
        cos * frameNormal.z + sin * frameBinormal.z
      ).normalize()

      positions.push(point.x + radius * normal.x, point.y + radius * normal.y, point.z + radius * normal.z)
      normals.push(normal.x, normal.y, normal.z)
      // v runs along the curve, so a texture or a shader can flow *down* the length of it —
      // which is how the mycelium carries light from the tree to a stone.
      uvs.push(j / radialSegments, t)
    }
  }

  for (let i = 1; i <= segments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1)
      const b = (radialSegments + 1) * i + (j - 1)
      const c = (radialSegments + 1) * i + j
      const d = (radialSegments + 1) * (i - 1) + j
      indices.push(a, b, d, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  if (closed) geometry.computeVertexNormals()
  return geometry
}

/**
 * A deterministic pseudo-random number generator.
 *
 * The grove has to look the same every time it loads. With `Math.random`, every reload reshuffles
 * every leaf and every mote, which makes judging a look genuinely impossible — you cannot tell a
 * change you made from a reshuffle you did not. Seeded, a tweak to one number is the only thing
 * that moves.
 *
 * Mulberry32: small, fast, good enough for scattering leaves. Not for anything that matters.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A flat ring lying on the ground, for the concentric circles under the tree and each stone. */
export function groundRing(radius: number, thickness: number, segments = 128): THREE.BufferGeometry {
  const geometry = new THREE.RingGeometry(radius - thickness / 2, radius + thickness / 2, segments)
  // RingGeometry is born facing the camera; the grove wants it lying down.
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * Merge geometries that share a material into one.
 *
 * The scene reached 327 draw calls and 51fps before this, and almost none of it was the tree or
 * the stones: it was fifty-odd individually-drawn roots, filaments, ground rings and nodes, each
 * one a few hundred triangles. A draw call costs roughly the same whether it draws 50 triangles
 * or 5,000, so anything static that shares a material should be one call.
 *
 * Only safe for geometry that never moves independently, which is the whole ground layer here.
 * The stones stay separate because each is hovered, animated and rotated on its own.
 */
export function mergeAll(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geometries.length) return null
  if (geometries.length === 1) return geometries[0] ?? null
  return mergeGeometries(geometries, false)
}

/** Offset a geometry in place, so it can be merged while keeping its position. */
export function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z)
  return geometry
}
