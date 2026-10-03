/**
 * A runestone: one project, standing where its work happens.
 *
 * Rebuilt after comparing the first pass against the art side by side, where it was obvious that
 * the stones were the weakest thing in the frame. They were cones on cylinders, all six identical
 * bar a scale factor, opaque, and about twice as tall as they should have been. The art's stones
 * are none of those things.
 *
 * **They are quartz.** A faceted shaft with a *chisel termination* on top: two or three big
 * slanted planes meeting along a short ridge that sits off to one side, not a symmetric point.
 * That off-centre ridge is the difference between a crystal and a signpost, and it is what gives
 * each stone a silhouette you can tell apart from any angle. `crystal()` in `geometry.ts` builds
 * it; every parameter of the cut is per-stone.
 *
 * **They are glass, not rock.** Near-black at the centre of a face, with light along every edge, a
 * hard specular on whichever facet happens to catch the key, and a faint glow *inside* pooling at
 * the foot. The first version's flat opaque shading is why they read as painted metal.
 *
 * **They are short.** In the art a stone is about two and a half times taller than it is wide, and
 * roughly two fifths the height of the tree. The first pass had them at five to one and nearly as
 * tall as the tree, which is most of why that render looked like a circle of pylons.
 *
 * What has not changed is the restraint, which is still the design: the stone body never changes
 * colour with state. An idle stone and a running stone are the same silhouette, and only the rune
 * tells them apart. That is what lets twenty-five of these sit on screen without the scene
 * becoming a fairground.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Tell } from '../../core/harnesses/types.ts'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { crystal, groundRing, seededRandom, type CrystalSpec } from './geometry'
import { STONE_HEIGHT } from './stage'
import { drawRune, type RuneId } from './runes'
import type { SessionStatus } from '../../core/harnesses/types.ts'
import { WorkerBadges } from './WorkerBadges'

/**
 * Dark glass.
 *
 * Four terms, and each one is answering something the art does that a standard material will not:
 *
 *   - **Fresnel**, broad and tight. Brightness from how steeply a surface turns away from the
 *     camera, which is what puts the hairline down a silhouette edge and makes the highlight
 *     travel as the camera parallaxes. A light cannot do this: on a flat facet, any light gives
 *     one uniform value per face and the stone comes out as a road sign. That mistake cost two
 *     renders in the first pass and it is worth not repeating.
 *   - **A facet specular.** One hard, tight highlight from a fixed key direction, which with flat
 *     normals lands on one or two facets and leaves the rest black. In the art there is always
 *     exactly one pale facet per stone, usually on the cap, and it is most of what says "glass".
 *   - **An interior**, pooling towards the foot and tinted by the rune's own colour. The art's
 *     stones are translucent: you can see a little way *into* them, and the light inside is the
 *     stone's state bleeding through the body.
 *   - **A ground flare.** The bottom few centimetres are much brighter, because a stone standing
 *     in a lit ring picks that light up along its base.
 */
