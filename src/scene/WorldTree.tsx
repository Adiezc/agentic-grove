/**
 * The world tree: a procedural bonsai, where agent definitions live.
 *
 * Rebuilt against the concept art rather than against an impression of it, and the rebuild
 * changed almost everything. The first version was a smooth grey arc with a blob on top. What the
 * art actually shows is a very specific and very deliberate bonsai, and four things make it that:
 *
 * **1. The trunk is a braid, not a tube.** Several woody cords twisting around each other with
 * deep channels between them, corkscrewing as they rise. This is `shari` — living bonsai where
 * the bark has been stripped in bands so the wood underneath weathers pale. A single tapered tube
 * cannot read as this from any angle, because the whole effect is the grooves.
 *
 * **2. The wood is bleached, not dark.** Sampling the art's upper decile in the trunk region gives
 * `#9db192`, a pale sage-grey, with specular highlights running to nearly white. The tree is one
 * of the brightest objects in the frame. The first pass had it at `#477156` and it disappeared.
 *
 * **3. Half the tree is dead.** Two big bare limbs sweep out to the right and end in blunt hooks,
 * with no foliage anywhere on them. This is `jin`, and it is not decoration — the asymmetry
 * between a dead right side and a living left is the entire composition. Remove it and you have a
 * shrub.
 *
 * **4. The green is *inside* the wood.** Light runs up the channels of the braid, not over the
 * surface, and it is continuous with the roots below — the same light bursts out of the base and
 * becomes the network on the floor. That continuity is generated in `network.ts` and handed here,
 * so the tree and the mycelium cannot come apart.
 *
 * Everything is procedural rather than a model file, for the reason the spike gave: the art's tree
 * is a specific shape, and buying a bonsai model gets you *a* bonsai and then the work is bending
 * it into this one. Built from curves, every proportion is a number that can be argued with.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, motion } from '../theme/palette'
import { mergeAll, seededRandom, taperedTube } from './geometry'
import { DAIS_INNER_TOP } from './stage'

/**
 * The trunk's spine, traced off the art.
 *
 * It sweeps right and *keeps going* right — the trunk itself becomes the deadwood, and the living
 * growth leaves it sideways on the way up. That is the reverse of the obvious arrangement, where
 * dead tips hang off a living crown, and it is why the tree reads as old.
 *
 * Measured rather than felt: the art's ground line sits 450 pixels below the crown and the dais is
 * 530 across, which fixes one world unit at about 115 pixels of the original. Every coordinate
 * below came out of that conversion.
 */
const SPINE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, -0.26, 0.09),
  new THREE.Vector3(-0.15, 0.46, 0.03),
  new THREE.Vector3(-0.03, 1.06, -0.11),
  new THREE.Vector3(0.27, 1.56, -0.15),
  new THREE.Vector3(0.60, 1.94, -0.09),
  new THREE.Vector3(0.90, 2.16, 0.02),
])

/**
 * Radius of the whole braid at a given height.
 *
 * Thinner than the first attempt by a quarter. At 0.42 at the foot the trunk was as wide as it
 * was tall below the first branch and read as a bulb — and worse, cords that fat fuse into each
 * other whatever spacing they are given, so the braid disappeared as well.
 */
const trunkRadius = (t: number) => 0.31 * (1 - t) ** 0.86 + 0.09

/**
 * The dead limbs.
 *
 * Four of them, which is what the art has: two long arms sweeping right, a short broken spur above
 * the fork, and a stub low down that catches the light and says the trunk itself is half dead.
 * Every one ends in a blunt hook rather than a taper — that is the tell of weathered deadwood,
 * which snaps and then wears smooth, where a limb tapering to a fine point reads as a living twig.
 */
