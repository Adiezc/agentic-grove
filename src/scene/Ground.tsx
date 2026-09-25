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

/** A partial strip of a circle, lying flat. Broken arcs are the visual grammar of the reference
 * floor: circuitry and old engraved geometry, rather than a clean set of target rings. */
function arcStrip(radius: number, start: number, length: number, width: number, segments = 28) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const angle = start + (i / segments) * length
    const inner = radius - width / 2
    const outer = radius + width / 2
    positions.push(Math.cos(angle) * inner, 0, Math.sin(angle) * inner)
    positions.push(Math.cos(angle) * outer, 0, Math.sin(angle) * outer)
    uvs.push(i / segments, 0, i / segments, 1)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

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
      // Dark polished stone. It was lighter and less metallic, and the tree's own key light and
      // aura turned the whole platform into a pale disc; in the art the dais is nearly black and
      // only its rings and the roots on it are lit.
      new THREE.MeshStandardMaterial({
        color: palette.ground,
        // Rough enough that the key light does not skate across it as a sheen at low angles.
        roughness: 0.62,
        metalness: 0.55,
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

  /** Hundreds of restrained engraved fragments give the wet floor the density seen in the art.
   * They are merged into one draw call and stay below bloom, so the network remains the hero. */
  const inlayGeometry = useMemo(() => {
    const random = seededRandom(904)
    const fragments: THREE.BufferGeometry[] = []

    for (let i = 0; i < 92; i++) {
      const radius = 2.7 + random() * 9.4
      const start = random() * Math.PI * 2
      const length = 0.035 + random() * 0.22
      const width = 0.006 + random() * 0.008
      fragments.push(at(arcStrip(radius, start, length, width, 8 + Math.floor(random() * 14)), 0, 0.004, 0))
    }

    // Small tangential bars and etched tiles stop the arcs reading as another neat ring family.
    for (let i = 0; i < 150; i++) {
      const angle = random() * Math.PI * 2
      const radius = 2.8 + random() * 9.2
      const length = 0.08 + random() * 0.34
      const width = 0.006 + random() * 0.015
      const plane = new THREE.PlaneGeometry(length, width)
      plane.rotateX(-Math.PI / 2)
      plane.rotateY(-angle + (random() - 0.5) * 0.2)
      fragments.push(at(plane, Math.cos(angle) * radius, 0.004, Math.sin(angle) * radius))
    }
    return mergeAll(fragments)
  }, [])

  const inlayMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#123d24',
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
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
            blur={[260, 70]}
            resolution={reflectionResolution}
            mixBlur={1.1}
            mixStrength={7.2}
            roughness={0.76}
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

      {inlayGeometry ? <mesh geometry={inlayGeometry} material={inlayMaterial} /> : null}
      {spokeGeometry ? <mesh geometry={spokeGeometry} material={spokeMaterial} /> : null}
      {innerRings ? <mesh geometry={innerRings} material={daisRingMaterial} /> : null}
      {lipRings ? <mesh geometry={lipRings} material={daisRingMaterial} /> : null}
      {fieldRings ? <mesh geometry={fieldRings} material={fieldRingMaterial} /> : null}
    </group>
  )
}
