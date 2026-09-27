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
import { Canopy, DeployWisp } from './Canopy'
import { EmptyPlace } from './EmptyPlace'
import type { EmptyPlace as Place } from './layout'
import { useTree } from '../agents/tree'
import { useFlow, type FlowView } from '../store/flow'

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

type Vec3 = [number, number, number]
interface Shot {
  position: Vec3
  target: Vec3
}

/** The home composition, and the direction every other shot looks from. */
const HOME: Shot = { position: cameraSpec.position, target: cameraSpec.target }
const HOME_OFFSET = new THREE.Vector3(...cameraSpec.position).sub(new THREE.Vector3(...cameraSpec.target))

/**
 * Where the camera should be for each step of the flow.
 *
 * Every shot looks from the same direction as home and only moves closer, so moving between them
 * reads as leaning in rather than flying somewhere. The targets are pushed right of the subject
 * because the panels open on the right: the thing you picked should sit in the open two-thirds
 * of the screen, as it does in the art.
 */
function shotFor(view: FlowView, stone: StoneSpec | undefined): Shot {
  if (view === 'stone' && stone) {
    // From the home direction, never round the side: every rune is carved on the face that
    // looks at the home camera, and swinging round a stone shows you its blank back. Aimed right
    // of the stone, so it lands left of centre with the tree beside it and the panel clear.
    const target = new THREE.Vector3(stone.at[0] + 2.6, 1.1, stone.at[1])
    const position = target.clone().addScaledVector(HOME_OFFSET, 0.74)
    return { target: target.toArray() as Vec3, position: position.toArray() as Vec3 }
  }
  if (view === 'agents') {
    // Level with the canopy rather than looking down into it, as frame 3 does.
    const target = new THREE.Vector3(0.4, 3.75, 0)
    const from = new THREE.Vector3(0, 0.3, 1).normalize().multiplyScalar(8.6)
    return { target: target.toArray() as Vec3, position: target.clone().add(from).toArray() as Vec3 }
  }
  return HOME
}

/**
 * Orbit the whole grove, and glide between the flow's shots.
 *
 * The glide is a damped chase rather than a timed tween, so a second click halfway through simply
 * changes where it is heading with no jump. The orbit controls are switched off while it runs,
 * because two things steering one camera is how you get a shudder at the end of every move.
 */
function CameraRig({ shot, resetKey, animate }: { shot: Shot; resetKey: number; animate: boolean }) {
  const { camera } = useThree()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const gliding = useRef(true)
  const goal = useMemo(
    () => ({ position: new THREE.Vector3(...shot.position), target: new THREE.Vector3(...shot.target) }),
    [shot]
  )

  useEffect(() => {
    gliding.current = true
  }, [goal, resetKey])

  useFrame((_, delta) => {
    const orbit = controls.current
    if (!gliding.current || !orbit) return
    // Under reduced motion the camera cuts rather than glides.
    const rate = animate ? 3.2 : 1000
    camera.position.x = THREE.MathUtils.damp(camera.position.x, goal.position.x, rate, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, goal.position.y, rate, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, goal.position.z, rate, delta)
    orbit.target.x = THREE.MathUtils.damp(orbit.target.x, goal.target.x, rate, delta)
    orbit.target.y = THREE.MathUtils.damp(orbit.target.y, goal.target.y, rate, delta)
    orbit.target.z = THREE.MathUtils.damp(orbit.target.z, goal.target.z, rate, delta)
    orbit.update()
    if (camera.position.distanceTo(goal.position) < 0.01 && orbit.target.distanceTo(goal.target) < 0.01) {
      gliding.current = false
    }
  })

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
      // Close enough for the canopy shot; the home shot sits at about 22.
      minDistance={7}
      maxDistance={29}
      minPolarAngle={Math.PI * 0.22}
      maxPolarAngle={Math.PI * 0.49}
      // Grabbing the view mid-glide hands it straight back to you.
      onStart={() => {
        gliding.current = false
      }}
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
  /** Places with no stone yet, drawn as empty circles you can fill. */
  empty?: Place[]
  quality?: QualityPreset
  /** Off under `prefers-reduced-motion`, and off for a still capture. */
  animate?: boolean
  /** Bloom, vignette and grain. Toggleable so their cost can be measured rather than assumed. */
  post?: boolean
  onPerf?: (sample: PerfSample) => void
  onHoverStone?: (id: string | null) => void
  /** Increment to return the orbit camera to the supplied Grove composition. */
  viewResetKey?: number
  /**
   * True once the first real list of stones has arrived. Stones present at that moment were
   * already there and simply stand; any that appear afterwards arrived while you watched, and
   * those grow their roots and rise out of the ground.
   */
  ready?: boolean
}

