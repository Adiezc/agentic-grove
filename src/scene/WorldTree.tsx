/**
 * The world tree: a procedural bonsai, where agent definitions live.
 *
 * Procedural rather than a model file, and that is a spike decision with a reason. The concept
 * art's tree is a very specific shape — a heavy trunk sweeping low to the right, splitting into
 * bare tips, with flat cloud-pruned canopy pads floating above and to the left. Buying or
 * downloading a bonsai gets you *a* bonsai, and then the work is bending it into this one. Built
 * from curves, every proportion is a number we can argue with, and the canopy can breathe with
 * system activity because it is geometry rather than a mesh.
 *
 * If the look-development spike says full 3D, this is also the piece most worth replacing with a
 * sculpted model later. The interface it presents — a shape that breathes at a given rate — would
 * not change.
 *
 * Three parts, matching what the art actually shows:
 *   1. a tapered trunk with a root flare, in desaturated bark
 *   2. glowing veins running up it, which is the cybernetic half of the metaphor
 *   3. canopy pads made of scattered emissive leaves, which bloom does most of the work on
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { seededRandom, taperedTube } from './geometry'

/**
 * The trunk's path, traced off the concept art.
 *
 * It starts below ground so the root flare has somewhere to come from, rises almost vertically,
 * then leans hard to the right and flattens out — the art's trunk travels further sideways than
 * it does up, which is what makes it read as an old cultivated tree rather than a sapling.
 */
const TRUNK_PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.15, -0.35, 0.1),
  new THREE.Vector3(-0.05, 0.35, 0.05),
  new THREE.Vector3(0.1, 1.05, -0.05),
  new THREE.Vector3(0.45, 1.6, -0.1),
  new THREE.Vector3(0.95, 1.95, -0.05),
  new THREE.Vector3(1.5, 2.1, 0.05),
])

/** Bare branch tips reaching further right, as in the art. Each is a curve plus a taper. */
const BRANCH_PATHS = [
  [new THREE.Vector3(1.1, 2.0, -0.05), new THREE.Vector3(1.75, 2.25, 0.1), new THREE.Vector3(2.15, 2.18, 0.25)],
  [new THREE.Vector3(1.25, 2.05, 0.0), new THREE.Vector3(1.85, 1.95, -0.15), new THREE.Vector3(2.3, 1.82, -0.3)],
  [new THREE.Vector3(0.7, 1.8, -0.08), new THREE.Vector3(1.05, 2.35, -0.2), new THREE.Vector3(1.25, 2.62, -0.1)],
].map((points) => new THREE.CatmullRomCurve3(points))

/**
 * Roots flaring out of the base and into the ground.
 *
 * In the art these are the brightest thing at ground level — the tree is plugged into the
 * mycelial network, and the join is where the light is. So they get the bark material for their
 * upper half and the mycelium picks up from where they meet the ground.
 */
const ROOT_ANGLES = [0.3, 1.1, 1.9, 2.7, 3.5, 4.2, 5.0, 5.7]

/** Canopy pads: flattened clouds of leaves, positioned up and left of the trunk as in the art. */
/**
 * Canopy pads, sitting on the branch tips rather than hovering above them.
 *
 * The first placement put every pad at y >= 2.0 while the trunk tops out around 2.1 and leans
 * right — so the canopy floated up and to the left with clear black sky between it and the tree,
 * and the whole thing read as two objects. The art's pads *overlap* the branches they grow from.
 * Moved down and right to meet them, and the two largest now straddle the trunk's own crown.
 */
const CANOPY_PADS: { at: [number, number, number]; radius: number; leaves: number }[] = [
  { at: [0.5, 2.28, -0.12], radius: 0.6, leaves: 300 },
  { at: [1.32, 2.42, 0.06], radius: 0.48, leaves: 230 },
  { at: [-0.12, 2.06, 0.1], radius: 0.42, leaves: 170 },
  { at: [1.0, 2.06, 0.26], radius: 0.34, leaves: 130 },
  { at: [1.95, 2.3, 0.18], radius: 0.3, leaves: 105 },
  { at: [0.72, 2.64, -0.2], radius: 0.26, leaves: 88 },
]

interface WorldTreeProps {
  /**
   * How busy the grove is, 0 to 1. Drives the breathing rate and nothing else — the tree does
   * not change colour, because a tree that goes red when work fails would be the whole scene
   * shouting. Its job is to say "the system is alive, and roughly how hard it is working".
   */
  activity: number
}

