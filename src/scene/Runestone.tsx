/**
 * A runestone: one project, standing where its work happens.
 *
 * Read off the concept art, a stone is four things and no more:
 *   1. a near-black tapered crystal prism, lit only at its edges
 *   2. a rune carved into its face, which is the only part that changes with state
 *   3. concentric rings on the ground around its base
 *   4. a vertical smear of reflection beneath it on the wet floor
 *
 * The restraint is the design. The stone body never changes colour — an idle stone and a running
 * stone are the same silhouette, and only the rune tells them apart. That is what lets twenty-five
 * of these sit on screen without the scene becoming a fairground.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../theme/palette'
import { groundRing } from './geometry'
import { drawRune, type RuneId } from './runes'
import type { SessionStatus } from '../../core/harnesses/types.ts'

/**
 * Lean a geometry over as it rises, in place.
 *
 * `height` is the geometry's own height and `from` how far up its lean has already got, so a cap
 * placed on top of a body can continue the same curve rather than starting again from vertical.
 * Used by both, which is the point: one rule, so they cannot disagree.
 */
function shear(geometry: THREE.BufferGeometry, height: number, from = 0): void {
  const position = geometry.attributes.position
  if (!position) return
  const array = position.array as Float32Array
  for (let i = 0; i < array.length; i += 3) {
    const y = array[i + 1] ?? 0
    const t = from + ((y + height / 2) / height) * (1 - from)
    const lean = t ** 1.6
    array[i] = (array[i] ?? 0) + lean * 0.16
    array[i + 2] = (array[i + 2] ?? 0) - lean * 0.065
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
}

/**
 * Replace a prism's flat face normals with radial ones, as if it were a cylinder.
 *
 * This is what finally made the stones look like the art, and it took three attempts to work out
 * why they would not. A six-sided prism has one normal per face, so *any* view-dependent shading
 * gives each face a single uniform value: the fresnel rim I wrote to pick out the silhouette
 * edges instead lit whole panels, and the stones stayed grey signposts.
 *
 * Pointing each normal outwards from the axis makes the shading sweep smoothly around the stone
 * instead, so it is black where a face turns towards you and bright along the edge where it
 * turns away. The facets are still there in the silhouette, which is where they read anyway.
 */
function radialNormals(geometry: THREE.BufferGeometry): void {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  if (!position || !normal) return
  const positions = position.array as Float32Array
  const normals = normal.array as Float32Array
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0
    const z = positions[i + 2] ?? 0
    const length = Math.hypot(x, z) || 1
    normals[i] = x / length
    normals[i + 1] = 0
    normals[i + 2] = z / length
  }
  normal.needsUpdate = true
}

/**
 * Near-black, with light only where the surface turns away from you.
 *
 * A standard lit material was the wrong tool and it took two renders to see why. Any amount of
 * directional light on a six-sided prism lights whole *faces*, so the stones came out as flat
 * grey-green panels — road signs. The concept art's stones are almost pure black across every
 * face, with a single bright hairline running up the edge where the silhouette turns.
 *
 * That is a fresnel term, not a light: brightness from how steeply the surface faces away from
 * the camera. It also means the highlight travels around the stone as the camera parallaxes,
 * which is what makes a black shape read as glassy rather than as a hole in the image.
 */
const STONE_MATERIAL = new THREE.ShaderMaterial({
uniforms: {
  uBase: { value: new THREE.Color(palette.stone) },
  uRim: { value: new THREE.Color(palette.stoneRim) },
  uEdge: { value: new THREE.Color(palette.glow) },
},
vertexShader: /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`,
fragmentShader: /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uEdge;
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    // Two terms: a broad soft one that gives the stone a little body, and a very tight
    // one that is the hairline along the silhouette edge.
    float body = pow(1.0 - facing, 2.5);
    float edge = pow(1.0 - facing, 9.0);
    vec3 colour = uBase + uRim * body * 0.3 + uEdge * edge * 0.75;
    gl_FragColor = vec4(colour, 1.0);
  }
`,
})

/** Shared by every stone: the rings are identical, so one material serves all of them. */
const RING_MATERIAL = new THREE.MeshBasicMaterial({
  color: palette.vein,
  transparent: true,
  opacity: 0.45,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
})

