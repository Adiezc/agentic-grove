/**
 * Mushrooms: small caps on the ground between two stones you work on together.
 *
 * They spring up where the two stones' roots would meet: on the ground between them, a little in
 * towards the tree, never on the dais. More shared hours grow more caps (one to five). As the
 * pairing ages over a week they dim, and once it is past they are gone. The rule is in
 * `core/state/pairings.ts`; this file only draws it.
 *
 * Deliberately quiet. The caps are the dark mid-green of an active root and sit just under the
 * bloom threshold, so they read as part of the forest floor rather than as another thing that
 * wants you. Green here means "alive", as everywhere else; nothing about them is amber. Under
 * reduced motion they appear at full size instead of growing.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Pairing } from '../../core/state/pairings.ts'
import { palette } from '../theme/palette'
import { seededRandom } from './geometry'
import type { StoneSpec } from './Runestone'
import { DAIS_RADIUS } from './stage'

/** Shared by every cap. Unit sizes, scaled per cap. */
const STEM = new THREE.CylinderGeometry(0.28, 0.4, 1, 8).translate(0, 0.5, 0)
const CAP = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)

/** A number from a string, so the same pair always grows the same caps in the same places. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Halfway round from one stone to the other, a little nearer the tree than either, which is where
 * their roots run closest. Kept off the dais so no cap stands on the tree's own ground.
 */
function spotBetween(a: [number, number], b: [number, number]): [number, number] {
  const angleA = Math.atan2(a[1], a[0])
  let turn = Math.atan2(b[1], b[0]) - angleA
  if (turn > Math.PI) turn -= Math.PI * 2
  if (turn < -Math.PI) turn += Math.PI * 2
  const angle = angleA + turn / 2
  const radius = Math.max(DAIS_RADIUS + 0.35, ((Math.hypot(...a) + Math.hypot(...b)) / 2) * 0.82)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

interface Cap {
  at: [number, number]
  height: number
  width: number
  tilt: number
}

function capsFor(pair: Pairing): Cap[] {
  const random = seededRandom(hash(`${pair.a}\n${pair.b}`))
  const count = Math.min(5, 1 + Math.floor(pair.hours / 2))
  return Array.from({ length: count }, (_, index) => {
    // The first cap stands at the centre; the rest cluster round it, as mushrooms do.
    const angle = random() * Math.PI * 2
    // Sized against a stone (1.62 tall): the tallest cap is about a sixth of one. Any smaller and
    // they vanished into the floor from the home view; any larger and they compete with the stones.
    const distance = index === 0 ? 0 : 0.18 + random() * 0.34
    const height = index === 0 ? 0.28 : 0.12 + random() * 0.14
    return {
      at: [Math.cos(angle) * distance, Math.sin(angle) * distance],
      height,
      width: height * (0.55 + random() * 0.35),
      tilt: (random() - 0.5) * 0.35,
    }
  })
}

function Cluster({ pair, at, animate }: { pair: Pairing; at: [number, number]; animate: boolean }) {
  const caps = useMemo(() => capsFor(pair), [pair.a, pair.b, pair.hours])
  // Each cluster has its own materials, since each fades on its own clock.
  const [stem, cap] = useMemo(
    () => [
      new THREE.MeshBasicMaterial({ color: palette.deep, transparent: true }),
      new THREE.MeshBasicMaterial({ color: palette.vein, transparent: true }),
    ],
    []
  )
  const group = useRef<THREE.Group>(null)
  const grown = useRef(animate ? 0 : 1)

  useFrame((_, delta) => {
    // Grows over about two seconds when a pairing first appears; then only the fade moves.
    grown.current = animate ? THREE.MathUtils.damp(grown.current, 1, 1.6, delta) : 1
    group.current?.scale.setScalar(grown.current)
    const opacity = 0.25 + 0.75 * pair.freshness
    stem.opacity = opacity
    cap.opacity = opacity
  })

  return (
    <group ref={group} position={[at[0], 0, at[1]]}>
      {caps.map((each, index) => (
        <group key={index} position={[each.at[0], 0, each.at[1]]} rotation={[each.tilt, 0, each.tilt * 0.6]}>
          <mesh geometry={STEM} material={stem} scale={[each.width * 0.22, each.height, each.width * 0.22]} />
          <mesh geometry={CAP} material={cap} position={[0, each.height, 0]} scale={[each.width, each.width * 0.55, each.width]} />
        </group>
      ))}
    </group>
  )
}

export function Mushrooms({ pairs, stones, animate }: { pairs: Pairing[]; stones: StoneSpec[]; animate: boolean }) {
  const where = useMemo(() => new Map(stones.map((stone) => [stone.id, stone.at])), [stones])
  return (
    <>
      {pairs.map((pair) => {
        const a = where.get(pair.a)
        const b = where.get(pair.b)
        if (!a || !b) return null
        return <Cluster key={`${pair.a}\n${pair.b}`} pair={pair} at={spotBetween(a, b)} animate={animate} />
      })}
    </>
  )
}
