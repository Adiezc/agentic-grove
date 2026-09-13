/**
 * The grove itself: camera, light, the cast, and the post-processing that ties it together.
 *
 * **Camera, derived rather than chosen.** The ground rings in the concept art are about 0.24 as
 * tall as they are wide. A circle on the floor projects to an ellipse of that ratio when the
 * camera sits roughly 14 degrees above the plane, so that is where the camera sits. This is worth
 * spelling out because a 45-degree isometric view — the obvious choice, and what most of these
 * scenes end up being — makes a completely different picture: you look down *onto* a diagram
 * rather than across at a place. The low angle is most of why the art feels like standing in a
 * clearing, and it is the single easiest thing to get wrong.
 *
 * **Spike scope, stated plainly.** No real data. The six stones and their states are fixtures
 * taken from the concept art, because the point of this session is to judge the *look* — wiring
 * in the real 15 stones would change the composition and make the comparison against the art
 * impossible. Session four connects the scan.
 */
import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { BlendFunction, KernelSize } from 'postprocessing'
import * as THREE from 'three'
import { camera as cameraSpec, motion, palette } from '../theme/palette'
import { Ground } from './Ground'
import { Motes } from './Motes'
import { Mycelium } from './Mycelium'
import { growNetwork } from './network'
import { Runestone, type StoneSpec } from './Runestone'
import { WorldTree } from './WorldTree'

/**
 * The six stones, placed to match the concept art.
 *
 * Positions were read off the art on a grid and converted to the ground plane. Note what the
 * spacing is *not*: even. There is a deliberate gap at front-centre, because that is where the
 * rune console sits and a stone behind it would fight with it. The stones also sit further out
 * sideways than they do towards the camera, which is what keeps them clear of the tree in a
 * low-angle view. Both of those are compositional decisions in the original, not accidents, and
 * they are the kind of thing that gets lost if you place six objects on an even circle.
 */
export const SPIKE_STONES: StoneSpec[] = [
  { id: 'research', name: 'Research', rune: 'ascend', status: 'running', at: [-3.05, -1.95], scale: 0.94, turn: 0.16 },
  { id: 'data', name: 'Data', rune: 'ring', status: 'idle', at: [-4.4, 0.2], scale: 1.02, turn: -0.24 },
  { id: 'compute', name: 'Compute', rune: 'thrice', status: 'idle', at: [-2.7, 2.55], scale: 1.06, turn: 0.09 },
  { id: 'connect', name: 'Connect', rune: 'bind', status: 'waiting', at: [2.3, 2.65], scale: 1.05, turn: -0.13 },
  { id: 'build', name: 'Build', rune: 'mark', status: 'running', at: [3.25, -1.8], scale: 0.92, turn: 0.21 },
  { id: 'archive', name: 'Archive', rune: 'tally', status: 'idle', at: [4.55, 0.5], scale: 0.98, turn: -0.18 },
]

export type QualityPreset = 'high' | 'balanced' | 'low'

const QUALITY: Record<QualityPreset, { reflect: boolean; reflectionRes: number; dpr: [number, number] }> = {
  /** Everything on. What the look is judged at. */
  high: { reflect: true, reflectionRes: 512, dpr: [1, 1.5] },
  /** Reflections at half resolution. Almost indistinguishable, roughly half the cost. */
  balanced: { reflect: true, reflectionRes: 256, dpr: [1, 1.25] },
  /** No reflections at all. Honest rather than pretty: the stones lose their footing. */
  low: { reflect: false, reflectionRes: 256, dpr: [1, 1] },
}

/**
 * How busy the grove is, 0 to 1, from the stones themselves.
 *
 * Kept as one number because that is all the tree and the air need to know. Deriving it here
 * rather than passing booleans around means the heartbeat has exactly one input, and there is one
 * place to argue about what "busy" means.
 */
function activityOf(stones: StoneSpec[]): number {
  if (!stones.length) return 0
  const working = stones.filter((stone) => stone.status === 'running').length
  // Saturating rather than linear: three running agents should already feel busy, and a
  // twenty-stone grove should not need eighteen of them lit to reach a full heartbeat.
  return 1 - Math.exp(-working / 2.2)
}