const DEADWOOD: { points: THREE.Vector3[]; radius: number; strands: number }[] = [
  {
    // The upper arm, sweeping up and right, hooking up hard at the tip.
    points: [
      new THREE.Vector3(0.70, 2.02, -0.04),
      new THREE.Vector3(1.16, 2.28, 0.05),
      new THREE.Vector3(1.62, 2.62, 0.14),
      new THREE.Vector3(1.90, 2.90, 0.17),
      new THREE.Vector3(1.88, 3.06, 0.13),
    ],
    radius: 0.135,
    strands: 3,
  },
  {
    // The lower arm, reaching almost level and finishing in the art's clawed tip.
    points: [
      new THREE.Vector3(0.84, 1.92, 0.06),
      new THREE.Vector3(1.32, 1.86, 0.2),
      new THREE.Vector3(1.76, 1.96, 0.27),
      new THREE.Vector3(2.04, 2.14, 0.22),
      new THREE.Vector3(2.10, 2.28, 0.15),
    ],
    radius: 0.118,
    strands: 3,
  },
  {
    // A short broken spur above the fork, which stops the two big arms reading as antlers.
    points: [
      new THREE.Vector3(0.62, 2.06, -0.14),
      new THREE.Vector3(0.90, 2.42, -0.24),
      new THREE.Vector3(1.02, 2.62, -0.2),
    ],
    radius: 0.062,
    strands: 2,
  },
  {
    // A stub low on the trunk. Small, but it is what says the deadwood runs the whole height of
    // the tree rather than being two arms bolted on at the top.
    points: [
      new THREE.Vector3(0.16, 1.18, -0.16),
      new THREE.Vector3(0.46, 1.24, -0.34),
      new THREE.Vector3(0.62, 1.34, -0.38),
    ],
    radius: 0.07,
    strands: 2,
  },
]

/**
 * The living branches, leaving the trunk on its left and climbing.
 *
 * Each ends where a canopy pad sits. The pads are not floating: the first pass put them all above
 * the trunk with clear black sky between, and the tree read as two objects. A pad grows on the
 * branch that feeds it, and the branch has to be visible going in.
 */
const LIVING: { points: THREE.Vector3[]; radius: number }[] = [
  {
    points: [
      new THREE.Vector3(0.20, 1.42, -0.12),
      new THREE.Vector3(0.02, 1.96, -0.04),
      new THREE.Vector3(-0.24, 2.52, 0.05),
      new THREE.Vector3(-0.46, 3.04, 0.04),
      new THREE.Vector3(-0.54, 3.36, 0.0),
    ],
    radius: 0.068,
  },
  {
    points: [
      new THREE.Vector3(0.56, 1.88, -0.08),
      new THREE.Vector3(0.60, 2.32, 0.0),
      new THREE.Vector3(0.64, 2.76, 0.05),
      new THREE.Vector3(0.66, 3.04, 0.03),
    ],
    radius: 0.046,
  },
  {
    points: [
      new THREE.Vector3(-0.02, 1.08, -0.08),
      new THREE.Vector3(-0.34, 1.5, 0.08),
      new THREE.Vector3(-0.78, 1.86, 0.16),
      new THREE.Vector3(-1.16, 1.98, 0.16),
    ],
    radius: 0.044,
  },
  {
    points: [
      new THREE.Vector3(-0.16, 2.34, 0.04),
      new THREE.Vector3(-0.68, 2.56, 0.1),
      new THREE.Vector3(-1.3, 2.7, 0.08),
      new THREE.Vector3(-1.58, 2.76, 0.04),
    ],
    radius: 0.034,
  },
  {
    points: [
      new THREE.Vector3(-0.36, 2.82, 0.05),
      new THREE.Vector3(-0.14, 3.24, 0.02),
      new THREE.Vector3(0.06, 3.5, -0.02),
    ],
    radius: 0.026,
  },
  {
    points: [
      new THREE.Vector3(-0.3, 2.66, 0.0),
      new THREE.Vector3(-0.7, 2.98, -0.04),
      new THREE.Vector3(-0.98, 3.16, -0.06),
    ],
    radius: 0.026,
  },
]

/**
 * The canopy: six flat plates, stepped up to the left.
 *
 * Cloud-pruned bonsai foliage is a *plate*, not a ball — the art's pads are several times wider
 * than they are tall and you can see daylight between them. Their centres are the ends of the
 * living branches above, measured off the art on the same grid as everything else.
 */
