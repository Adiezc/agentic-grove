import assert from 'node:assert/strict'
import * as THREE from 'three'
import { growNetwork, type NetworkNode } from '../src/scene/network.ts'
import { myceliumStrip } from '../src/scene/myceliumStrip.ts'
import { junctionBrightness, ownerPhase } from '../src/scene/myceliumFlow.ts'
import { bundleHyphae } from '../src/scene/myceliumBundles.ts'
import { colonizeRoots } from '../src/scene/colonizeRoots.ts'
import { cordRadius, CordVein } from '../src/scene/rootCord.ts'
import { NetworkCurve, networkHeight } from '../src/scene/networkCurve.ts'
import { heightAt } from '../src/scene/stage.ts'

const network = growNetwork([{ id: 'a', at: [-3.4, -2.5] }, { id: 'b', at: [3.8, 1.5] }])
for (const strand of network.strands) {
  for (let i = 0; i <= 100; i++) {
    const point = strand.curve.getPointAt(i / 100)
    assert.ok([point.x, point.y, point.z].every(Number.isFinite))
    assert.ok(point.y >= heightAt(Math.hypot(point.x, point.z)) + 0.0059,
      'evaluated fibres clear the floor and both terrace edges')
  }
}
for (const distance of [3.6, 5.8, 7.2]) {
  const distant = growNetwork([{ id: 'far', at: [distance, 1.5] }])
  for (const main of distant.strands.filter((s) => s.owner === 'far' && s.depth === 0)) {
    let previous = 0
    for (let i = 15; i <= 100; i++) {
      const point = main.curve.getPointAt(i / 100), radius = Math.hypot(point.x, point.z)
      assert.ok(radius >= previous - 0.001, 'main routes do not reverse at out-of-order terrace stops')
      previous = radius
    }
  }
}
for (let radius = 1.8; radius < 2.7; radius += 0.001) {
  assert.ok(networkHeight(radius) >= heightAt(radius) + 0.0059)
  assert.ok(Math.abs(networkHeight(radius + 0.001) - networkHeight(radius)) < 0.002,
    'terrace clearance changes continuously instead of cutting vertically')
}
const bridges = network.strands.filter((s) => s.bridge && !s.bundle)
assert.ok(bridges.length > 0, 'the network must contain actual local joins')
for (const owner of ['a', 'b']) assert.ok(bridges.filter((s) => s.owner === owner).length <= 4)
for (const bridge of bridges) {
  assert.ok(bridge.from <= bridge.to, 'light moves forward around each loop')
  const originals = network.strands.filter((s) => !s.bridge && s.owner === bridge.owner)
  for (const t of [0, 1]) {
    const end = bridge.curve.getPointAt(t)
    const nearest = Math.min(...originals.flatMap((s) => [0.3, 0.55, 0.8, 1].map((at) => end.distanceTo(s.curve.getPointAt(at)))))
    assert.ok(nearest < 1e-9, 'both ends join filaments of the same owner exactly')
  }
}
const curve = new NetworkCurve([new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0.3, 0.1, 0.01), new THREE.Vector3(0.3, 0.1, 0.3)])
const strip = myceliumStrip(curve, () => 0.02, 24, [0.2, 0.7])
const positions = strip.getAttribute('position'), uv = strip.getAttribute('uv')
assert.equal(positions.count, 50, 'two vertices per strip sample')
assert.equal(strip.index!.count, 24 * 6)
for (let i = 0; i < positions.count; i += 2) {
  const left = new THREE.Vector3().fromBufferAttribute(positions, i)
  const right = new THREE.Vector3().fromBufferAttribute(positions, i + 1)
  const middle = left.clone().add(right).multiplyScalar(0.5)
  assert.ok(middle.distanceTo(curve.getPointAt(i / 48)) < 1e-7, 'strip centre follows the original curve')
  assert.ok(left.distanceTo(right) < 0.036001, 'join width stays bounded at corners')
  assert.ok([left.x, left.y, left.z, right.x, right.y, right.z].every(Number.isFinite))
}
assert.ok(Math.abs(uv.getY(0) - 0.2) < 1e-7 && Math.abs(uv.getY(49) - 0.7) < 1e-7)
const signal = { active: 1, attention: 0, grow: 0.3, beat: 0.2, time: 0.5 }
assert.equal(junctionBrightness(0.8, signal), 0, 'junction ahead of arriving growth remains dark')
assert.ok(junctionBrightness(0.5, { ...signal, grow: 1 }) > junctionBrightness(0.9, { ...signal, grow: 1 }), 'junction flares when the pulse arrives')
assert.equal(ownerPhase('a'), ownerPhase('a'), 'owner phase does not depend on insertion order')
assert.notEqual(ownerPhase('a'), ownerPhase('b'))
const junctions: NetworkNode[] = []
const bundle = bundleHyphae([{ curve, owner: 'bundle-test', depth: 0, from: 0, to: 1, r0: 0.004, r1: 0.003 }], junctions)
assert.equal(junctions.length, 8, 'only a sparse selection of fan junctions glows')
for (const node of junctions) {
  const stems = bundle.filter((s) => s.bridge && Math.abs(s.to - node.at01) < 1e-9
    && s.curve.getPointAt(1).distanceTo(node.at) < 1e-8)
  assert.equal(stems.length, 1, 'junction light sits on an actual fan stem')
  assert.equal(node.owner, 'bundle-test')
}
const fibres = bundle.filter((s) => s.from === 0 && s.to === 1)
assert.equal(fibres.length, 12, 'main connection gains twelve fine meandering hyphae')
assert.ok(bundle.length > fibres.length, 'space colonization supplies smaller connected branches')
for (const fibre of fibres) {
  assert.equal(fibre.owner, 'bundle-test')
  assert.ok(fibre.curve.getPointAt(0).distanceTo(curve.getPointAt(0)) < 1e-9)
  assert.ok(fibre.curve.getPointAt(1).distanceTo(curve.getPointAt(1)) < 1e-9)
  for (let i = 1; i < 112; i++) {
    assert.ok(fibre.curve.getTangent(i / 112).dot(curve.getTangentAt(i / 112)) >= 0.15,
      'inside fibres cannot fold back around a tight parent bend')
  }
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    assert.ok(fibre.curve.getPointAt(t).distanceTo(curve.getPointAt(t)) < 0.42, 'full fans stay inside a bounded shared corridor')
  }
}
const fusions = bundle.filter((s) => s.bridge)
assert.equal(fusions.length, 96, 'thirty-two forked fans fill the connection')
assert.equal(fusions.filter((s) => s.glow === 1.12).length, 32, 'each fan has a brighter shared stem')
for (const fusion of fusions) {
  const direction = curve.getTangentAt(fusion.from).setY(0).normalize()
  let previous = fusion.curve.getPointAt(0)
  for (let i = 1; i <= 24; i++) {
    const point = fusion.curve.getPointAt(i / 24)
    assert.ok(point.clone().sub(previous).dot(direction) > -1e-7, 'short fusion never doubles back')
    previous = point
  }
  for (const t of [0, 1]) {
    const end = fusion.curve.getPointAt(t)
    const journey = t === 0 ? fusion.from : fusion.to
    const attachments = [
      ...fibres.map((s) => end.distanceTo(s.curve.getPointAt(journey))),
      ...fusions.filter((s) => s !== fusion).flatMap((s) => [
        Math.abs(s.from - journey) < 1e-9 ? end.distanceTo(s.curve.getPointAt(0)) : Infinity,
        Math.abs(s.to - journey) < 1e-9 ? end.distanceTo(s.curve.getPointAt(1)) : Infinity,
      ]),
    ]
    assert.ok(Math.min(...attachments) < 1e-8, 'fan endpoints attach to a hypha or shared junction')
  }
}
for (const branch of bundle) {
  assert.ok(branch.cordR0! > 0 && branch.cordR1! > 0, 'grown branches have physical radii')
  assert.ok(branch.cordR0! >= branch.cordR1!, 'branches taper toward their ends')
}
const root = { curve, owner: 'root', depth: 0, from: 0, to: 1, r0: 0.004, r1: 0.003, rootRadius: 0.013 }
assert.equal(cordRadius(root, 0), root.rootRadius, 'cord begins at the authored root radius')
const peeled = bundleHyphae([root]).filter((s) => !s.bridge && s.from === 0 && s.to === 1)
assert.equal(peeled.length, 12)
for (const fibre of peeled) {
  const embedded = fibre.curve.getPointAt(0).sub(root.curve.getPointAt(0))
  assert.ok(embedded.length() > 0 && embedded.length() < root.rootRadius * 0.7 && embedded.y > 0,
    'fine hyphae begin inside the upper root volume, leaving no exposed attachment endpoints')
}
const companion = bundleHyphae([{ ...root, depth: 1 }]).filter((s) => !s.bridge && s.from === 0 && s.to === 1)
assert.equal(companion.length, 6, 'secondary roots also dissolve into connected fibres')

assert.ok(cordRadius(root, 0.4) > cordRadius(root, 1), 'parent cord tapers toward the stone')
const vein = new CordVein(root)
assert.ok(Math.abs(vein.getPointAt(0.5).y - curve.getPointAt(0.5).y - cordRadius(root, 0.5) * 0.91) < 1e-9, 'vein sits on the physical cord surface')
const colony = colonizeRoots([new THREE.Vector3()], [new THREE.Vector3(0.2, 0, 0.1), new THREE.Vector3(0.25, 0.02, -0.1)])
for (const [index, parent] of colony.entries()) {
  const children = colony.filter((node) => node.parent === index)
  if (!children.length) continue
  const childArea = children.reduce((sum, child) => sum + child.thickness ** 2, 0)
  assert.ok(Math.abs(parent.thickness ** 2 - childArea) < 1e-8, 'pipe model conserves summed child cross-section')
}
strip.dispose()
console.log(`Mycelium loop ownership, strip alignment/widths, growth visibility and junction pulses pass (${bridges.length} local joins).`)