/** Gentle parallax on mouse move, which is the brief's default over a free camera. */
function CameraRig({ enabled }: { enabled: boolean }) {
  const { camera } = useThree()
  const target = useMemo(() => new THREE.Vector3(...cameraSpec.target), [])
  const base = useMemo(() => new THREE.Vector3(...cameraSpec.position), [])

  useFrame((state, delta) => {
    if (!enabled) {
      camera.position.copy(base)
      camera.lookAt(target)
      return
    }
    // `state.pointer` is -1..1 across the canvas. Damped towards the offset rather than set to
    // it, so the camera has weight and a flicked mouse does not snap the whole world sideways.
    const wantX = base.x + state.pointer.x * motion.parallax * 7
    const wantY = base.y - state.pointer.y * motion.parallax * 2.6
    camera.position.x = THREE.MathUtils.damp(camera.position.x, wantX, 2.4, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, wantY, 2.4, delta)
    camera.position.z = base.z
    camera.lookAt(target)
  })
  return null
}

/** What the renderer is doing, sampled once a second. */
export interface PerfSample {
  fps: number
  drawCalls: number
  triangles: number
  programs: number
}

/**
 * Frame rate plus draw calls and triangles.
 *
 * The counts matter as much as the rate. A scene at 3fps with 60 draw calls and 40,000 triangles
 * is not heavy, it is broken, and knowing which of those two it is decides whether you optimise
 * or go looking for a bug. Worth keeping for the whole look-development phase.
 */
function Perf({ onSample }: { onSample: (sample: PerfSample) => void }) {
  const frames = useRef(0)
  const since = useRef(0)
  useFrame((state, delta) => {
    frames.current += 1
    since.current += delta
    if (since.current >= 1) {
      const info = state.gl.info
      // Divided by the frames counted, because with `autoReset` off the counters accumulate
      // across every frame since the last reset. Reporting the raw total said "279 draw calls"
      // for a scene that issues about 60 per frame, which is the sort of number that sends you
      // optimising something that was never the problem.
      const perFrame = Math.max(frames.current, 1)
      onSample({
        fps: Math.round(frames.current / since.current),
        drawCalls: Math.round(info.render.calls / perFrame),
        triangles: Math.round(info.render.triangles / perFrame),
        programs: info.programs?.length ?? 0,
      })
      info.reset()
      frames.current = 0
      since.current = 0
    }
  })
  return null
}

interface GroveSceneProps {
  stones?: StoneSpec[]
  quality?: QualityPreset
  /** Off under `prefers-reduced-motion`, and off for a still capture. */
  animate?: boolean
  /** Bloom, vignette and grain. Toggleable so their cost can be measured rather than assumed. */
  post?: boolean
  onPerf?: (sample: PerfSample) => void
  onHoverStone?: (id: string | null) => void
}

