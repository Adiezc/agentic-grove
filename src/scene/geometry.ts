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
 *
 * `vRange` remaps the `v` texture coordinate, which normally runs 0 to 1 along the tube. The
 * mycelium needs this: a fork hanging off a root two thirds of the way along should light up when
 * the pulse reaches *that point of the root*, not when a pulse of its own starts. Giving the fork
 * a `v` range of, say, `[0.66, 0.70]` means the one travelling window in the shader lights the
 * whole subtree in the right order, for free and with no extra state anywhere.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusAt: (t: number) => number,
  segments = 64,
  radialSegments = 8,
  closed = false,
  vRange: [number, number] = [0, 1]
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
      uvs.push(j / radialSegments, vRange[0] + t * (vRange[1] - vRange[0]))
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

/**
 * A flat strip lying on the ground, following `curve`, `widthAt(t)` wide.
 *
 * This is the second half of how light on the floor is drawn, and the reason for it is worth
 * stating. In the concept art a root is not a green tube lying on the stone — it is a *very*
 * thin white-hot line with a soft wash of green bleeding out of it onto wet rock. Drawn as a tube
 * alone you get the line and none of the wash, and the scene reads as green spaghetti; drawn as a
 * ribbon alone you get the wash and no line. So everything on the floor is both: a hair-thin
 * tapered tube for the core, and one of these underneath it, much wider and barely there.
 *
 * `u` runs across the ribbon, so the shader can fade it out towards the edges; `v` runs along it,
 * remapped by `vRange` exactly as in `taperedTube`, so a pulse lights the core and the wash
 * together.
 */
export function flatRibbon(
  curve: THREE.Curve<THREE.Vector3>,
  widthAt: (t: number) => number,
  segments = 48,
  lift = 0.002,
  vRange: [number, number] = [0, 1]
): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side = new THREE.Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPointAt(t, point)
    curve.getTangentAt(t, tangent)
    // Sideways on the ground plane. Deliberately not the Frenet binormal: a curve that dips and
    // rises would twist the ribbon up on edge, and a ribbon on edge is invisible at this camera
    // angle — which is the whole reason the first version of the network could not be seen.
    side.set(-tangent.z, 0, tangent.x)
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
    side.normalize().multiplyScalar(widthAt(t) / 2)

    positions.push(point.x - side.x, point.y + lift, point.z - side.z)
    positions.push(point.x + side.x, point.y + lift, point.z + side.z)
    const v = vRange[0] + t * (vRange[1] - vRange[0])
    uvs.push(0, v, 1, v)
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Flat on the floor, so every normal points straight up. Cheaper and steadier than computing
  // them, and nothing lit is ever drawn with this.
  const normals = new Float32Array((positions.length / 3) * 3)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geometry
}

/** Everything that makes one crystal different from the next. See `crystal` below. */
export interface CrystalSpec {
  /** Faces around the shaft. The art has a mix of four, five and six. */
  sides: number
  /** Radius at the foot and at the shoulder where the point begins. */
  footRadius: number
  shoulderRadius: number
  /** Height of the shaft, and of the point on top of it. */
  shaftHeight: number
  capHeight: number
  /** Where the apex ridge sits relative to the axis, and how long it is. */
  ridgeOffset: [number, number]
  ridgeLength: number
  /** Direction of the ridge on the ground plane, in radians. */
  ridgeAngle: number
  /** How far the whole crystal leans, and in which direction. */
  lean: number
  leanAngle: number
  /** Rotation of the facets about the axis, so two crystals of the same cut are not twins. */
  roll: number
  /**
   * Depth relative to width, front to back. Below 1 the crystal is a slab, which is how many of
   * the real Ogham stones stand: broad face to the viewer, narrow edge to the side. Default 1.
   */
  flatten?: number
}

