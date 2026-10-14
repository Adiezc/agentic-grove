/** A single radius profile for the welded wood-to-hypha surface and its luminous vein. */
import * as THREE from 'three'
import type { Strand } from './network'

export const ROOT_CONTINUATION = 0.8

export function hyphaRadius(strand: Strand, at: number): number {
  if (strand.cordR0 !== undefined) return THREE.MathUtils.lerp(strand.cordR0, strand.cordR1 ?? 0.001, at)
  const start = strand.depth === 0 ? 0.007 : strand.depth === 1 ? 0.003 : 0.0015
  return start * (1 - 0.62 * at)
}

export function sharedRadius(strand: Strand, at: number): number {
  if (strand.rootRadius === undefined) return hyphaRadius(strand, at)
  const distance = at * strand.curve.getLength()
  return THREE.MathUtils.lerp(strand.rootRadius, hyphaRadius(strand, at),
    THREE.MathUtils.smoothstep(distance, 0, Math.min(ROOT_CONTINUATION, strand.curve.getLength())))
}

/**
 * The one look a root has by the time it becomes mycelium, shared by the tree's root tips, the
 * welded continuation and the network's cords. When each of the three chose its own colour, the
 * eye found the join at once: tan bark lit mint read as yellow, beside cords that were green.
 */
export const HYPHA_BODY = '#69c58b'
export const HYPHA_GLOW = '#55f58c'
/** `_glow` values above the trunk's own groove light: only root tips reach this band. */
export const HYPHA_TIP_GLOW: [number, number] = [0.5, 1.35]