const CANOPY_PADS: { at: [number, number, number]; radius: number; thickness: number; leaves: number }[] = [
  /* The crown, offset left of the trunk rather than sitting on top of it. This one number is most
   * of the difference between a bonsai and an acacia: a canopy centred over its trunk reads as a
   * savannah tree whatever else is done to it, and the art's mass hangs to the left of the
   * deadwood by nearly half its own width. */
  { at: [-0.72, 3.44, 0.0], radius: 1.36, thickness: 0.26, leaves: 4200 },
  { at: [0.6, 3.06, 0.05], radius: 0.8, thickness: 0.22, leaves: 1600 },
  { at: [-1.62, 2.78, 0.06], radius: 0.94, thickness: 0.22, leaves: 2000 },
  /* The low left pad, hanging well below the fork on its own long branch. The art has this and
   * it is what stops the canopy reading as one dome — it puts a second storey under the crown. */
  { at: [-1.32, 2.04, 0.16], radius: 0.9, thickness: 0.2, leaves: 1750 },
  { at: [-0.06, 3.58, -0.04], radius: 0.64, thickness: 0.17, leaves: 820 },
  { at: [-1.24, 3.22, -0.06], radius: 0.7, thickness: 0.17, leaves: 960 },
  { at: [-0.42, 2.62, 0.1], radius: 0.94, thickness: 0.2, leaves: 1800 },
  { at: [0.3, 2.86, 0.02], radius: 0.6, thickness: 0.17, leaves: 780 },
]

/**
 * Buttress roots: the woody flare where the trunk meets the ground.
 *
 * These are the physical half of the join. They run from inside the trunk out to just past where
 * the light network begins, so the glowing strands appear to *emerge from between them* rather
 * than to start at an arbitrary radius on the floor. `network.ts` starts its strands at 0.62 and
 * these reach 0.72, which is the overlap that hides the seam.
 */
const BUTTRESS_ANGLES = [0.1, 0.55, 1.0, 1.45, 1.95, 2.45, 2.95, 3.4, 3.85, 4.3, 4.8, 5.3, 5.8]

/**
 * A frame that walks a curve without rolling.
 *
 * Three's `computeFrenetFrames` twists wherever the curve's curvature flips, which on a trunk that
 * S-bends puts a visible kink in the braid. Building the frame from a fixed world up-vector
 * instead means the strands wind at exactly the rate asked for and nowhere else.
 */
function frameAt(curve: THREE.Curve<THREE.Vector3>, t: number): { normal: THREE.Vector3; binormal: THREE.Vector3 } {
  const tangent = curve.getTangentAt(t).normalize()
  const reference = Math.abs(tangent.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3().crossVectors(tangent, reference).normalize()
  const binormal = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { normal, binormal }
}

/**
 * One cord of a braid: a curve that spirals around `spine` at `radiusAt`, offset by `phase`.
 *
 * `twist` is how many radians the whole braid turns over its length. The art's trunk turns roughly
 * a third of a revolution from foot to fork, which is enough that you can see a channel disappear
 * around the far side and enough that the tree looks grown rather than extruded.
 */
function braidCord(
  spine: THREE.Curve<THREE.Vector3>,
  phase: number,
  twist: number,
  radiusAt: (t: number) => number,
  samples = 40
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const { normal, binormal } = frameAt(spine, t)
    const angle = phase + twist * t
    const offset = radiusAt(t)
    points.push(
      spine
        .getPointAt(t)
        .addScaledVector(normal, Math.cos(angle) * offset)
        .addScaledVector(binormal, Math.sin(angle) * offset)
    )
  }
  return new THREE.CatmullRomCurve3(points)
}

/**
 * A whole braided limb: `count` cords wound around one spine, plus the channels between them.
 *
 * Returns the wood and, separately, the positions the light channels should run down. Keeping
 * those in step is the point of doing it in one function — a vein drawn at an angle that is not
 * actually a groove sits on top of a cord and reads as a painted stripe.
 */
