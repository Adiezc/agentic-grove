/**
 * The grove itself: camera, light, the cast, and the post-processing that ties it together.
 *
 * **Camera.** The supplied flow frames show more of the roots and circular floor than the first
 * spike did. The elevated three-quarter camera keeps the tree dominant while exposing enough of
 * the dais for the root-to-mycelium transition to read as one continuous system.
 *
 * **Spike scope, stated plainly.** No real data. The six stones and their states are fixtures
 * taken from the concept art, because the point of this session is to judge the *look* — wiring
 * in the real 15 stones would change the composition and make the comparison against the art
 * impossible. Session four connects the scan.
 */
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { BlendFunction, KernelSize } from 'postprocessing'
import * as THREE from 'three'
import { camera as cameraSpec, palette } from '../theme/palette'
import { Ground } from './Ground'
import { Motes } from './Motes'
import { Mycelium } from './Mycelium'
import { growNetwork } from './network'
import { Runestone, type StoneSpec } from './Runestone'
import { ReferenceTree } from './ReferenceTree'

/**
 * The six stones, placed to match the concept art.
 *
 * Positions were read off the art on a grid and converted to the ground plane. Note what the
 * spacing is *not*: even. There is a deliberate gap at front-centre, because that is where the
 * rune console sits and a stone behind it would fight with it. The stones also sit further out
 * sideways than they do towards the camera, which is what keeps them clear of the tree in a
 * elevated view. Both of those are compositional decisions in the original, not accidents, and
 * they are the kind of thing that gets lost if you place six objects on an even circle.
 */
/* Pushed out by about a third once the tree was rebuilt with depth all round: its crown now
 * spreads nearly a metre further to each side, and the stones had started to crowd it. The
 * arrangement is the art's, scaled; only the distance from the trunk changed. */
export const SPIKE_STONES: StoneSpec[] = [
  { id: 'research', name: 'Research', rune: 'anm', status: 'running', at: [-3.7, -2.25], scale: 0.94, turn: 0.16 },
  { id: 'data', name: 'Data', rune: 'maqi', status: 'idle', at: [-5.25, 0.3], scale: 1.02, turn: -0.24 },
  { id: 'compute', name: 'Compute', rune: 'celi', status: 'idle', at: [-3.35, 3.1], scale: 1.06, turn: 0.09 },
  { id: 'connect', name: 'Connect', rune: 'mucoi', status: 'waiting', at: [2.9, 3.2], scale: 1.05, turn: -0.13 },
  { id: 'build', name: 'Build', rune: 'neta', status: 'running', at: [3.9, -2.05], scale: 0.92, turn: 0.21 },
  { id: 'archive', name: 'Archive', rune: 'avi', status: 'idle', at: [5.3, 0.7], scale: 0.98, turn: -0.18 },
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
  const working = stones.filter((stone) => stone.status === 'running' || stone.status === 'waiting').length
  // Saturating rather than linear: three running agents should already feel busy, and a
  // twenty-stone grove should not need eighteen of them lit to reach a full heartbeat.
  return 1 - Math.exp(-working / 2.2)
}

/** Orbit the whole grove, while keeping the supplied composition as a reliable home view. */
function CameraRig({ resetKey, animate }: { resetKey: number; animate: boolean }) {
  const { camera } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)

  useEffect(() => {
    camera.position.set(...cameraSpec.position)
    controls.current?.target.set(...cameraSpec.target)
    controls.current?.update()
  }, [camera, resetKey])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={cameraSpec.target}
      enablePan={false}
      enableZoom
      enableRotate
      enableDamping={animate}
      dampingFactor={0.065}
      rotateSpeed={0.42}
      zoomSpeed={0.55}
      minDistance={13}
      maxDistance={29}
      minPolarAngle={Math.PI * 0.22}
      maxPolarAngle={Math.PI * 0.46}
    />
  )
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
  /** Increment to return the orbit camera to the supplied Grove composition. */
  viewResetKey?: number
}

export function GroveScene({
  stones = SPIKE_STONES,
  quality = 'high',
  animate = true,
  post = true,
  onPerf,
  onHoverStone,
  viewResetKey = 0,
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
  const attention = useMemo(
    () => new Set(stones.filter((stone) => stone.status === 'waiting').map((stone) => stone.id)),
    [stones]
  )
  const failed = useMemo(
    () => new Set(stones.filter((stone) => stone.status === 'errored').map((stone) => stone.id)),
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
      <CameraRig resetKey={viewResetKey} animate={animate} />
      {onPerf ? <Perf onSample={onPerf} /> : null}

      {/* Light is minimal on purpose. Nearly everything in this scene emits rather than reflects,
          which is what a near-black image with glowing objects in it actually requires. The
          ambient term exists only so the trunk and stones are not pure silhouettes. */}
      {/* Almost nothing. The first pass had ambient at 0.16 and it lifted the entire floor off
          black, which is the one thing the art never does. Everything that should be visible
          here emits its own light; ambient exists only so a trunk edge is not pure void. */}
      <ambientLight intensity={0.065} color={palette.moss} />
      {/* A cold rim from behind and left, which is what separates the trunk from the background
          in the art without lighting the scene. */}
      <directionalLight position={[-7, 5, -6]} intensity={0.38} color={palette.glow} />
      {/* A dim warm-side fill so the trunk reads as a solid object rather than a silhouette. */}
      <directionalLight position={[5, 3, 6]} intensity={0.08} color={palette.bone} />

      <Ground reflect={settings.reflect} reflectionResolution={settings.reflectionRes} />
      <Mycelium network={network} active={active} attention={attention} failed={failed} activity={activity} animate={animate} />
      {/* Scaled up a touch. Measured against the art the tree should fill rather more of the
          frame than a one-to-one build of the coordinates gives, because the art's camera is
          slightly closer than the ring ellipse alone implies. */}
      <group scale={1.12}>
        <ReferenceTree activity={activity} attention={attention.size > 0} network={network} animate={animate} />
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
          intensity={0.9}
          luminanceThreshold={0.36}
          luminanceSmoothing={0.28}
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
