/**
 * The attention mote: when a stone needs you, a small amber light lifts off it and drifts in to
 * the trunk, again and again, until you answer.
 *
 * This is the signal the brief reserved motes for, and why the ambient motes in `Motes.tsx` never
 * leave the canopy: a light that *travels from a stone to the tree* only means something if nothing
 * else does. It is meant for the corner of your eye. One mote per waiting stone, a slow arc of
 * about seven seconds, fading in and out so it never pops, and each stone's on its own phase so
 * two waiting stones do not pulse in step.
 *
 * Amber, the one colour that means "something needs you". Under reduced motion there are no motes:
 * the stone's amber and its label already say it without movement.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import type { StoneSpec } from './Runestone'
import { STONE_HEIGHT } from './stage'

/** Seconds for one journey from stone to trunk. */
const JOURNEY_SECONDS = 7
/** Where the motes arrive: low on the trunk, where the roots gather. */
const TRUNK: [number, number, number] = [0, 1.15, 0]

const MOTE = new THREE.SphereGeometry(0.045, 12, 8)
const HALO = new THREE.SphereGeometry(0.11, 12, 8)

/** A number from a string, so each stone keeps its own phase from one frame to the next. */
function phaseOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

function Mote({ stone }: { stone: StoneSpec }) {
  // A curve from the stone's shoulder, up and over, down into the trunk.
  const curve = useMemo(() => {
    const top = STONE_HEIGHT * (stone.scale ?? 1) * 0.85
    const start = new THREE.Vector3(stone.at[0], top, stone.at[1])
    const end = new THREE.Vector3(...TRUNK)
    const middle = start.clone().lerp(end, 0.5)
    middle.y = Math.max(start.y, end.y) + 0.9
    return new THREE.QuadraticBezierCurve3(start, middle, end)
  }, [stone.at[0], stone.at[1], stone.scale])
  const [core, glow] = useMemo(
    () => [
      new THREE.MeshBasicMaterial({ color: palette.waiting, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: palette.waiting, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    ],
    []
  )
  const group = useRef<THREE.Group>(null)
  const offset = useMemo(() => phaseOf(stone.id), [stone.id])
  const point = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime / JOURNEY_SECONDS + offset) % 1
    // Eased along the path: lifts off slowly, travels, settles into the trunk.
    const eased = t * t * (3 - 2 * t)
    curve.getPoint(eased, point)
    group.current?.position.copy(point)
    // In over the first fifth, out over the last quarter, so it never appears or vanishes abruptly.
    const fade = Math.min(1, t / 0.2, (1 - t) / 0.25)
    core.opacity = 0.95 * fade
    glow.opacity = 0.22 * fade
  })

  return (
    <group ref={group}>
      <mesh geometry={MOTE} material={core} />
      <mesh geometry={HALO} material={glow} />
    </group>
  )
}

export function AttentionMotes({ stones, animate }: { stones: StoneSpec[]; animate: boolean }) {
  if (!animate) return null
  return (
    <>
      {stones
        .filter((stone) => stone.status === 'waiting')
        .map((stone) => (
          <Mote key={stone.id} stone={stone} />
        ))}
    </>
  )
}