/**
 * A quartz point.
 *
 * The stones in the concept art are not cones on cylinders, which is what the first pass built
 * and what made them read as traffic bollards. They are quartz: a faceted shaft, and on top of it
 * a **chisel termination** — two or three big slanted planes meeting along a short off-centre
 * ridge rather than at a point. That ridge is the whole difference. A symmetric point is a
 * signpost; a ridge that sits off to one side and runs at its own angle is a crystal, and it is
 * also what gives each stone a distinct silhouette from any direction.
 *
 * Built face by face and left non-indexed on purpose, so `computeVertexNormals` produces flat
 * facets rather than a smoothed blob. The facets are the object.
 */
export function crystal(spec: CrystalSpec): THREE.BufferGeometry {
  const {
    sides,
    footRadius,
    shoulderRadius,
    shaftHeight,
    capHeight,
    ridgeOffset,
    ridgeLength,
    ridgeAngle,
    lean,
    leanAngle,
    roll,
    flatten = 1,
  } = spec

  const positions: number[] = []
  const push = (v: THREE.Vector3) => positions.push(v.x, v.y, v.z)
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    push(a)
    push(b)
    push(c)
  }

  const ringAt = (radius: number, y: number) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = roll + (i / sides) * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius * flatten)
    })

  const foot = ringAt(footRadius, 0)
  const shoulder = ringAt(shoulderRadius, shaftHeight)

  // The apex: two points, a short distance apart, which is what makes a chisel rather than a spike.
  const apexY = shaftHeight + capHeight
  const half = ridgeLength / 2
  const ridgeDirection = new THREE.Vector3(Math.cos(ridgeAngle), 0, Math.sin(ridgeAngle))
  const centre = new THREE.Vector3(ridgeOffset[0], apexY, ridgeOffset[1] * flatten)
  const apexA = centre.clone().addScaledVector(ridgeDirection, -half)
  const apexB = centre.clone().addScaledVector(ridgeDirection, half)

  for (let i = 0; i < sides; i++) {
    const a = foot[i]!
    const b = foot[(i + 1) % sides]!
    const c = shoulder[(i + 1) % sides]!
    const d = shoulder[i]!
    tri(a, b, c)
    tri(a, c, d)
  }

  /* Each shoulder vertex belongs to whichever end of the ridge it is nearer, projected onto the
   * ridge line. Where two neighbours belong to different ends, the face between them spans both
   * and becomes one of the two big planes that catch the light. Doing it this way rather than
   * hand-listing faces means the same code builds a four-sided and a six-sided cut. */
  const nearestApex = (v: THREE.Vector3) =>
    ridgeDirection.dot(v.clone().sub(centre).setY(0)) < 0 ? apexA : apexB

  for (let i = 0; i < sides; i++) {
    const a = shoulder[i]!
    const b = shoulder[(i + 1) % sides]!
    const pa = nearestApex(a)
    const pb = nearestApex(b)
    if (pa === pb) {
      tri(a, b, pa)
    } else {
      tri(a, b, pb)
      tri(a, pb, pa)
    }
  }

  // Close the bottom, because a stone's foot sits in a pool of its own reflected light and an
  // open shell shows the inside of the far wall through it.
  for (let i = 1; i < sides - 1; i++) tri(foot[0]!, foot[i + 1]!, foot[i]!)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

  if (lean !== 0) {
    // Lean grows with height, so the foot stays planted and the point travels. Same idea as the
    // shear the first pass used, kept because it is the only way a stone tilts without its base
    // lifting off the floor.
    const array = geometry.attributes.position!.array as Float32Array
    const total = shaftHeight + capHeight
    const dx = Math.cos(leanAngle) * lean
    const dz = Math.sin(leanAngle) * lean
    for (let i = 0; i < array.length; i += 3) {
      const t = (array[i + 1] ?? 0) / total
      const amount = t ** 1.35
      array[i] = (array[i] ?? 0) + dx * amount
      array[i + 2] = (array[i + 2] ?? 0) + dz * amount
    }
  }

  geometry.computeVertexNormals()
  return geometry
}
