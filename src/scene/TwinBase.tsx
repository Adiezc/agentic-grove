/**
 * The base a twin shares with its anchor: two checkouts of one repository, joined at the foot.
 *
 * A low causeway of the same dark terrace each stone stands on, laid between the two plinths, with
 * a lit seam down each edge like the rings cut into a plinth's lip. It says "one project, two
 * branches" without a word, and it stays as quiet as the plinths themselves: no glow of its own and
 * no movement. State still belongs to the runes; the base is just ground.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { palette } from '../theme/palette'

/** Matches the stone's own terrace (`PLINTH` in `Runestone.tsx`), so the two read as one surface. */
const BASE_MATERIAL = new THREE.MeshStandardMaterial({
  color: palette.ground,
  roughness: 0.4,
  metalness: 0.5,
  emissive: new THREE.Color(palette.deep),
  emissiveIntensity: 0.12,
})

const SEAM_MATERIAL = new THREE.MeshBasicMaterial({
  color: palette.live,
  transparent: true,
  opacity: 0.42,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
})

/** The plinth's radius before a stone's own scale, from `Runestone.tsx`. */
const PLINTH_RADIUS = 0.45

interface TwinBaseProps {
  from: [number, number]
  to: [number, number]
  /** Each stone's scale, so the causeway starts and ends at the edge of each plinth. */
  fromScale: number
  toScale: number
}

export function TwinBase({ from, to, fromScale, toScale }: TwinBaseProps) {
  const shape = useMemo(() => {
    const dx = to[0] - from[0]
    const dz = to[1] - from[1]
    const length = Math.hypot(dx, dz)
    // A little narrower than the smaller plinth, so the plinths' round lips still show at each end.
    const half = PLINTH_RADIUS * Math.min(fromScale, toScale) * 0.62
    // The seams run only over open ground, from one plinth's lip to the other's.
    const fromEdge = Math.sqrt(Math.max(0, (PLINTH_RADIUS * fromScale) ** 2 - half ** 2))
    const toEdge = Math.sqrt(Math.max(0, (PLINTH_RADIUS * toScale) ** 2 - half ** 2))
    const seamLength = Math.max(0.01, length - fromEdge - toEdge)
    return {
      length,
      half,
      seamLength,
      // Along the causeway, the seam's centre sits halfway between the two lips.
      seamCentre: (fromEdge - toEdge) / 2,
      mid: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as const,
      turn: Math.atan2(dx, dz),
    }
  }, [from, to, fromScale, toScale])

  return (
    <group position={[shape.mid[0], 0, shape.mid[1]]} rotation={[0, shape.turn, 0]}>
      <mesh material={BASE_MATERIAL} position={[0, 0.009, 0]}>
        <boxGeometry args={[shape.half * 2, 0.018, shape.length]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          material={SEAM_MATERIAL}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[side * (shape.half + 0.012), 0.004, shape.seamCentre]}
        >
          <planeGeometry args={[0.009, shape.seamLength]} />
        </mesh>
      ))}
    </group>
  )
}
