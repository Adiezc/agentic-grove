/** Geometric contracts that prevent the wood/light/network handoff from drifting. */
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { colonizeRoots } from '../src/scene/colonizeRoots.ts'
import { growNetwork } from '../src/scene/network.ts'
import { ROOT_CONTINUATION, hyphaRadius } from '../src/scene/rootTransition.ts'
import { DAIS_INNER_TOP, TREE_YAW, TREE_SCALE } from '../src/scene/stage.ts'
import { CordVein, cordRadius } from '../src/scene/rootCord.ts'
import roots from '../assets/models/world-tree-roots.json'

const targets = [{ id: 'research', at: [-3.4, -2.5] as [number, number] },
  { id: 'build', at: [3.8, 1.5] as [number, number] },
  { id: 'child', at: [4.5, 1.8] as [number, number], from: [3.8, 1.5] as [number, number] }]
const network = growNetwork(targets)
assert.deepEqual(network, growNetwork(targets), 'root placement must be reproducible')
assert.ok(network.strands.length < 1800, 'bounded growth must not explode')
for (const target of targets) {
  assert.ok(network.strands.some((s) => s.owner === target.id && s.to === 1
    && s.curve.getPointAt(1).distanceTo(new THREE.Vector3(target.at[0], 0.012, target.at[1])) < 1e-6), 'project endpoint preserved')
}
for (const tip of roots.tips) {
  const expected = new THREE.Vector3(...tip.at as [number, number, number]).multiplyScalar(TREE_SCALE)
    .add(new THREE.Vector3(0, DAIS_INNER_TOP, 0)).applyAxisAngle(new THREE.Vector3(0, 1, 0), TREE_YAW)
  assert.ok(network.strands.some((s) => s.rootRadius !== undefined && s.curve.getPointAt(0).distanceTo(expected) < 1e-6), 'every authored root reaches the network')
}
for (const strand of network.strands) {
  assert.ok(strand.from >= 0 && strand.to <= 1 && strand.from <= strand.to, 'pulse coordinates remain ordered')
  for (const t of [0, 0.2, 0.5, 0.8, 1]) {
    const point = strand.curve.getPointAt(t)
    assert.ok([point.x, point.y, point.z].every(Number.isFinite))
  }
  if (strand.rootRadius === undefined) continue
  assert.equal(cordRadius(strand, 0), strand.rootRadius, 'start radius matches authored tip')
  const portion = Math.min(1, ROOT_CONTINUATION / strand.curve.getLength())
  assert.ok(Math.abs(cordRadius(strand, portion) - hyphaRadius(strand, portion)) < 1e-12,
    'even short roots finish tapering into a hypha')
  for (const t of [0, 0.17, 0.5, 0.83, 1]) {
    const centre = strand.curve.getPointAt(t)
    const vein = new CordVein(strand).getPointAt(t)
    assert.ok(Math.abs(vein.y - centre.y - cordRadius(strand, t) * 0.91) < 1e-12,
      'the luminous vein stays on the same physical surface')
  }
}
const seeds = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0, 0)]
const points = [new THREE.Vector3(0.3, 0, 0.2), new THREE.Vector3(0.2, 0, -0.2)]
const colony = colonizeRoots(seeds, points)
assert.ok(colony.length > seeds.length && colony.length <= 72, 'bounded colonization grows')
assert.deepEqual(colony, colonizeRoots(seeds, points), 'colonization is deterministic')
colony.forEach((node, index) => {
  assert.ok(node.parent < index, 'every twig is attached to an earlier node')
  assert.ok(Number.isFinite(node.thickness) && node.thickness >= 1)
})
console.log(`Root handoff, authored tips, pulse ownership, determinism and bounded colonization pass (${network.strands.length} strands).`)
