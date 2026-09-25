import * as THREE from 'three'
import { motion } from '../theme/palette'

export interface HeartbeatFrame {
  /** Zero between beats, one at the crest. */
  pulse: number
  /** Seconds for one complete heartbeat cycle. */
  period: number
}

function gaussian(phase: number, centre: number, width: number): number {
  const wrapped = Math.min(Math.abs(phase - centre), 1 - Math.abs(phase - centre))
  return Math.exp(-Math.pow(wrapped / width, 2))
}

/**
 * One clock for the whole organism.
 *
 * Work shortens the interval and strengthens the beat. Attention adds the recognisable second
 * knock of a heartbeat without turning the grove into a notification light. Tree, roots and
 * mycelium all sample this function, so their light can never drift out of phase.
 */
export function heartbeatFrame(elapsed: number, activity: number, attention = false): HeartbeatFrame {
  const workload = THREE.MathUtils.clamp(activity, 0, 1)
  const period = THREE.MathUtils.lerp(motion.breathIdleSeconds, motion.breathBusySeconds, workload)
  const phase = (elapsed / period) % 1
  const primary = gaussian(phase, 0.12, 0.055)
  const secondary = gaussian(phase, 0.25, 0.042) * (attention ? 0.8 : 0.24 + workload * 0.16)
  return { pulse: THREE.MathUtils.clamp(primary + secondary, 0, 1), period }
}