function braid(
  spine: THREE.Curve<THREE.Vector3>,
  count: number,
  radiusAt: (t: number) => number,
  twist: number,
  cordSegments = 48
): { wood: THREE.BufferGeometry[]; channels: THREE.CatmullRomCurve3[] } {
  const wood: THREE.BufferGeometry[] = []
  const channels: THREE.CatmullRomCurve3[] = []
  /* Cords sit at `offset` from the axis and are `cordRadius` thick. The two numbers decide
   * whether there is a braid at all, and the first render got them equal — which makes the cords
   * overlap so far that they fuse into one lumpy tube with no channels in it, and the trunk came
   * out as a smooth grey limb. They have to overlap *just* enough to keep the wood solid and no
   * more, so the valley between two cords is a real groove you can see light sitting in. */
  const offsetAt = (t: number) => radiusAt(t) * 0.64
  const cordAt = (t: number) => radiusAt(t) * 0.44

  for (let i = 0; i < count; i++) {
    const phase = (i / count) * Math.PI * 2
    wood.push(taperedTube(braidCord(spine, phase, twist, offsetAt), cordAt, cordSegments, 8))
    /* Halfway between two cords is the groove, and the light has to sit *in* it — proud of the
     * valley floor, below the crest of the cords either side. The first two renders both put it
     * inside the wood and the trunk showed no green above the base at all, so the depth is
     * computed rather than guessed: where two cylinders of this radius and this spacing actually
     * intersect. `half` is half the angle between neighbouring cords. */
    const halfAngle = Math.PI / count
    const grooveAt = (t: number) => {
      const offset = offsetAt(t)
      const cord = cordAt(t)
      const along = offset * Math.cos(halfAngle)
      const apart = offset * Math.sin(halfAngle)
      // If the cords do not reach each other there is no intersection and no groove: fall back to
      // running the light along the cord surface, which is the honest thing to draw.
      const out = cord > apart ? Math.sqrt(cord * cord - apart * apart) : 0
      return along + out
    }
    channels.push(braidCord(spine, phase + halfAngle, twist, grooveAt))
  }
  return { wood, channels }
}

interface WorldTreeProps {
  /**
   * How busy the grove is, 0 to 1. Drives the breathing rate and nothing else — the tree does not
   * change colour, because a tree that goes red when work fails would be the whole scene shouting.
   * Its job is to say "the system is alive, and roughly how hard it is working".
   */
  activity: number
}