export function GroveScene({
  stones = SPIKE_STONES,
  quality = 'high',
  animate = true,
  post = true,
  onPerf,
  onHoverStone,
}: GroveSceneProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const settings = QUALITY[quality]
  const activity = activityOf(stones)

  /* The whole below-ground system, grown once from where the stones stand. Roots and mycelium
   * come out of one generator so they cannot come apart at the trunk — see `network.ts`. */
  const network = useMemo(
    () => growNetwork(stones.map((stone) => ({ id: stone.id, at: stone.at }))),
    [stones]
  )

  /* A root carries light when something is happening at its stone. `waiting` counts: the agent is
   * still there, holding the turn back, so the connection is live. */
  const active = useMemo(
    () =>
      new Set(
        stones
          .filter((stone) => stone.status === 'running' || stone.status === 'waiting')
          .map((stone) => stone.id)
      ),
    [stones]
  )

  const handleHover = (id: string | null) => {
    setHovered(id)
    onHoverStone?.(id)
  }

  return (
    <Canvas
      dpr={settings.dpr}
      camera={{ fov: cameraSpec.fov, position: cameraSpec.position, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: false }}
      // Colour management on and tone mapping off. The palette was sampled from an image in sRGB,
      // so anything that re-grades it moves us off the art — and ACES in particular would pull
      // every bright green towards white, which is exactly the fidelity we are trying to keep.
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.NoToneMapping
        // Manual, because EffectComposer's final fullscreen pass resets these counters itself
        // and the readout then says "1 draw call" however busy the scene is. Reset once a
        // second in `Perf` instead, after the numbers have been read.
        gl.info.autoReset = false
        scene.background = new THREE.Color(palette.ground)
        // Fog pushed far out. At 14 units it was sitting in front of the stones and turning the
        // whole frame into green haze — the art has no atmospheric fill at all, just black.
        scene.fog = new THREE.Fog(palette.ground, 30, 62)
      }}
    >
      <CameraRig enabled={animate} />
      {onPerf ? <Perf onSample={onPerf} /> : null}

      {/* Light is minimal on purpose. Nearly everything in this scene emits rather than reflects,
          which is what a near-black image with glowing objects in it actually requires. The
          ambient term exists only so the trunk and stones are not pure silhouettes. */}
      {/* Almost nothing. The first pass had ambient at 0.16 and it lifted the entire floor off
          black, which is the one thing the art never does. Everything that should be visible
          here emits its own light; ambient exists only so a trunk edge is not pure void. */}
      <ambientLight intensity={0.045} color={palette.moss} />
      {/* A cold rim from behind and left, which is what separates the trunk from the background
          in the art without lighting the scene. */}
      <directionalLight position={[-7, 5, -6]} intensity={0.32} color={palette.glow} />
      {/* A dim warm-side fill so the trunk reads as a solid object rather than a silhouette. */}
      <directionalLight position={[5, 3, 6]} intensity={0.08} color={palette.bone} />

      <Ground reflect={settings.reflect} reflectionResolution={settings.reflectionRes} />
      <Mycelium network={network} active={active} />
      {/* Scaled up a touch. Measured against the art the tree should fill rather more of the
          frame than a one-to-one build of the coordinates gives, because the art's camera is
          slightly closer than the ring ellipse alone implies. */}
      <group scale={1.12}>
        <WorldTree activity={animate ? activity : 0} />
      </group>

      {stones.map((stone) => (
        <Runestone
          key={stone.id}
          spec={stone}
          cameraAt={cameraSpec.position}
          // On hover, and permanently for anything that wants you. The brief's default, and it
          // keeps the resting scene almost wordless.
          showLabel={hovered === stone.id || stone.status === 'waiting' || stone.status === 'errored'}
          onHover={handleHover}
        />
      ))}

      {animate ? <Motes activity={activity} /> : null}

      {post ? (
      <EffectComposer>
        {/* The bloom is the art direction, not an effect on top of it. The concept art's bright
            greens are all blown out into their surroundings, and a low threshold with a large
            kernel is what reproduces that. Everything dark stays dark because the threshold keeps
            the near-black ground well below it. */}
        {/* Threshold raised hard and intensity halved. At 0.16/1.45 the canopy saturated to
            white clouds and every faint ring bloomed into the one next to it. The art blooms
            only what is genuinely bright — a lit rune, a pulse in a root, the hottest leaves —
            and leaves the rest crisp. MEDIUM kernel rather than LARGE: it is also most of the
            frame cost, and the difference is invisible next to the threshold change. */}
        <Bloom
          intensity={0.72}
          luminanceThreshold={0.52}
          luminanceSmoothing={0.22}
          kernelSize={KernelSize.MEDIUM}
          mipmapBlur
        />
        <Vignette offset={0.22} darkness={0.82} blendFunction={BlendFunction.NORMAL} />
        {/* A trace of grain. The art has a fine film texture, and without it the large flat dark
            areas band visibly on an 8-bit display. */}
        <Noise opacity={0.035} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
      ) : null}
    </Canvas>
  )
}
