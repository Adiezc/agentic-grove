/**
 * The floor: a dark reflective plane, the stepped dais, and the concentric rings.
 *
 * The reflection does more work here than anything else in the scene. In the art every monolith
 * has a vertical smear of itself beneath it, and that one effect is most of why the image reads as
 * a *place* rather than as objects on a black background. Take it away and the stones look pasted
 * on. It is also the most expensive thing in the scene, so it has a quality dial — see `Grove.tsx`.
 *
 * The dais is a **stepped** platform, which the first pass drew as a single flat disc. Looking at
 * the art properly, there are three surfaces and you can see all of them: a recessed inner floor
 * where the tree stands, a step up to a wide outer band, and a short vertical wall down to the
 * ground. The step is worth having because the roots visibly climb it on their way out, and that
 * one detail does more for the sense of a physical place than the rings do.
 */
import { useMemo } from 'react'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { at, groundRing, mergeAll, seededRandom } from './geometry'
import { DAIS_INNER_RADIUS, DAIS_INNER_TOP, DAIS_RADIUS, DAIS_TOP } from './stage'

/**
 * The rings, measured off the art.
 *
 * Two families: a tight set on the dais, and a much wider set running out past the stones and
 * fading. The wide ones give the grove its sense of scale and are very nearly invisible. Kept
 * few — the art has far fewer marks under the tree than it first appears, and four rings at close
 * spacing read as a target right where the eye goes first.
 */
const INNER_RINGS = [1.02, 1.68]
const LIP_RINGS = [DAIS_INNER_RADIUS + 0.06, DAIS_RADIUS - 0.07]
const FIELD_RINGS = [3.1, 3.9, 4.9, 6.1, 7.6, 9.4, 11.6]

interface GroundProps {
  /** Reflection resolution. Dropped on the low preset, where it costs the most and shows least. */
  reflectionResolution: number
  /** Whether to reflect at all. The honest fallback for a machine that cannot hold frame rate. */
  reflect: boolean
}

export function Ground({ reflectionResolution, reflect }: GroundProps) {
  /**
   * The dais, as one lathed profile.
   *
   * Turned rather than stacked out of cylinders, for the reason session three wrote up: two
   * constants in two files that have to agree eventually will not. Here the whole platform is one
   * list of points, so the step is in exactly one place and `stage.ts` is the only thing that
   * decides where.
   */
  const dais = useMemo(() => {
    const profile = [
      new THREE.Vector2(0, DAIS_INNER_TOP),
      new THREE.Vector2(DAIS_INNER_RADIUS, DAIS_INNER_TOP),
      new THREE.Vector2(DAIS_INNER_RADIUS + 0.035, DAIS_TOP),
      new THREE.Vector2(DAIS_RADIUS - 0.02, DAIS_TOP),
      new THREE.Vector2(DAIS_RADIUS, DAIS_TOP - 0.018),
      new THREE.Vector2(DAIS_RADIUS, 0),
    ]
    return new THREE.LatheGeometry(profile, 108)
  }, [])

  const daisMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.groundLit,
        roughness: 0.26,
        metalness: 0.6,
        emissive: new THREE.Color(palette.deep),
        emissiveIntensity: 0.22,
        side: THREE.DoubleSide,
      }),
    []
  )

  const innerRings = useMemo(
    () => mergeAll(INNER_RINGS.map((r) => at(groundRing(r, 0.009, 128), 0, DAIS_INNER_TOP + 0.003, 0))),
    []
  )
  const lipRings = useMemo(
    () => mergeAll(LIP_RINGS.map((r) => at(groundRing(r, 0.008, 128), 0, DAIS_TOP + 0.003, 0))),
    []
  )
  const fieldRings = useMemo(
    () => mergeAll(FIELD_RINGS.map((r) => at(groundRing(r, 0.007, 160), 0, 0.005, 0))),
    []
  )

  const daisRingMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.vein,
        transparent: true,
        opacity: 0.5,
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
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )

  /**
   * Faint radial spokes on the inner floor, which the art has running out from the trunk between
   * the rings. They read as inlay rather than as structure, so they are barely there.
   */
  const spokeGeometry = useMemo(() => {
    const random = seededRandom(71)
    return mergeAll(
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + random() * 0.12
        const length = 0.9 + random() * 0.85
        const plane = new THREE.PlaneGeometry(length * 1.7, 0.005)
        plane.rotateX(-Math.PI / 2)
        plane.rotateY(angle)
        return at(plane, Math.cos(angle) * length, DAIS_INNER_TOP + 0.002, Math.sin(angle) * length)
      })
    )
  }, [])

  const spokeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.deep,
        transparent: true,
        opacity: 0.5,
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
            // is wet stone, where you get the *suggestion* of what stands above and little else.
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

      <mesh geometry={dais} material={daisMaterial} />

      {spokeGeometry ? <mesh geometry={spokeGeometry} material={spokeMaterial} /> : null}
      {innerRings ? <mesh geometry={innerRings} material={daisRingMaterial} /> : null}
      {lipRings ? <mesh geometry={lipRings} material={daisRingMaterial} /> : null}
      {fieldRings ? <mesh geometry={fieldRings} material={fieldRingMaterial} /> : null}
    </group>
  )
}