const STONE_SHADER = {
  uniforms: {
    uBase: { value: new THREE.Color(palette.stone) },
    uRim: { value: new THREE.Color(palette.stoneRim) },
    uEdge: { value: new THREE.Color(palette.glow) },
    uInner: { value: new THREE.Color(palette.moss) },
    uKey: { value: new THREE.Vector3(-0.45, 0.72, 0.52).normalize() },
    /** Height of this stone, so the vertical gradients do not need a magic number. */
    uHeight: { value: STONE_HEIGHT },
    /** How hard the interior burns, which is the one thing state changes about the body. */
    uGlow: { value: 0.35 },
    /** Weight of the one hard facet highlight. Lower on the small companion crystals. */
    uFacet: { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;
    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-viewPosition.xyz);
      vHeight = position.y;
      gl_Position = projectionMatrix * viewPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uRim;
    uniform vec3 uEdge;
    uniform vec3 uInner;
    uniform vec3 uKey;
    uniform float uHeight;
    uniform float uGlow;
    uniform float uFacet;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vHeight;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 view = normalize(vView);
      float facing = clamp(dot(normal, view), 0.0, 1.0);

      // Sharpened hard from the first render, where the broad term was an exponent of 2.6 at a
      // weight of 0.34 and the stones came out as pale paper cutouts. At this camera angle a
      // stone's whole front face is close to edge-on, so a broad fresnel lights all of it evenly
      // - the same trap the first pass fell into with a lit material, reached from the other
      // direction. The hairline on the silhouette needs an exponent steep enough that only the
      // last few degrees of turn reach it.
      float body = pow(1.0 - facing, 4.5);
      float edge = pow(1.0 - facing, 11.0);

      // The key is given in view space, so the lit facet stays the same one as the camera
      // parallaxes gently. A world-space key would swing the highlight around under a 5-degree
      // mouse lean, which reads as the stone wobbling.
      vec3 halfway = normalize(uKey + view);
      float facet = pow(clamp(dot(normal, halfway), 0.0, 1.0), 46.0);

      // Inside the stone: strongest at the foot, gone by the shoulder.
      float depth = 1.0 - clamp(vHeight / uHeight, 0.0, 1.0);
      float interior = pow(depth, 2.2) * uGlow;

      // And the last few centimetres, where the stone stands in its own ring of light.
      float foot = pow(clamp(1.0 - vHeight / (uHeight * 0.16), 0.0, 1.0), 2.0);

      vec3 colour = uBase
        + uRim * body * 0.09
        + uEdge * edge * 0.72
        + uEdge * facet * uFacet
        + uInner * (interior + foot * 0.3);

      gl_FragColor = vec4(colour, 1.0);
    }
  `,
}

/** Shared by every stone: the plinth rings are identical, so one material serves all of them. */
const RING_MATERIAL = new THREE.MeshBasicMaterial({
  color: palette.live,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
})

/**
 * The low terrace each stone stands on.
 *
 * Nearly black and barely raised. The previous version was `groundLit` at 0.6 metalness and half
 * a metre across, which under the rune's own light rendered as a wide pale plate — six grey
 * dinner plates laid out around the tree, and the first thing the eye landed on. The art has no
 * disc under a stone at all: there is a faint step in the floor and two rings cut into it, and
 * the brightest thing at ground level is the light, not the stone's footing.
 */
const PLINTH = new THREE.CylinderGeometry(0.42, 0.45, 0.022, 36)
const PLINTH_MATERIAL = new THREE.MeshStandardMaterial({
  color: palette.ground,
  roughness: 0.4,
  metalness: 0.5,
  emissive: new THREE.Color(palette.deep),
  emissiveIntensity: 0.12,
})

/** How brightly a rune burns, per state. The whole visual language of status, in four numbers. */
const RUNE_INTENSITY: Record<SessionStatus, number> = {
  /** Barely lit. The stone is there; nothing is happening on it. */
  idle: 0.78,
  /** Working. Bright, steady, and bloomed. */
  running: 2.7,
  /** Holding the turn back. Slightly dimmer than running, but it *pulses*, which is what catches
   *  an eye that is not looking directly at it. */
  waiting: 2.6,
  /** Failed recently. */
  errored: 2.4,
}

const RUNE_COLOUR: Record<SessionStatus, string> = {
  idle: palette.moss,
  running: palette.core,
  waiting: palette.waiting,
  errored: palette.errored,
}

export interface StoneSpec {
  id: string
  name: string
  rune: RuneId
  status: SessionStatus
  /** Position on the ground plane. Y is ignored; a stone stands on the floor. */
  at: [number, number]
  /** Small variation in overall size. 1 is the height from the art. */
  scale?: number
  /**
   * How far this stone is turned *away* from facing the viewer, in radians.
   *
   * Not an absolute rotation. A rune is carved on one face, and a stone whose carved face points
   * into the distance shows the viewer a blank slab — which is what happened on the first pass:
   * five of six runes were invisible because the stones sat around a ring and half had their backs
   * to the camera. In the art every rune faces you.
   *
   * So a stone turns to face the camera by default and this is the deviation from that, which
   * keeps them from looking like a rank of soldiers on parade while still letting every rune be
   * read at a glance. That is the whole point of the grove: one look tells you everything.
   */
  turn?: number
  /** Override any part of the cut. Left off, the cut is derived from the id — see `cutFor`. */
  cut?: Partial<CrystalSpec>
  /** One line for the stone's panel: what was last worked on there. Not drawn in the scene. */
  line?: string
  /** The stone this one branched from. Sub-stones stand further out, a little smaller, joined to it. */
  parent?: string
  /** This stone is a worktree of `parent`'s repository: it stands beside it, sharing a base. */
  twin?: boolean
  /** The git branch checked out in this stone's folder, when it is a checkout. */
  branch?: string
  /** Parts of this project worth a sub-stone of their own, offered in its panel. */
  splits?: { path: string; name: string; kind: 'folder' | 'worktree' }[]
  /**
   * Who is working here right now: a tree agent's id when the Grove sent it, or a harness id
   * (`claude-code`, `codex`) for work you started yourself. Each shows as a small orb above the
   * stone, which is how two agents on two projects stay tellable apart inside one heartbeat.
   */
  workers?: string[]
  /** Signs the work here may need checking, newest first. See `core/harnesses/claude-tells.ts`. */
  tells?: Tell[]
}

/**
 * The cut of one stone, derived from its id.
 *
 * Derived rather than authored because the six stones in the spike are the easy case. The real
 * grove has one stone per project folder, appearing and disappearing as work moves around, and
 * hand-authoring a crystal for each is not a thing anyone will keep doing. Hashing the id means a
 * project gets the *same* distinctive stone every time it appears, on any machine, with no state
 * saved anywhere — and two projects side by side reliably look nothing like each other.
 *
 * Every stone is the same dark quartz, but each is one of five cuts, so they differ in character
 * and not just in size. The cut is picked first and the fine proportions are varied inside it,
 * because varying everything at once gives six stones that are all slightly different averages.
 *
 *   chisel   the art's default: a short off-centre ridge on top
 *   spire    tall and slender, drawn to a near point
 *   slab     broad and thin, a crystal standing like one of the old Ogham pillar stones
 *   stout    squat and wide, six-sided
 *   broken   the point snapped off long ago, leaving a low, nearly flat top
 *
 * One rule holds for all of them: one face always points straight at the viewer, so the
 * inscription sits flat on a face instead of across a corner.
 */
export type CutStyle = 'chisel' | 'spire' | 'slab' | 'stout' | 'broken'
const CUT_STYLES: CutStyle[] = ['chisel', 'spire', 'slab', 'stout', 'broken']

export interface StoneCut {
  style: CutStyle
  body: CrystalSpec
  /** Small crystals grown at the foot of the main one. Positions are relative to the stone. */
  companions: { spec: CrystalSpec; at: [number, number] }[]
}

export function cutFor(id: string, overrides?: Partial<CrystalSpec>): StoneCut {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const random = seededRandom(hash >>> 0)
  // Burn the first few, which on a hash-derived seed are correlated with the first character.
  random()
  random()
  const between = (low: number, high: number) => low + random() * (high - low)

  const style = CUT_STYLES[Math.floor(random() * CUT_STYLES.length)]!
  // The ranges are read off the art for `chisel`, and pushed out from there for the rest.
  const shape = {
    chisel: { sides: [4, 6], width: [0.27, 0.35], tall: [0.9, 1.1], cap: [0.19, 0.28], ridge: [0.5, 1.2], flat: [0.9, 1] },
    spire: { sides: [5, 6], width: [0.22, 0.26], tall: [1.05, 1.18], cap: [0.3, 0.38], ridge: [0.08, 0.22], flat: [0.9, 1] },
    slab: { sides: [4, 5], width: [0.33, 0.38], tall: [0.86, 1.0], cap: [0.14, 0.2], ridge: [0.9, 1.3], flat: [0.55, 0.68] },
    stout: { sides: [6, 6], width: [0.35, 0.4], tall: [0.78, 0.88], cap: [0.22, 0.3], ridge: [0.35, 0.7], flat: [0.9, 1] },
    broken: { sides: [4, 6], width: [0.28, 0.34], tall: [0.74, 0.86], cap: [0.07, 0.11], ridge: [1.1, 1.4], flat: [0.8, 0.95] },
  }[style]

  const sides = Math.round(between(shape.sides[0]!, shape.sides[1]! + 0.99) - 0.49)
  const width = between(shape.width[0]!, shape.width[1]!)
  const capShare = between(shape.cap[0]!, shape.cap[1]!)
  const height = STONE_HEIGHT * between(shape.tall[0]!, shape.tall[1]!)

  const body: CrystalSpec = {
    sides,
    footRadius: width,
    // Slightly narrower at the shoulder than the foot, which is what stops a shaft reading as
    // extruded. Real quartz is nearly parallel-sided, but nearly is the operative word.
    shoulderRadius: width * between(0.8, 0.94),
    shaftHeight: height * (1 - capShare),
    capHeight: height * capShare,
    // Always off-axis, by up to half the stone's own width.
    ridgeOffset: [(random() - 0.5) * width * 0.9, (random() - 0.5) * width * 0.9],
    ridgeLength: width * between(shape.ridge[0]!, shape.ridge[1]!),
    ridgeAngle: random() * Math.PI,
    lean: (random() - 0.5) * 0.12,
    leanAngle: random() * Math.PI * 2,
    // Face 0 runs from angle `roll` to `roll + 2pi/sides`; centring it on +z puts a face, not a
    // corner, towards the viewer.
    roll: Math.PI / 2 - Math.PI / sides,
    flatten: between(shape.flat[0]!, shape.flat[1]!),
    ...overrides,
  }

  // Companions: none on a spire, which is the point of a spire; up to two elsewhere, and always
  // behind or beside the main crystal so they never cover the inscription.
  const companions: StoneCut['companions'] = []
  const count = style === 'spire' ? 0 : Math.floor(random() * (style === 'broken' ? 3 : 2.4))
  for (let i = 0; i < count; i++) {
    // Out to one side and a little back: alternate sides, measured from straight behind (0) to
    // square to the side (pi/2) and a touch beyond.
    const side = i % 2 ? -1 : 1
    const angle = Math.PI * between(0.3, 0.55)
    const direction: [number, number] = [side * Math.sin(angle), -Math.cos(angle)]
    const small = between(0.26, 0.44)
    const smallHeight = height * small
    const smallWidth = width * between(0.34, 0.5)
    const smallSides = 4 + Math.floor(random() * 3)
    const smallCap = between(0.22, 0.34)
    companions.push({
      at: [direction[0] * width * 0.95, direction[1] * width * 0.95 * (body.flatten ?? 1)],
      spec: {
        sides: smallSides,
        footRadius: smallWidth,
        shoulderRadius: smallWidth * 0.85,
        shaftHeight: smallHeight * (1 - smallCap),
        capHeight: smallHeight * smallCap,
        ridgeOffset: [0, 0],
        ridgeLength: smallWidth * between(0.1, 0.5),
        ridgeAngle: random() * Math.PI,
        // Leaning outward, away from the parent, the way clustered quartz grows.
        lean: smallHeight * between(0.25, 0.55),
        leanAngle: Math.atan2(direction[1], direction[0]),
        roll: random() * Math.PI * 2,
      },
    })
  }

  return { style, body, companions }
}

interface RunestoneProps {
  spec: StoneSpec
  /** Where the viewer is, so the stone can turn its carved face towards them. */
  cameraAt: [number, number, number]
  /** Labels appear on hover, plus permanently for anything wanting attention. The brief's default. */
  showLabel: boolean
  onHover: (id: string | null) => void
  onSelect?: (id: string) => void
  /** The stone the panel is open on. Its body lights from within, as frame 2 of the art shows. */
  selected?: boolean
  /**
   * True for a stone that has just been created or connected. Read once, when the stone first
   * appears: it waits for its roots to reach it, then rises out of the ground. A stone that was
   * already there when the grove opened simply stands.
   */
  rising?: boolean
}

/**
 * How long a new stone waits before breaking the ground: the time the light takes to run down
 * the mycelium to it (see `GROW_SECONDS` in `Mycelium.tsx`), less a little so the two overlap and
 * read as one movement, the roots arriving and the stone answering.
 */
const RISE_DELAY = 1.1
/** From breaking the ground to standing still. Slow enough to watch; it only happens once. */
const RISE_SECONDS = 1.7

/** Decelerates into place with a slight settle past the end, as a heavy thing does. */
function settle(t: number): number {
  const overshoot = 0.9
  const u = t - 1
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u
}

/** The ring of light thrown across the floor as the stone breaks through. */
const SHOCK_RING = groundRing(0.5, 0.012, 96)

/** A tell only flickers if it happened within this long; older ones wait quietly in the panel. */
const TELL_NEWS_MS = 5 * 60 * 1000
const FLICKER_SECONDS = 0.9

export function Runestone({ spec, cameraAt, showLabel, onHover, onSelect, selected = false, rising = false }: RunestoneProps) {
  const scale = spec.scale ?? 1
  const status = spec.status

  const stoneCut = useMemo(() => cutFor(spec.id, spec.cut), [spec.id, spec.cut])
  const cut = stoneCut.body
  const body = useMemo(() => crystal(cut), [cut])
  const companions = useMemo(
    () =>
      stoneCut.companions.map(({ spec: companion, at }) => {
        const geometry = crystal(companion)
        return { geometry, edges: new THREE.EdgesGeometry(geometry, 8), at }
      }),
    [stoneCut]
  )

  /**
   * The hairlines where two facets meet.
   *
   * The fresnel term draws the *silhouette* edge, and that alone leaves the face of a stone as a
   * flat dark panel — which is exactly how the second render looked, like a cardboard cutout. In
   * the art every seam between facets is a lit line, and those interior lines are most of what
   * makes a black shape read as cut glass rather than as a hole in the picture.
   *
   * `EdgesGeometry` with a low angle threshold gives every facet boundary and nothing else, since
   * the crystal is built flat-shaded and has no smooth curvature to confuse it.
   */
  const edges = useMemo(() => new THREE.EdgesGeometry(body, 8), [body])
  const height = cut.shaftHeight + cut.capHeight

  /* One material per stone rather than one shared. It costs six extra programs and buys two
   * things worth more than that: the interior can glow with the stone's own state, and the
   * vertical gradients can use the stone's real height instead of an average. */
  const material = useMemo(() => {
    const shader = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(STONE_SHADER.uniforms),
      vertexShader: STONE_SHADER.vertexShader,
      fragmentShader: STONE_SHADER.fragmentShader,
    })
    shader.uniforms.uHeight!.value = height
    return shader
  }, [height])

  /* The companions share the shader but not its numbers. They are short, so almost all of each
   * one sits in the band the main stone lights as its glowing foot; with the same values they
   * came out as pale, flat shards. Here they are measured against a much taller stone, which
   * keeps them dark glass with only a faint lower glow. */
  const companionMaterial = useMemo(() => {
    const shader = material.clone()
    shader.uniforms = THREE.UniformsUtils.clone(material.uniforms)
    shader.uniforms.uHeight!.value = height * 2.4
    // Small leaning crystals turn whole faces to the key light, and a whole pale face read as a
    // paper shard. The main stone keeps the art's single bright facet.
    shader.uniforms.uFacet!.value = 0.12
    return shader
  }, [material, height])

  /** The rune, as a plane just off the stone's front face with an additive texture. */
  const runeTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(drawRune(spec.rune))
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [spec.rune])

  const runeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: runeTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: new THREE.Color(RUNE_COLOUR[status]),
      }),
    [runeTexture, status]
  )

  /* Two rings on the plinth's lip and one wider on the floor beyond it, which is the arrangement
   * in the art: the stone stands on a small terrace and the terrace stands in a wider circle. */
  const rings = useMemo(
    () => [0.43, 0.47, 0.72].map((radius) => groundRing(radius, radius > 0.6 ? 0.007 : 0.01, 80)),
    []
  )

  /* The thread of light rising from the stone's point, as in the concept frames: a hairline that
   * fades as it climbs, with a single bead on it. It is the stone's state again, seen from far
   * away, so it follows the rune's colour and brightness. */
  const beamMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColour: { value: new THREE.Color(RUNE_COLOUR[status]) }, uAmount: { value: 0.5 } },
        vertexShader: /* glsl */ `
          varying float vAlong;
          void main() {
            vAlong = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColour;
          uniform float uAmount;
          varying float vAlong;
          void main() {
            float along = clamp(vAlong, 0.0, 1.0);
            float fade = pow(1.0 - along, 1.8) * smoothstep(0.0, 0.04, along);
            gl_FragColor = vec4(uColour, fade * uAmount);
          }
        `,
      }),
    [status]
  )
  const beamHeight = 1.4 + (cut.shaftHeight % 0.37) * 2.2

  const runeRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.PointLight>(null)
  const riserRef = useRef<THREE.Group>(null)
  const footRef = useRef<THREE.Group>(null)
  const shockRef = useRef<THREE.Mesh>(null)
  const burstRef = useRef<THREE.PointLight>(null)

  /* Seconds into the rise. Starts negative while the roots are still growing towards the stone,
   * and a stone that was already standing starts at the end. Latched on mount, so the prop
   * changing afterwards cannot restart it. */
  const rise = useRef(rising ? -RISE_DELAY : RISE_SECONDS)
  const [hasRisen] = useState(!rising)
  /* The name and worker badges are DOM and sprites floating above the stone, so they would hang in
   * empty air while it is still underground. They wait until the stone is nearly up. */
  const [awake, setAwake] = useState(!rising)
  const awakeRef = useRef(!rising)
  const shockMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: palette.energy,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )
  useEffect(() => () => shockMaterial.dispose(), [shockMaterial])

  /** Eased 0 to 1, so choosing a stone brightens it over half a second rather than switching. */
  const lift = useRef(0)

  /* A tell flickers the stone's light once, when it is new. Not on launch for tells already
   * there, and not for one found long after it happened: a flag that shows up late should be
   * readable in the panel, not announced as if it just occurred. `flickerAt` is the clock time the
   * flicker started, or -1. */
  const newestTell = spec.tells?.[0]?.at ?? 0
  const seenTell = useRef(newestTell)
  const flickerAt = useRef(-1)
  const [flickerDue, setFlickerDue] = useState(false)
  useEffect(() => {
    if (newestTell <= seenTell.current) return
    seenTell.current = newestTell
    if (Date.now() - newestTell < TELL_NEWS_MS) setFlickerDue(true)
  }, [newestTell])

  useFrame((state, delta) => {
    lift.current = THREE.MathUtils.damp(lift.current, selected ? 1 : 0, 5, delta)
    // Rune and beam wait until the stone has nearly stopped, so it arrives dark and then wakes.
    const reveal = advanceRise(delta, state.clock.elapsedTime)
    const base = RUNE_INTENSITY[status] * reveal
    /* Only `waiting` pulses, and this is the most deliberate decision in the file. A stone that
     * wants you should be findable by peripheral vision, which means movement; a stone that is
     * merely working should not move, or the grove is never still. One thing blinks, and it
     * blinks because it needs a person. */
    const pulse =
      status === 'waiting' ? 0.65 + 0.35 * (Math.sin(state.clock.elapsedTime * 2.1) * 0.5 + 0.5) : 1
    if (flickerDue && flickerAt.current < 0) {
      flickerAt.current = state.clock.elapsedTime
      setFlickerDue(false)
    }
    const intensity = base * pulse * flicker(state.clock.elapsedTime)

    if (runeRef.current) {
      const runeFace = runeRef.current.material as THREE.MeshBasicMaterial
      runeFace.opacity = Math.min(intensity, 1)
      runeFace.color.setStyle(RUNE_COLOUR[status]).multiplyScalar(Math.max(intensity, 0.25))
    }
    // The body's interior carries a trace of the same state, well below the rune's brightness.
    // Enough that a running stone is faintly lit from within, never enough to compete with it.
    material.uniforms.uInner!.value.setStyle(RUNE_COLOUR[status])
    material.uniforms.uGlow!.value = 0.1 + Math.min(intensity, 2.7) * 0.1 + lift.current * 0.45
    companionMaterial.uniforms.uInner!.value.setStyle(RUNE_COLOUR[status])
    companionMaterial.uniforms.uGlow!.value = 0.04 + Math.min(intensity, 2.7) * 0.03
    if (glowRef.current) glowRef.current.intensity = intensity * 1.5 + lift.current * 2.5
    beamMaterial.uniforms.uColour!.value.setStyle(RUNE_COLOUR[status])
    beamMaterial.uniforms.uAmount!.value = Math.min(0.18 + intensity * 0.28, 0.95) * reveal
  })

  /** The flicker's brightness multiplier: three quick dips over under a second, then steady. */
  function flicker(time: number): number {
    if (flickerAt.current < 0) return 1
    const t = time - flickerAt.current
    if (t > FLICKER_SECONDS) {
      flickerAt.current = -1
      return 1
    }
    return 1 - 0.75 * Math.abs(Math.sin((t / FLICKER_SECONDS) * Math.PI * 3)) * (1 - t / FLICKER_SECONDS)
  }

  /**
   * One frame of the rise, if it is still going. Returns how awake the stone should look, 0 to 1.
   *
   * Everything moves as transforms on groups that already exist, so a stone that has finished
   * rising costs exactly what it did before this was added.
   */
  function advanceRise(delta: number, time: number): number {
    if (rise.current >= RISE_SECONDS + 1) return 1
    rise.current += delta
    const t = THREE.MathUtils.clamp(rise.current / RISE_SECONDS, 0, 1)
    const riser = riserRef.current
    if (riser) {
      riser.visible = rise.current > 0
      // From fully below the floor to standing, in the stone's own units.
      riser.position.y = -(height + 0.12) * (1 - settle(t))
      // A tremor while it pushes through, dying away as it settles.
      const tremor = rise.current > 0 ? (1 - t) ** 2 * 0.016 : 0
      riser.position.x = Math.sin(time * 71) * tremor
      riser.position.z = Math.cos(time * 53) * tremor
    }
    // The plinth and its rings open out on the floor as the point breaks through.
    footRef.current?.scale.setScalar(Math.max(0.001, THREE.MathUtils.smoothstep(t, 0, 0.35)))

    const shock = THREE.MathUtils.clamp(rise.current / 1.3, 0, 1)
    const fading = rise.current > 0 ? (1 - shock) ** 2 : 0
    if (shockRef.current) {
      shockRef.current.visible = fading > 0.001
      shockRef.current.scale.setScalar(1 + shock * 5)
    }
    shockMaterial.opacity = fading * 0.8
    if (burstRef.current) burstRef.current.intensity = fading * 7

    const reveal = THREE.MathUtils.smoothstep(t, 0.72, 1)
    if (!awakeRef.current && reveal > 0.3) {
      awakeRef.current = true
      setAwake(true)
    }
    return reveal
  }

  const [x, z] = spec.at
  // Face the viewer, then deviate by `turn`.
  const facing = Math.atan2(cameraAt[0] - x, cameraAt[2] - z) + (spec.turn ?? 0)
  // The inscription sits on the front face, a little below the middle — where the art puts it.
  // The front face's distance from the axis is the polygon's inradius, squashed for a slab, and
  // the panel follows the stone's lean up to that height so it stays on the face.
  const runeSize = cut.footRadius * 1.9
  const runeY = height * 0.46
  const leanAt = cut.lean * (runeY / height) ** 1.35
  const faceDepth =
    ((cut.footRadius + cut.shoulderRadius) / 2) * Math.cos(Math.PI / cut.sides) * (cut.flatten ?? 1)
  const runeX = Math.cos(cut.leanAngle) * leanAt
  const runeZ = faceDepth + Math.sin(cut.leanAngle) * leanAt + 0.012

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, facing, 0]}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHover(spec.id)
        if (onSelect) document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        onHover(null)
        document.body.style.cursor = ''
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect?.(spec.id)
      }}
    >
      <group scale={[scale, scale, scale]}>
        <group ref={riserRef} visible={hasRisen}>
        <mesh geometry={body} material={material} />
        {/* Depth-tested, so only the seams facing the viewer draw. The art shows a hint of the
            far edges through the body as well, but drawing those means turning depth testing off,
            and a line with no depth test paints itself over anything standing in front of it. */}
        <lineSegments geometry={edges}>
          <lineBasicMaterial
            color={palette.stoneRim}
            transparent
            opacity={0.24}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>

        {companions.map((companion, i) => (
          <group key={`companion-${i}`} position={[companion.at[0], 0, companion.at[1]]}>
            <mesh geometry={companion.geometry} material={companionMaterial} />
            <lineSegments geometry={companion.edges}>
              <lineBasicMaterial
                color={palette.stoneRim}
                transparent
                opacity={0.2}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </lineSegments>
          </group>
        ))}

        <mesh ref={runeRef} material={runeMaterial} position={[runeX, runeY, runeZ]}>
          <planeGeometry args={[runeSize, runeSize * 2]} />
        </mesh>

        {/* The beam starts at the apex, which is off-centre by the ridge offset plus the lean. */}
        <group
          position={[
            cut.ridgeOffset[0] + Math.cos(cut.leanAngle) * cut.lean,
            height + 0.05,
            cut.ridgeOffset[1] * (cut.flatten ?? 1) + Math.sin(cut.leanAngle) * cut.lean,
          ]}
        >
          <mesh material={beamMaterial} position={[0, beamHeight / 2, 0]}>
            <cylinderGeometry args={[0.0035, 0.0035, beamHeight, 4, 1, true]} />
          </mesh>
          <mesh material={beamMaterial} position={[0, beamHeight * 0.34, 0]}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        </group>

        {/* What the rune throws onto the stone and the ground around it. */}
        <pointLight
          ref={glowRef}
          position={[runeX, runeY, runeZ + cut.footRadius * 0.6]}
          color={RUNE_COLOUR[status]}
          distance={2.0}
          decay={2}
        />
        </group>

        <group ref={footRef}>
        <mesh geometry={PLINTH} material={PLINTH_MATERIAL} position={[0, 0.011, 0]} />

        {/* A soft dark disc where the stone meets its plinth: the occlusion a real object casts
            right at its foot. Cheap, and it is most of what makes a stone feel heavy. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.029, 0]}>
          <circleGeometry args={[cut.footRadius * 1.25, 24]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.55} depthWrite={false} />
        </mesh>

        {rings.map((geometry, i) => (
          <mesh
            key={`ring-${i}`}
            geometry={geometry}
            material={RING_MATERIAL}
            position={[0, i < 2 ? 0.024 : 0.004, 0]}
          />
        ))}
        </group>

        {hasRisen ? null : (
          <>
            <mesh ref={shockRef} geometry={SHOCK_RING} material={shockMaterial} position={[0, 0.012, 0]} visible={false} />
            <pointLight ref={burstRef} position={[0, 0.25, 0]} color={palette.energy} intensity={0} distance={3.2} decay={2} />
          </>
        )}
      </group>

      {showLabel && awake ? <RuneLabel name={spec.name} /> : null}
      {spec.workers?.length && awake ? (
        <WorkerBadges workers={spec.workers} height={(cut.shaftHeight + cut.capHeight) * scale} alert={status === 'waiting' || status === 'errored'} />
      ) : null}
    </group>
  )
}

/**
 * A stone's name, floating below it as in the concept art.
 *
 * Deliberately not drei's `<Html>`: that puts a real DOM node per stone into the page, which at
 * twenty-five stones means twenty-five elements being repositioned every frame. A sprite stays on
 * the GPU. It also means the label cannot be selected or read by a screen reader, which is a real
 * cost — and the answer to that is that the interface will carry an accessible list of stones
 * elsewhere, not that this label should be DOM.
 */
function RuneLabel({ name }: { name: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const scale = 2 // for retina
    canvas.width = 512 * scale
    canvas.height = 128 * scale
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(scale, scale)
      ctx.fillStyle = palette.text
      ctx.font = '400 30px "Geist Variable", ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(name, 256, 64)
    }
    const canvasTexture = new THREE.CanvasTexture(canvas)
    canvasTexture.colorSpace = THREE.SRGBColorSpace
    return canvasTexture
  }, [name])

  return (
    // At the stone's foot, just in front of its rings, where the art writes the names. It used to
    // sit at y = -0.24, under the reflective floor, which hid every label. Drawn without a depth
    // test so the dais rim in front of a back-row stone cannot swallow it either.
    <sprite position={[0, 0.16, 1.0]} scale={[3.0, 0.75, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} opacity={0.85} />
    </sprite>
  )
}