/** How brightly a rune burns, per state. The whole visual language of status, in four numbers. */
const RUNE_INTENSITY: Record<SessionStatus, number> = {
  /** Barely lit. The stone is there; nothing is happening on it. */
  idle: 0.5,
  /** Working. Bright, steady, and bloomed. */
  running: 3.4,
  /** Holding the turn back. Slightly less bright than running but it *pulses*, which is what
   *  catches an eye that is not looking directly at it. */
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
  /** Small variation so six stones do not look stamped. 1 is the base height from the art. */
  scale?: number
  /**
   * How far this stone is turned *away* from facing the viewer, in radians.
   *
   * Not an absolute rotation. A rune is carved on one face, and a stone whose carved face points
   * into the distance shows the viewer a blank slab — which is what happened on the first pass:
   * five of the six runes were invisible because the stones sat around a ring and half of them
   * had their backs to the camera. In the concept art every rune faces you.
   *
   * So a stone turns to face the camera by default and this is the deviation from that, which
   * keeps them from looking like a rank of soldiers on parade while still letting you read every
   * rune at a glance. That is the whole point of the grove: one look tells you everything.
   */
  turn?: number
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

  /**
   * The stone body: a six-sided prism, tapered towards the top and cut at an angle.
   *
   * `CylinderGeometry` with six radial segments and a smaller top radius gets the silhouette in
   * one line. The art's stones are then sheared slightly, which is what stops them reading as
   * pencils — so the top vertices get pushed sideways afterwards.
   */
  const body = useMemo(() => {
    // Narrower and taller than the first attempt, which at 0.42 wide read as a road sign. The
    // art's stones are close to five times taller than they are wide.
    const geometry = new THREE.CylinderGeometry(0.2, 0.3, 2.0, 6, 1, false)
    shear(geometry, 2.0)
    radialNormals(geometry)
    return geometry
  }, [])

  /**
   * The cap: a six-sided pyramid, cut at an angle so the point is off-centre.
   *
   * The first version was an untouched cone on a sheared body, so the tip sat back over the
   * middle of the stone and the silhouette came out as an arrow. A crystal's point continues the
   * direction the shaft is already leaning, which is the whole difference between a shard and a
   * signpost. Sheared with the same function as the body, so the two agree by construction
   * rather than by two numbers someone has to keep in step.
   */
  const cap = useMemo(() => {
    // Taller than the first version, at about a quarter of the stone's height, which is the
    // proportion in the art. A short cap reads as a pencil sharpened once.
    const geometry = new THREE.ConeGeometry(0.2, 0.72, 6)
    shear(geometry, 0.72, 1.0)
    // Deliberately *not* given radial normals, unlike the body. On a cone those point nearly at
    // the camera down the near slope, which maxes the fresnel and makes every tip a bright
    // arrowhead. Flat facet normals keep the cap dark and let it catch one edge, which is what
    // the art's faceted tips do.
    return geometry
  }, [])

  /** The rune, as a plane on the stone's front face with an additive texture. */
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

  const rings = useMemo(
    () => [0.52, 0.74].map((radius) => groundRing(radius * scale, 0.008, 96)),
    [scale]
  )

  const runeRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    const base = RUNE_INTENSITY[status]
    // Only `waiting` pulses, and this is the most deliberate decision in the file. A stone that
    // wants you should be findable by peripheral vision, which means movement; a stone that is
    // merely working should not move, or the grove is never still. One thing blinks, and it
    // blinks because it needs a person.
    const pulse =
      status === 'waiting' ? 0.65 + 0.35 * (Math.sin(state.clock.elapsedTime * 2.1) * 0.5 + 0.5) : 1
    const intensity = base * pulse

    if (runeRef.current) {
      const material = runeRef.current.material as THREE.MeshBasicMaterial
      material.opacity = Math.min(intensity, 1)
      material.color.setStyle(RUNE_COLOUR[status]).multiplyScalar(Math.max(intensity, 0.25))
    }
    if (glowRef.current) glowRef.current.intensity = intensity * 1.6
  })

  const [x, z] = spec.at
  // Face the viewer, then deviate by `turn`.
  const facing = Math.atan2(cameraAt[0] - x, cameraAt[2] - z) + (spec.turn ?? 0)

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
        <mesh geometry={body} material={STONE_MATERIAL} position={[0, 1.0, 0]} />
        {/* The cap continues the body's lean, so its own shear starts where the body's ended. */}
        <mesh geometry={cap} material={STONE_MATERIAL} position={[0.16, 2.36, -0.066]} />

        {/* The rune sits just off the face so it never z-fights with the stone. */}
        <mesh ref={runeRef} material={runeMaterial} position={[0.05, 1.15, 0.28]}>
          <planeGeometry args={[0.34, 0.34]} />
        </mesh>

        {/* What the rune throws onto the stone and the ground around it. */}
        <pointLight
          ref={glowRef}
          position={[0.04, 1.12, 0.42]}
          color={RUNE_COLOUR[status]}
          distance={2.2}
          decay={2}
        />

        {/* A soft dark disc under the base: the occlusion a real object casts into the ground
            right where it meets it. Cheap, and it is most of what makes a stone feel heavy. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
          <circleGeometry args={[0.46, 32]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.75} depthWrite={false} />
        </mesh>

        {rings.map((geometry, i) => (
          <mesh key={`ring-${i}`} geometry={geometry} material={RING_MATERIAL} position={[0, 0.005, 0]} />
        ))}
      </group>

      {showLabel ? (
        <RuneLabel name={spec.name} />
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
    <sprite position={[0, -0.28, 0.5]} scale={[1.6, 0.4, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} opacity={0.85} />
    </sprite>
  )
}