const NONE_ARRIVING: ReadonlySet<string> = new Set()

export function GroveScene({
  stones = [],
  empty = [],
  quality = 'high',
  animate = true,
  post = true,
  onPerf,
  onHoverStone,
  viewResetKey = 0,
  ready = true,
}: GroveSceneProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const settings = QUALITY[quality]
  const view = useFlow((state) => state.view)
  const stoneId = useFlow((state) => state.stoneId)
  const focused = useFlow((state) => state.focused)
  const deployment = useFlow((state) => state.deployment)
  const selectStone = useFlow((state) => state.selectStone)
  const land = useFlow((state) => state.land)
  const shot = useMemo(
    () => shotFor(view, stones.find((stone) => stone.id === stoneId)),
    [view, stoneId, stones]
  )
  const tree = useTree()

  /* Which stones are new. `known` is only written after a render has been committed, so a
   * render React throws away (StrictMode does this on purpose) cannot mark a stone as seen
   * before it has actually been drawn rising. The stone itself latches the answer on mount. */
  const known = useRef<Set<string> | null>(null)
  const arriving = useMemo(() => {
    const seen = known.current
    if (!ready || !seen || !animate) return NONE_ARRIVING
    const fresh = stones.filter((stone) => !seen.has(stone.id)).map((stone) => stone.id)
    return fresh.length ? new Set(fresh) : NONE_ARRIVING
  }, [ready, stones, animate])
  useEffect(() => {
    if (!ready) return
    known.current ??= new Set()
    for (const stone of stones) known.current.add(stone.id)
  }, [ready, stones])
  const deployFrom = deployment ? tree.agents.find((agent) => agent.id === deployment.agentId)?.at : undefined
  const deployTo = deployment ? stones.find((stone) => stone.id === deployment.stoneId)?.at : undefined
  const activity = activityOf(stones)

  /* The whole below-ground system, grown once from where the stones stand. Roots and mycelium
   * come out of one generator so they cannot come apart at the trunk — see `network.ts`. */
  /* Keyed on where the stones stand, not on the stones themselves: a stone changing state (a
   * deployment lighting it, say) must not regrow every root in the grove. */
  /* Empty places get roots too, faint and owned by nobody that can light them, so the mycelium
   * already reaches the spot where your next stone will stand. */
  const targets = [
    ...stones.map((stone) => ({ id: stone.id, at: stone.at })),
    ...empty.map((place) => ({ id: `place-${place.index}`, at: place.at })),
  ]
  const layoutKey = targets.map((target) => `${target.id}@${target.at.join(',')}`).join('|')
  const network = useMemo(
    () => growNetwork(targets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey]
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
      // A click on open ground closes an empty circle's menu, as a click outside any menu should.
      onPointerMissed={() => {
        if (useFlow.getState().placeIndex !== null) useFlow.getState().back()
      }}
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
      <CameraRig shot={shot} resetKey={viewResetKey} animate={animate} />
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
      <Mycelium network={network} arriving={arriving} active={active} attention={attention} failed={failed} activity={activity} animate={animate} />
      {/* Scaled up a touch. Measured against the art the tree should fill rather more of the
          frame than a one-to-one build of the coordinates gives, because the art's camera is
          slightly closer than the ring ellipse alone implies. */}
      <group scale={1.12}>
        <ReferenceTree activity={activity} attention={attention.size > 0 || failed.size > 0} network={network} animate={animate} />
      </group>

      {stones.map((stone) => (
        <Runestone
          key={stone.id}
          spec={stone}
          cameraAt={cameraSpec.position}
          // On hover, and permanently for anything that wants you. The brief's default, and it
          // keeps the resting scene almost wordless.
          // While picking a target every name shows, because that moment is a choice between them.
          showLabel={
            hovered === stone.id ||
            focused === stone.id ||
            stoneId === stone.id ||
            view === 'picking' ||
            stone.status === 'waiting' ||
            stone.status === 'errored'
          }
          onHover={handleHover}
          onSelect={selectStone}
          rising={arriving.has(stone.id)}
          selected={stoneId === stone.id && view !== 'home'}
        />
      ))}

      {empty.map((place) => (
        <EmptyPlace key={place.index} place={place} />
      ))}

      {view === 'agents' ? <Canopy animate={animate} /> : null}
      {deployment?.phase === 'flight' && deployFrom && deployTo ? (
        <DeployWisp key={`${deployment.agentId}-${deployment.stoneId}`} from={deployFrom} to={deployTo} animate={animate} onArrive={land} />
      ) : null}

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
