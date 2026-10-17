/**
 * The team talking: each message between agents is a pulse of light travelling between them.
 *
 * PM lives in the tree, so a message to or from PM runs between the trunk and the worker's stone;
 * one between two workers runs from stone to stone. A question and a reply look alike: a bright
 * bead with a soft halo, about two seconds, lifted in a low arc so it reads as passing between
 * them rather than along the ground. Green, the grove's working colour: amber stays reserved for
 * "something needs you". Each pulse plays once, from the moment the message was sent
 * (`core/team/book.ts`). Under reduced motion there are none; the conversation lists every message.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import type { StoneSpec } from './Runestone'
import { STONE_HEIGHT } from './stage'
import type { TalkPulse } from '../../core/team/book.ts'

const SECONDS = 2.2
const TRUNK: [number, number, number] = [0, 1.6, 0]
const BEAD = new THREE.SphereGeometry(0.05, 12, 8)
const HALO = new THREE.SphereGeometry(0.14, 12, 8)

function placeOf(stoneId: string | null, stones: StoneSpec[]): THREE.Vector3 | null {
  if (stoneId === null) return new THREE.Vector3(...TRUNK)
  const stone = stones.find((each) => each.id === stoneId)
  if (!stone) return null
  return new THREE.Vector3(stone.at[0], STONE_HEIGHT * (stone.scale ?? 1) * 0.9, stone.at[1])
}

function Pulse({ pulse, stones, wallOffset }: { pulse: TalkPulse; stones: StoneSpec[]; wallOffset: number }) {
  const curve = useMemo(() => {
    const start = placeOf(pulse.from, stones)
    const end = placeOf(pulse.to, stones)
    if (!start || !end || start.distanceTo(end) < 0.01) return null
    const middle = start.clone().lerp(end, 0.5)
    middle.y = Math.max(start.y, end.y) + 0.6 + start.distanceTo(end) * 0.08
    return new THREE.QuadraticBezierCurve3(start, middle, end)
  }, [pulse.from, pulse.to, stones])
  const [core, glow] = useMemo(
    () => [
      new THREE.MeshBasicMaterial({ color: palette.energy, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: palette.live, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    ],
    []
  )
  const group = useRef<THREE.Group>(null)
  const point = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (!curve || !group.current) return
    // Wall-clock time, so a pulse sent while the window was busy still starts where it should.
    const t = (Date.now() - wallOffset - pulse.at) / (SECONDS * 1000)
    const visible = t >= 0 && t <= 1
    group.current.visible = visible
    if (!visible) return
    curve.getPoint(t * t * (3 - 2 * t), point)
    group.current.position.copy(point)
    const fade = Math.min(1, t / 0.12, (1 - t) / 0.18)
    core.opacity = fade
    glow.opacity = 0.35 * fade
  })

  if (!curve) return null
  return (
    <group ref={group} visible={false}>
      <mesh geometry={BEAD} material={core} />
      <mesh geometry={HALO} material={glow} />
    </group>
  )
}

export function TalkPulses({ pulses, stones, animate, at }: { pulses: TalkPulse[]; stones: StoneSpec[]; animate: boolean; at: number }) {
  // The snapshot's clock against this page's, so a pulse is timed by the node side's `at`.
  const wallOffset = useMemo(() => Date.now() - at, [at])
  if (!animate || !pulses.length) return null
  return (
    <>
      {pulses.map((pulse) => (
        <Pulse key={pulse.id} pulse={pulse} stones={stones} wallOffset={Math.max(0, wallOffset)} />
      ))}
    </>
  )
}