export function WorldTree({ activity }: WorldTreeProps) {
  /* All geometry is built once. It never changes shape, only scale, so rebuilding per frame
   * would be pure waste — and geometry churn is the first thing to go wrong on a scene meant to
   * hold a steady frame rate. */

  /** The trunk, as four cords with four channels between them. */
  const trunk = useMemo(() => braid(SPINE, 5, trunkRadius, 2.3, 72), [])

  const deadwood = useMemo(
    () =>
      DEADWOOD.flatMap((limb) => {
        const spine = new THREE.CatmullRomCurve3(limb.points)
        // Dead limbs are braided too, more loosely and with fewer cords: weathered jin splits
        // along the grain, which is why the art's arms look like twisted rope near the trunk and
        // like a smooth bone at the tip.
        return braid(spine, limb.strands, (t) => limb.radius * (1 - t * 0.82) ** 1.35 + 0.008, 2.6, 44).wood
      }),
    []
  )

  const living = useMemo(
    () =>
      LIVING.map((branch) =>
        taperedTube(
          new THREE.CatmullRomCurve3(branch.points),
          (t) => branch.radius * (1 - t) ** 1.5 + 0.005,
          40,
          7
        )
      ),
    []
  )

  const buttresses = useMemo(() => {
    const random = seededRandom(7)
    return BUTTRESS_ANGLES.map((angle) => {
      const reach = 0.7 + random() * 0.35
      const lift = 0.62 + random() * 0.45
      const wobble = (random() - 0.5) * 0.35
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 0.12, lift, Math.sin(angle) * 0.12),
        new THREE.Vector3(Math.cos(angle + wobble * 0.4) * reach * 0.5, lift * 0.35, Math.sin(angle + wobble * 0.4) * reach * 0.5),
        new THREE.Vector3(Math.cos(angle + wobble) * reach * 0.9, 0.02, Math.sin(angle + wobble) * reach * 0.9),
        // Ends just under the floor, so the root disappears into the dais rather than stopping
        // on it. The light network picks up from roughly here.
        new THREE.Vector3(Math.cos(angle + wobble * 1.2) * reach * 1.25, -0.06, Math.sin(angle + wobble * 1.2) * reach * 1.25),
      ])
      return taperedTube(path, (t) => (0.072 + random() * 0.055) * (1 - t) ** 1.5 + 0.006, 28, 6)
    })
  }, [])

  /**
   * The light in the channels.
   *
   * Only the living side of the tree carries it. The deadwood is dead, and it took a moment to
   * realise that running veins through it was not just wrong but destroyed the one thing the
   * deadwood is there to say. Light stops at the fork.
   */
  const veins = useMemo(() => {
    const trunkVeins = trunk.channels.map((channel) =>
      // Wide, flat ribbons of light rather than wires: in the art the channels are *full* of it,
      // and a thin line down a groove reads as a fibre-optic cable taped to a log.
      taperedTube(channel, (t) => 0.046 * (1 - t) ** 0.55 + 0.009, 72, 6)
    )
    const branchVeins = LIVING.slice(0, 3).map((branch) =>
      taperedTube(
        new THREE.CatmullRomCurve3(branch.points),
        (t) => branch.radius * 0.42 * (1 - t) ** 1.1 + 0.004,
        36,
        5
      )
    )
    return mergeAll([...trunkVeins, ...branchVeins])
  }, [trunk])

  /**
   * Two merged meshes, not one, because the dead wood is a different colour from the living wood.
   *
   * In the art the jin is visibly *paler* than the trunk it grows out of — sun-bleached, almost
   * bone, with a hard white specular along the top of each limb, against a living trunk that is a
   * grey-green. Drawing both with one material made the whole tree read as one piece of driftwood
   * and lost the contrast that the deadwood exists to provide.
   */
  const livingGeometry = useMemo(
    () => mergeAll([...trunk.wood, ...living, ...buttresses]),
    [trunk, living, buttresses]
  )
  const deadGeometry = useMemo(() => mergeAll(deadwood), [deadwood])

  /**
   * The leaves, as one instanced mesh per pad.
   *
   * About 2,200 leaves. One draw call each rather than one per leaf, which would cost more than
   * everything else in the scene put together. Each leaf is a single flat triangle, randomly
   * turned — at this size, under bloom, a triangle and a modelled leaf are indistinguishable and
   * one of them is free.
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
        // Scattered over a flattened disc with a soft edge. `r ** 0.7` rather than `sqrt(r)`
        // pushes more of them outwards, which gives a pad a defined rim instead of a dense
        // middle fading to nothing — and the rim is what catches the light in the art.
        const theta = random() * Math.PI * 2
        /* The rim is not a circle. Three low-frequency waves around the pad push its edge in and
         * out by up to a quarter of the radius, which is the difference between foliage and a
         * dinner plate — and at this camera angle the silhouette of the rim is almost all you
         * see of a pad's shape. */
        const ragged =
          0.78 + 0.12 * Math.sin(theta * 3 + pad.at[0] * 4) + 0.1 * Math.sin(theta * 5 + pad.at[1])
        const r = random() ** 0.68 * pad.radius * ragged
        const edge = 1 - (r / (pad.radius * ragged)) ** 2
        position.set(
          Math.cos(theta) * r,
          // Domed rather than flat: the middle of a pad stands proud of its edge, which is what
          // catches the key light and gives the layer a top surface.
          edge * pad.thickness * 0.7 + (random() - 0.5) * pad.thickness * 0.5,
          Math.sin(theta) * r * 0.86
        )
        euler.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI)
        quaternion.setFromEuler(euler)
        const size = 0.017 + random() * 0.019
        scale.set(size, size * 0.7, size)
        matrices.push(matrix.compose(position, quaternion, scale).clone())
      }
      return matrices
    })
  }, [])

  /**
   * Bleached wood.
   *
   * Rough and unlit-looking on the shadow side, with a strong specular along the top of a limb —
   * which is what `#d8e2d2` in the art's highlights is. The emissive floor is what keeps the trunk
   * readable against the void even where no light reaches it, and the art's trunk is never black.
   */
  const woodMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#93a78d',
        /* Two corrections, in opposite directions, and both were needed.
         *
         * The first render was chalky and uniformly lit — roughness 0.62 with an emissive floor
         * of 0.42 — which turned bleached wood into pale plasticine. Dropping the emissive fixed
         * the flatness but the metalness added to compensate then turned the trunk *pewter*, a
         * grey machined limb, because metal takes its colour from what it reflects and there is
         * nothing in this scene to reflect.
         *
         * Wood is a dielectric. Almost no metalness, a middling roughness so there is a broad
         * sheen along a limb rather than a mirror spot, and one hard key doing all the work. */
        roughness: 0.44,
        metalness: 0.06,
        emissive: new THREE.Color(palette.boneShadow),
        emissiveIntensity: 0.1,
      }),
    []
  )

  /** Bleached, glossier, and a little emissive so a dead limb never falls fully into the void. */
  const deadMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#bbc8b2',
        roughness: 0.36,
        metalness: 0.05,
        emissive: new THREE.Color(palette.boneShadow),
        emissiveIntensity: 0.16,
      }),
    []
  )

  const veinMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.live,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  )

  /**
   * Leaves, normally blended rather than additively.
   *
   * The single biggest error in the first pass was making these additive: several hundred
   * overlapping translucent quads each *adding* light sums past white long before it reaches the
   * edge of a pad, so the canopy rendered as glowing clouds. The art's canopy is emphatically
   * green, with white at only a few hot points.
   *
   * Normal blending with depth writing means a leaf occludes the leaf behind it, which is what
   * foliage does. Lambert rather than Basic so each pad has a lit top and a shaded underside and
   * reads as a plate rather than a sticker.
   */
  const leafMaterial = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: '#35804f',
        emissive: new THREE.Color('#164d26'),
        emissiveIntensity: 1.0,
        side: THREE.DoubleSide,
      }),
    []
  )

  /**
   * The bright minority, scattered over the same pads.
   *
   * Roughly one leaf in nine is hot enough to cross the bloom threshold, which is what makes the
   * canopy glitter at its edges without the mass of it going white.
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

  const canopyGroup = useRef<THREE.Group>(null)

  useFrame((state) => {
    /* The heartbeat. Its period comes from activity, so an idle grove breathes slowly and a busy
     * one quickens. This is the single animation in the scene carrying real information, which is
     * why it is allowed to be the most visible one. */
    const period = THREE.MathUtils.lerp(
      motion.breathIdleSeconds,
      motion.breathBusySeconds,
      THREE.MathUtils.clamp(activity, 0, 1)
    )
    const pulse = Math.sin((state.clock.elapsedTime / period) * Math.PI * 2)

    if (canopyGroup.current) {
      // Deliberately tiny: 1.2% at rest. Large enough to catch the corner of an eye on a third
      // screen, small enough that looking straight at it is not distracting.
      canopyGroup.current.scale.setScalar(1 + pulse * 0.012)
    }

    // The channels brighten half a phase behind the canopy, so the light reads as travelling up
    // the trunk into the leaves rather than everything flashing at once.
    const lag = Math.sin((state.clock.elapsedTime / period) * Math.PI * 2 - 0.9)
    veinMaterial.opacity = 0.7 + 0.28 * (lag * 0.5 + 0.5)
  })

  return (
    /* Standing on the dais, not on the floor. The tree's own coordinates run from y = 0 at its
     * foot, so this is the one place the platform height enters. */
    <group position={[0, DAIS_INNER_TOP, 0]}>
      {livingGeometry ? <mesh geometry={livingGeometry} material={woodMaterial} castShadow /> : null}
      {deadGeometry ? <mesh geometry={deadGeometry} material={deadMaterial} /> : null}
      {veins ? <mesh geometry={veins} material={veinMaterial} renderOrder={2} /> : null}

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
              <tetrahedronGeometry args={[1, 0]} />
            </instancedMesh>
          )
        })}

        {CANOPY_PADS.map((pad, i) => {
          const matrices = padMatrices[i]?.filter((_, index) => index % 6 === 0)
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

      {/* The light the tree casts on its own clearing. Green, weak, short-range: in the art the
          ground near the trunk is lifted just enough to separate the dais from the void, and no
          further. Both of these were at 2.4 in the first pass, which washed the whole platform
          and made the frame read as hazy green rather than as a lit clearing in the dark. */}
      <pointLight position={[0, 0.7, 0.45]} color={palette.live} intensity={0.7} distance={2.6} decay={2.4} />
      <pointLight position={[-0.5, 3.1, 0.3]} color={palette.leaf} intensity={0.55} distance={3.2} decay={2.4} />
      {/* A hard key from high and to the left, which is what puts the near-white specular along
          the top of every dead limb. Deadwood without a key light is just a pale branch. */}
      <directionalLight position={[-3, 6, 4]} intensity={1.7} color={palette.boneLit} />
    </group>
  )
}
