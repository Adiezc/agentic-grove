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
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { crystal, groundRing, seededRandom, type CrystalSpec } from './geometry'
import { STONE_HEIGHT } from './stage'
import { drawRune, type RuneId } from './runes'
import type { SessionStatus } from '../../core/harnesses/types.ts'

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
        + uEdge * facet * 0.55
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
  idle: 0.5,
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
 * The ranges are read off the art. Four to six sides; between two and three times taller than
 * wide; a cap around a quarter to a third of the height; and a ridge that always sits off-centre,
 * because a centred one is a spike and reads as a traffic bollard.
 */
export function cutFor(id: string, overrides?: Partial<CrystalSpec>): CrystalSpec {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const random = seededRandom(hash >>> 0)
  // Burn the first few, which on a hash-derived seed are correlated with the first character.
  random()
  random()

  const sides = 4 + Math.floor(random() * 3)
  /* Wider than the second render, which still had these at about three and a half to one and
   * read as shards rather than as the blocky quartz in the art. Measuring a stone in
   * `grove-main.png` gives 70 pixels across to 180 tall: two and a half to one. */
  const width = 0.27 + random() * 0.085
  const capShare = 0.19 + random() * 0.09
  const height = STONE_HEIGHT * (0.88 + random() * 0.24)

  return {
    sides,
    footRadius: width,
    // Slightly narrower at the shoulder than the foot, which is what stops a shaft reading as
    // extruded. Real quartz is nearly parallel-sided, but nearly is the operative word.
    shoulderRadius: width * (0.82 + random() * 0.12),
    shaftHeight: height * (1 - capShare),
    capHeight: height * capShare,
    // Always off-axis, by between a fifth and a half of the stone's own width.
    ridgeOffset: [
      (random() - 0.5) * width * 0.9,
      (random() - 0.5) * width * 0.9,
    ],
    ridgeLength: width * (0.5 + random() * 0.7),
    ridgeAngle: random() * Math.PI,
    lean: (random() - 0.5) * 0.1,
    leanAngle: random() * Math.PI * 2,
    roll: random() * Math.PI * 2,
    ...overrides,
  }
}

interface RunestoneProps {
  spec: StoneSpec
  /** Where the viewer is, so the stone can turn its carved face towards them. */
  cameraAt: [number, number, number]
  /** Labels appear on hover, plus permanently for anything wanting attention. The brief's default. */
  showLabel: boolean
  onHover: (id: string | null) => void
}

export function Runestone({ spec, cameraAt, showLabel, onHover }: RunestoneProps) {
  const scale = spec.scale ?? 1
  const status = spec.status

  const cut = useMemo(() => cutFor(spec.id, spec.cut), [spec.id, spec.cut])
  const body = useMemo(() => crystal(cut), [cut])

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

  const runeRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    const base = RUNE_INTENSITY[status]
    /* Only `waiting` pulses, and this is the most deliberate decision in the file. A stone that
     * wants you should be findable by peripheral vision, which means movement; a stone that is
     * merely working should not move, or the grove is never still. One thing blinks, and it
     * blinks because it needs a person. */
    const pulse =
      status === 'waiting' ? 0.65 + 0.35 * (Math.sin(state.clock.elapsedTime * 2.1) * 0.5 + 0.5) : 1
    const intensity = base * pulse

    if (runeRef.current) {
      const runeFace = runeRef.current.material as THREE.MeshBasicMaterial
      runeFace.opacity = Math.min(intensity, 1)
      runeFace.color.setStyle(RUNE_COLOUR[status]).multiplyScalar(Math.max(intensity, 0.25))
    }
    // The body's interior carries a trace of the same state, well below the rune's brightness.
    // Enough that a running stone is faintly lit from within, never enough to compete with it.
    material.uniforms.uInner!.value.setStyle(RUNE_COLOUR[status])
    material.uniforms.uGlow!.value = 0.1 + Math.min(intensity, 2.7) * 0.1
    if (glowRef.current) glowRef.current.intensity = intensity * 1.5
  })

  const [x, z] = spec.at
  // Face the viewer, then deviate by `turn`.
  const facing = Math.atan2(cameraAt[0] - x, cameraAt[2] - z) + (spec.turn ?? 0)
  // The rune sits on the front face, at about a third of the height — where the art puts it.
  const runeSize = cut.footRadius * 1.9
  const runeY = height * 0.46

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, facing, 0]}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHover(spec.id)
      }}
      onPointerOut={() => onHover(null)}
    >
      <group scale={[scale, scale, scale]}>
        <mesh geometry={body} material={material} />
        {/* Depth-tested, so only the seams facing the viewer draw. The art shows a hint of the
            far edges through the body as well, but drawing those means turning depth testing off,
            and a line with no depth test paints itself over anything standing in front of it. */}
        <lineSegments geometry={edges}>
          <lineBasicMaterial
            color={palette.stoneRim}
            transparent
            opacity={0.13}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>

        <mesh ref={runeRef} material={runeMaterial} position={[0, runeY, cut.footRadius * 0.92]}>
          <planeGeometry args={[runeSize, runeSize * 1.9]} />
        </mesh>

        {/* What the rune throws onto the stone and the ground around it. */}
        <pointLight
          ref={glowRef}
          position={[0, runeY, cut.footRadius * 1.5]}
          color={RUNE_COLOUR[status]}
          distance={2.0}
          decay={2}
        />

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

      {showLabel ? <RuneLabel name={spec.name} /> : null}
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
    <sprite position={[0, -0.24, 0.5]} scale={[1.4, 0.35, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} opacity={0.85} />
    </sprite>
  )
}
