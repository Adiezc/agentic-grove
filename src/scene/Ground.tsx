/**
 * The floor: a dark reflective plane, the central dais, and the concentric rings.
 *
 * The reflection is doing more work here than anything else in the scene. In the concept art
 * every monolith has a vertical smear of itself beneath it, and that one effect is most of why
 * the image reads as a *place* rather than as objects on a black background. Take it away and the
 * stones look pasted on.
 *
 * It is also the most expensive thing in the scene, so it has a quality dial — see `Grove.tsx`.
 */
import { useMemo } from 'react'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { at, groundRing, mergeAll, seededRandom } from './geometry'

/**
 * The rings, measured off the concept art.
 *
 * There are two families: a tight set around the dais under the tree, and a much wider set that
 * runs out past the stones and fades. The wide ones are what give the grove its sense of scale,
 * and they are very nearly invisible — about 12% opacity at the outside.
 */
/* Thinned from four rings to two. Four at this spacing read as a target, or a maze, right where
 * the eye goes first — the art has far fewer marks under the tree than it first appears. */
const DAIS_RINGS = [1.55, 2.18]
const FIELD_RINGS = [3.6, 5.0, 6.9, 9.2]

interface GroundProps {
  /** Reflection resolution. Dropped on the low preset, where it costs the most and shows least. */
  reflectionResolution: number
  /** Whether to reflect at all. The honest fallback for a machine that cannot hold frame rate. */
  reflect: boolean
}

export function Ground({ reflectionResolution, reflect }: GroundProps) {
  const daisRings = useMemo(() => mergeAll(DAIS_RINGS.map((r) => groundRing(r, 0.01, 128))), [])
  const fieldRings = useMemo(() => mergeAll(FIELD_RINGS.map((r) => groundRing(r, 0.007, 160))), [])

  const daisRingMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.vein,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )

  /**
   * The far rings get their own, much dimmer material.
   *
   * One material with per-ring opacity would need one material per ring anyway, so this is two
   * materials rather than nine, and the step between them is invisible at these values.
   */
  const fieldRingMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.deep,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )

  /** The raised disc the tree stands on, with a faint lit edge. */
  /* Lowered to 0.06 so the mycelium can ride over it without the platform swallowing the roots.
   * `Mycelium.tsx` reads the same two numbers; they have to agree. */
  const dais = useMemo(() => new THREE.CylinderGeometry(2.25, 2.3, 0.06, 96), [])

  const daisMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.groundLit,
        roughness: 0.28,
        metalness: 0.55,
        emissive: new THREE.Color(palette.deep),
        emissiveIntensity: 0.25,
      }),
    []
  )

  /**
   * Faint radial spokes on the dais, which the art has running out from the trunk between the
   * rings. They read as inlay rather than as structure, so they are barely there.
   */
  const spokeGeometry = useMemo(() => {
    const random = seededRandom(71)
    return mergeAll(
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + random() * 0.1
        const length = 1.1 + random() * 1.0
        const plane = new THREE.PlaneGeometry(length * 1.6, 0.006)
        plane.rotateX(-Math.PI / 2)
        plane.rotateY(angle)
        return at(plane, Math.cos(angle) * length, 0.063, Math.sin(angle) * length)
      })
    )
  }, [])

  const spokeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.deep,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  return (
    <group>
      {/* The floor. Large enough that its edge is never in frame, since a visible edge would
          immediately give away that this is a plane rather than a world. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[90, 90]} />
        {reflect ? (
          <MeshReflectorMaterial
            // Blurred hard and mixed in weakly. A sharp mirror looks like polished tile; the art
            // is wet stone, where you get the *suggestion* of the stone above and little else.
            blur={[420, 90]}
            resolution={reflectionResolution}
            mixBlur={1.1}
            mixStrength={5.5}
            roughness={0.85}
            depthScale={1.1}
            minDepthThreshold={0.3}
            maxDepthThreshold={1.3}
            color={palette.ground}
            metalness={0.62}
            mirror={0.45}
          />
        ) : (
          <meshStandardMaterial color={palette.ground} roughness={0.9} metalness={0.2} />
        )}
      </mesh>

      <mesh geometry={dais} material={daisMaterial} position={[0, 0.03, 0]} />

      {spokeGeometry ? <mesh geometry={spokeGeometry} material={spokeMaterial} /> : null}
      {daisRings ? <mesh geometry={daisRings} material={daisRingMaterial} position={[0, 0.064, 0]} /> : null}
      {fieldRings ? <mesh geometry={fieldRings} material={fieldRingMaterial} position={[0, 0.006, 0]} /> : null}
    </group>
  )
}
