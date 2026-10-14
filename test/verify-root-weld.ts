/** Validate the actual shipped GLB against the runtime root surface, around its entire rim. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { growNetwork } from '../src/scene/network'
import { rootBoundary, weldedRoot, barkIslands, type BarkVertex } from '../src/scene/rootWeld'
import { cordRadius } from '../src/scene/rootCord'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from '../src/scene/stage'
import roots from '../assets/models/world-tree-roots.json'

const bytes = await fs.readFile(new URL('../assets/models/world-tree-blender.glb', import.meta.url))
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const scale = 4.25 * TREE_SCALE / new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y
const transform = new THREE.Matrix4().makeRotationY(TREE_YAW).multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
const normalTransform = new THREE.Matrix3().getNormalMatrix(transform)
const bark: BarkVertex[] = []
gltf.scene.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return
  if (!object.name.includes('Carved_Anatomy')) return
  const islands = barkIslands(object.geometry)
  const a = object.geometry.attributes
  assert.equal(a._grain?.itemSize, 3, 'authored grain coordinates must survive GLB export')
  for (let i = 0; i < a.position!.count; i++) {
    const at = new THREE.Vector3().fromBufferAttribute(a.position!, i).applyMatrix4(transform)
    if (at.y > 0.12) continue
    bark.push({ at, island: islands[i]!, normal: new THREE.Vector3().fromBufferAttribute(a.normal!, i).applyNormalMatrix(normalTransform),
      grain: a._grain ? new THREE.Vector3().fromBufferAttribute(a._grain, i) : undefined,
      colour: new THREE.Color().fromBufferAttribute(a.color!, i), glow: a._glow?.getX(i) ?? 1.6 })
  }
})
const network = growNetwork([{ id: 'one', at: [-3.4, -2.5] }, { id: 'two', at: [3.8, 1.5] }])
let checked = 0
for (const tip of roots.tips) {
  const at = new THREE.Vector3(...tip.at as [number, number, number]).multiplyScalar(TREE_SCALE).applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW)
    .add(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
  const strand = network.strands.find(s => s.rootRadius !== undefined && s.curve.getPointAt(0).distanceTo(at) < 1e-6)!
  assert.ok(strand, 'every authored root has a runtime continuation')
  const boundary = rootBoundary(strand, bark)
  assert.ok(boundary.length === 24 || boundary.length === 64, `authored ring is complete, not a partial top-surface patch (${boundary.length})`)
  const geometry = weldedRoot(strand, boundary)
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
  for (let j = 0; j < boundary.length; j++) {
    assert.ok(new THREE.Vector3().fromBufferAttribute(position, j).distanceTo(boundary[j]!.at) < 1e-6, 'all sides share the authored boundary')
    assert.ok(new THREE.Vector3().fromBufferAttribute(normal, j).distanceTo(boundary[j]!.normal) < 1e-6, 'normals match at the seam')
    if (boundary[j]!.grain) assert.ok(new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('_grain'), j).distanceTo(boundary[j]!.grain!) < 1e-6, 'procedural grain also meets the authored root without a material seam')
  }
  const blend = geometry.getAttribute('rootBlend')
  assert.equal(blend.getX(0), 0)
  assert.equal(blend.getX(blend.count - 1), 1, 'even a short root finishes its material transition')
  const endCentre = new THREE.Vector3()
  for (let j = position.count - boundary.length; j < position.count; j++) endCentre.add(new THREE.Vector3().fromBufferAttribute(position, j))
  endCentre.divideScalar(boundary.length).add(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
  assert.ok(endCentre.distanceTo(strand.curve.getPointAt(1)) < 0.0005, 'one uninterrupted body reaches the network endpoint')
  const ring = Math.min(12, Math.floor(position.count / boundary.length) - 2)
  const centre = strand.curve.getPointAt(ring / (position.count / boundary.length - 1)).sub(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
  const i = ring * boundary.length
  assert.ok(new THREE.Vector3().fromBufferAttribute(normal, i).dot(new THREE.Vector3().fromBufferAttribute(position, i).sub(centre)) > 0, 'surface winding faces outward')
  geometry.dispose()
  checked++
}
console.log(`${checked} authored roots: complete circumference, exact seam positions/normals, outward winding and uninterrupted endpoint continuity pass.`)

for (const targets of [[], [{ id: 'one', at: [-3.4, -2.5] as [number, number] }],
  Array.from({ length: 12 }, (_, i) => ({ id: String(i), at: [Math.cos(i * Math.PI / 6) * 4, Math.sin(i * Math.PI / 6) * 4] as [number, number] }))]) {
  const web = growNetwork(targets)
  const parents = web.strands.filter(s => s.rootRadius !== undefined)
  for (const tip of roots.rootlets) {
    const origin = new THREE.Vector3(...tip.at as [number, number, number]).multiplyScalar(TREE_SCALE).applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW)
      .add(new THREE.Vector3(0, DAIS_INNER_TOP, 0))
    const join = web.strands.find(s => s.connectedTip && s.curve.getPointAt(0).distanceTo(origin) < 1e-6)
    assert.ok(join, 'every fine rootlet reaches an outgoing network strand')
    const end = join.curve.getPointAt(1)
    assert.ok(parents.some(parent => parent.owner === join.owner && Array.from({ length: 32 }, (_, i) => (i + 1) / 32).some(t => {
      const expected = parent.curve.getPointAt(t)
      expected.y += cordRadius(parent, t) * 0.65
      return end.distanceTo(expected) < 1e-6
    })), 'rootlet endpoint physically meets its owning root body')
  }
}
console.log('All 114 fine rootlets fuse into the network in empty, single-project and 12-project groves.')
