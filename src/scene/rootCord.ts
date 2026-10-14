/** Physical cord thickness and the vein running along its upper surface. */
import * as THREE from 'three'
import type { Strand } from './network'
import { sharedRadius } from './rootTransition'

export function cordRadius(strand: Strand, t: number): number {
  return sharedRadius(strand, t)
}

export class CordVein extends THREE.Curve<THREE.Vector3> {
  constructor(private strand: Strand) { super() }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.strand.curve.getPointAt(t, target)
    target.y += cordRadius(this.strand, t) * 0.91
    return target
  }
  override getPointAt(t: number, target = new THREE.Vector3()): THREE.Vector3 { return this.getPoint(t, target) }
  override getTangentAt(t: number, target = new THREE.Vector3()): THREE.Vector3 { return this.getTangent(t, target) }
}
