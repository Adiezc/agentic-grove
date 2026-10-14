/**
 * MeshLine's previous/current/next direction averaging, paired vertices and
 * side/width expansion adapted to floor-space strips, without its runtime.
 * Source: pmndrs/meshline src/MeshLineMaterial.ts and MeshLineGeometry.ts,
 * revision 4df8778398e086628076267c67552c079d39be85.
 * Copyright (c) 2016 Jaume Sanchez. MIT: licenses/meshline.txt.
 * Maintained by pmndrs, following spite/THREE.MeshLine and subsequent contributors.
 * Grove uses bounded miter joins and original arc-length UVs. Mycelium.tsx also
 * adapts projected previous/next expansion for visible fine cores. Raycasting,
 * dashes and memcpy are omitted.
 */
import * as THREE from 'three'

export function myceliumStrip(curve: THREE.Curve<THREE.Vector3>, widthAt: (t: number) => number,
  segments: number, range: [number, number], lift = 0): THREE.BufferGeometry {
  const points = Array.from({ length: segments + 1 }, (_, i) => curve.getPointAt(i / segments))
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const current = points[i]!, previous = points[Math.max(0, i - 1)]!, next = points[Math.min(segments, i + 1)]!
    const incoming = current.clone().sub(previous).setY(0).normalize()
    const outgoing = next.clone().sub(current).setY(0).normalize()
    const direction = i === 0 ? outgoing : i === segments ? incoming : incoming.clone().add(outgoing).normalize()
    if (direction.lengthSq() < 1e-8) direction.copy(outgoing.lengthSq() ? outgoing : new THREE.Vector3(1, 0, 0))
    const side = new THREE.Vector3(-direction.z, 0, direction.x)
    const perp = new THREE.Vector3(-incoming.z, 0, incoming.x)
    const miter = i === 0 ? 1 : Math.min(1.8, 1 / Math.max(0.55, Math.abs(side.dot(perp))))
    side.multiplyScalar(widthAt(i / segments) * 0.5 * miter)
    positions.push(current.x - side.x, current.y + lift, current.z - side.z,
      current.x + side.x, current.y + lift, current.z + side.z)
    const travel = THREE.MathUtils.lerp(range[0], range[1], i / segments)
    uv.push(0, travel, 1, travel)
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return geometry
}
