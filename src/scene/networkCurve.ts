/** Continuous ground clearance, including both raised terrace edges. */
import * as THREE from 'three'
import { DAIS_INNER_RADIUS, DAIS_INNER_TOP, DAIS_RADIUS, DAIS_TOP, heightAt } from './stage'

export function networkHeight(radius: number): number {
  const inner = THREE.MathUtils.smoothstep(radius, DAIS_INNER_RADIUS - 0.1, DAIS_INNER_RADIUS)
  const outer = THREE.MathUtils.smoothstep(radius, DAIS_RADIUS, DAIS_RADIUS + 0.12)
  return THREE.MathUtils.lerp(DAIS_INNER_TOP, DAIS_TOP, inner) * (1 - outer) + 0.006
}

/** Clamp the evaluated spline, not only its controls: splines can dip between controls.
 * The short ramps start before an upward step and end after a downward step, so the
 * curve clears the actual platform without a discontinuity at either rim.
 */
export class NetworkCurve extends THREE.CatmullRomCurve3 {
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    super.getPoint(t, target)
    const radius = Math.hypot(target.x, target.z)
    const start = this.points[0]!
    const startRadius = Math.hypot(start.x, start.z)
    let clearance = networkHeight(radius)
    // An authored rootlet can clear the real inner floor but sit below the
    // anticipatory terrace ramp. Preserve that attachment, easing into the ramp
    // before the actual step instead of lifting the very first vertex off its root.
    if (start.y >= heightAt(startRadius) + 0.006 && start.y < networkHeight(startRadius)) {
      const run = Math.min(0.12, Math.max(0.01, DAIS_INNER_RADIUS - startRadius))
      clearance = THREE.MathUtils.lerp(start.y, clearance,
        THREE.MathUtils.smoothstep(target.distanceTo(start), 0, run))
    }
    target.y = Math.max(target.y, clearance, heightAt(radius) + 0.006)
    return target
  }
}