export function WorldTree({ activity }: WorldTreeProps) {
  /* Geometry is built once. It never changes shape, only scale, so rebuilding it per frame would
   * be pure waste — and on a scene meant to hold 120fps, geometry churn is the first thing to
   * go wrong. */
  const trunk = useMemo(
    () => taperedTube(TRUNK_PATH, (t) => 0.36 * (1 - t) ** 1.25 + 0.04, 96, 14),
    []
  )

  const branches = useMemo(
    () => BRANCH_PATHS.map((path) => taperedTube(path, (t) => 0.055 * (1 - t) ** 1.2 + 0.008, 40, 6)),
    []
  )

  const roots = useMemo(() => {
    const random = seededRandom(7)
    return ROOT_ANGLES.map((angle) => {
      const reach = 0.9 + random() * 0.75
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.42, 0),
        new THREE.Vector3(Math.cos(angle) * reach * 0.35, 0.1, Math.sin(angle) * reach * 0.35),
        new THREE.Vector3(Math.cos(angle) * reach * 0.75, -0.02, Math.sin(angle) * reach * 0.75),
        new THREE.Vector3(Math.cos(angle) * reach, -0.12, Math.sin(angle) * reach),
      ])
      return taperedTube(path, (t) => 0.115 * (1 - t) ** 1.5 + 0.006, 32, 6)
    })
  }, [])

  /**
   * The leaves, as one instanced mesh per pad.
   *
   * Instancing rather than a mesh per leaf: about 1,500 leaves here, and 1,500 draw calls would
   * cost more than everything else in the scene combined. Each leaf is a single flat triangle,
   * randomly turned — at this size, with bloom over it, a triangle and a modelled leaf are
   * indistinguishable, and one of them is free.
   */
  const padMatrices = useMemo(() => {
    const random = seededRandom(19)
    return CANOPY_PADS.map((pad) => {
      const matrices: THREE.Matrix4[] = []
      const matrix = new THREE.Matrix4()
      const quaternion = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const position = new THREE.Vector3()
      const scale = new THREE.Vector3()

      for (let i = 0; i < pad.leaves; i++) {
        // Scattered over a flattened dome: cloud-pruned bonsai canopy is a plate, not a ball,
        // and the art's pads are about four times wider than they are tall.
        const theta = random() * Math.PI * 2
        const r = Math.sqrt(random()) * pad.radius
        const lift = (1 - (r / pad.radius) ** 2) * pad.radius * 0.3
        position.set(Math.cos(theta) * r, lift * (0.35 + random() * 0.65), Math.sin(theta) * r)
        euler.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI)
        quaternion.setFromEuler(euler)
        const size = 0.032 + random() * 0.034
        scale.set(size, size, size)
        matrices.push(matrix.compose(position, quaternion, scale).clone())
      }
      return matrices
    })
  }, [])

  /* Materials, also built once. */
  const barkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.bark,
        roughness: 0.82,
        metalness: 0.05,
        // A trace of emission so the trunk never falls to pure black in the shadowed half. The
        // art's trunk is always readable against the void, which a purely lit material is not.
        emissive: new THREE.Color(palette.barkShadow),
        emissiveIntensity: 0.5,
      }),
    []
  )

  const veinMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  /**
   * Leaves, normally blended rather than additively.
   *
   * The first attempt made these additive, and it was the single biggest error in the scene:
   * several hundred overlapping translucent quads each *adding* light sums past white long
   * before it reaches the edge of a pad, so the canopy rendered as six glowing clouds. The art's
   * canopy is emphatically green, with white only at a few hot points.
   *
   * Normal blending with depth writing on means a leaf occludes the leaf behind it, which is
   * what foliage does. `MeshLambertMaterial` rather than `Basic` so the pads have a lit side and
   * a shaded side and read as volumes.
   */
  const leafMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: palette.vein,
        emissive: new THREE.Color(palette.moss),
        emissiveIntensity: 1.0,
        side: THREE.DoubleSide,
      }),
    []
  )

  /**
   * A second, much smaller set of genuinely bright leaves scattered over the same pads.
   *
   * This is what gives the canopy its sparkle in the art without flooding it: roughly one leaf
   * in twelve is hot enough to cross the bloom threshold, so the pads glitter at their edges
   * while staying green in the mass.
   */
  const emberMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.leaf,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  /**
   * Veins running up the trunk: the same curve, offset and thinner, drawn additively so it reads
   * as light *in* the bark rather than paint on it.
   */
  const veins = useMemo(() => {
    const random = seededRandom(31)
    return [0, 1, 2, 3].map((i) => {
      const points = TRUNK_PATH.getPoints(24).map((point, index, all) => {
        const t = index / (all.length - 1)
        const wobble = 0.3 * (1 - t) ** 1.4 + 0.035
        const phase = i * 1.7 + t * (2.5 + random() * 1.5)
        return point
          .clone()
          .add(new THREE.Vector3(Math.cos(phase) * wobble * 0.85, 0, Math.sin(phase) * wobble * 0.85))
      })
      const curve = new THREE.CatmullRomCurve3(points)
      return taperedTube(curve, (t) => 0.022 * (1 - t * 0.6) + 0.004, 96, 5)
    })
  }, [])

  const canopyGroup = useRef<THREE.Group>(null)
  const veinGroup = useRef<THREE.Group>(null)

  useFrame((state) => {
    /* The heartbeat. Period comes from activity, so an idle grove breathes slowly and a busy one
     * quickens — this is the single animation in the scene carrying real information, which is
     * why it is allowed to be the most visible one. */
    const period = THREE.MathUtils.lerp(
      motion.breathIdleSeconds,
      motion.breathBusySeconds,
      THREE.MathUtils.clamp(activity, 0, 1)
    )
    const pulse = Math.sin((state.clock.elapsedTime / period) * Math.PI * 2)

    if (canopyGroup.current) {
      // Deliberately tiny: 1.2% at rest. Large enough to notice from the corner of an eye on a
      // third screen, small enough that looking straight at it is not distracting.
      const scale = 1 + pulse * 0.012
      canopyGroup.current.scale.setScalar(scale)
    }

    if (veinGroup.current) {
      // The veins brighten on the same beat, half a phase behind the canopy, so the light reads
      // as travelling up the trunk into the leaves rather than everything flashing at once.
      const lag = Math.sin((state.clock.elapsedTime / period) * Math.PI * 2 - 0.9)
      veinMaterial.opacity = 0.55 + 0.35 * (lag * 0.5 + 0.5)
    }
  })

  return (
    <group>
      <mesh geometry={trunk} material={barkMaterial} castShadow />
      {branches.map((geometry, i) => (
        <mesh key={`branch-${i}`} geometry={geometry} material={barkMaterial} />
      ))}
      {roots.map((geometry, i) => (
        <mesh key={`root-${i}`} geometry={geometry} material={barkMaterial} />
      ))}

      <group ref={veinGroup}>
        {veins.map((geometry, i) => (
          <mesh key={`vein-${i}`} geometry={geometry} material={veinMaterial} />
        ))}
      </group>

      <group ref={canopyGroup}>
        {CANOPY_PADS.map((pad, i) => {
          const matrices = padMatrices[i]
          if (!matrices) return null
          return (
            <instancedMesh
              key={`pad-${i}`}
              args={[undefined, undefined, matrices.length]}
              position={pad.at}
              material={leafMaterial}
              ref={(mesh) => {
                if (!mesh) return
                matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
                mesh.instanceMatrix.needsUpdate = true
              }}
            >
              {/* A single flat triangle per leaf. Scaled to a leaf-ish sliver rather than
                  equilateral, so the canopy has grain instead of looking like confetti. */}
              <tetrahedronGeometry args={[1, 0]} />
            </instancedMesh>
          )
        })}

        {/* The bright minority: every twelfth leaf, additively blended, which is what makes the
            canopy glitter at bloom threshold without the mass of it going white. */}
        {CANOPY_PADS.map((pad, i) => {
          const matrices = padMatrices[i]?.filter((_, index) => index % 12 === 0)
          if (!matrices?.length) return null
          return (
            <instancedMesh
              key={`ember-${i}`}
              args={[undefined, undefined, matrices.length]}
              position={pad.at}
              material={emberMaterial}
              ref={(mesh) => {
                if (!mesh) return
                matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
                mesh.instanceMatrix.needsUpdate = true
              }}
            >
              <tetrahedronGeometry args={[1, 0]} />
            </instancedMesh>
          )
        })}
      </group>

      {/* The light the tree casts on its own clearing. Green, weak, and short-range: in the art
          the ground near the trunk is lifted just enough to separate the dais from the void. */}
      {/* Both dropped hard from the first pass. At 2.4 the trunk light was washing the whole
          dais and most of the near ground, which is what made the frame read as hazy green
          rather than as a lit clearing in the dark. */}
      <pointLight position={[0, 1.5, 0.35]} color={palette.live} intensity={0.75} distance={3.4} decay={2.4} />
      <pointLight position={[-0.4, 2.45, 0]} color={palette.leaf} intensity={0.55} distance={2.8} decay={2.4} />
    </group>
  )
}
