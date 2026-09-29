/**
 * The agents in the tree (frame 3), and the light that carries one to a stone (frame 4).
 *
 * **Why the orbs are DOM, when the stone labels deliberately are not.** `Runestone.tsx` explains
 * why labels are sprites: twenty-five stones would mean twenty-five DOM nodes repositioned every
 * frame. The orbs are the opposite case. There are a handful, they exist only while the canopy is
 * open, and they are *buttons*: they need focus, a keyboard, a screen-reader name and crisp icons
 * from the same Phosphor set as the rest of the interface. drei's `<Html>` gives all of that for
 * the price of four or five elements.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { Plus } from '@phosphor-icons/react'
import * as THREE from 'three'
import { HARNESS_MARK, kindOf, useTree, type TreeAgent } from '../agents/tree'
import { DEMO } from '../demo'
import { useFlow } from '../store/flow'
import { palette } from '../theme/palette'

/** How far below an orb its thread meets the wood. */
const THREAD = 0.55

export function Canopy({ animate }: { animate: boolean }) {
  const agentId = useFlow((state) => state.agentId)
  const growing = useFlow((state) => state.growing)
  const showAgent = useFlow((state) => state.showAgent)
  const { agents, bud } = useTree()

  return (
    <group>
      {agents.map((agent, index) =>
        kindOf(agent) === 'grove' ? (
          <HangingOrb
            key={agent.id}
            agent={agent}
            selected={!growing && agent.id === agentId}
            onSelect={() => showAgent(agent.id)}
          />
        ) : (
          <Firefly
            key={agent.id}
            agent={agent}
            seed={index}
            animate={animate}
            selected={!growing && agent.id === agentId}
            onSelect={() => showAgent(agent.id)}
          />
        )
      )}
      <Bud at={bud} open={growing} />
    </group>
  )
}

/** A grove agent: tied to the branch below it by a thread of light. */
function HangingOrb({ agent, selected, onSelect }: { agent: TreeAgent; selected: boolean; onSelect: () => void }) {
  const [x, y, z] = agent.at
  return (
    <group>
      <Line
        points={[
          [x, y, z],
          [x + 0.08, y - THREAD, z - 0.05],
        ]}
        color={palette.energy}
        lineWidth={1.6}
        transparent
        opacity={selected ? 0.95 : 0.6}
      />
      {/* The orb lights the leaves around it, as in the art. A DOM glow alone stops at the ring
          and the canopy behind stays dark, which reads as a sticker rather than a lantern. */}
      <pointLight position={agent.at} color={palette.energy} intensity={selected ? 3.2 : 2} distance={1.9} decay={2} />
      <Html position={agent.at} center zIndexRange={[20, 10]}>
        <Orb agent={agent} selected={selected} onSelect={onSelect} />
      </Html>
    </group>
  )
}

/**
 * A firefly (a ChatGPT Dot or Claude Cowork): loose in the air, tied to nothing.
 *
 * The drift is slow and small on purpose. It only has to read as "not attached" at a glance; a
 * firefly that actually wanders makes a button you have to chase.
 */
function Firefly({
  agent,
  seed,
  animate,
  selected,
  onSelect,
}: {
  agent: TreeAgent
  seed: number
  animate: boolean
  selected: boolean
  onSelect: () => void
}) {
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!group.current || !animate) return
    const t = state.clock.elapsedTime * 0.35 + seed * 2.1
    group.current.position.set(Math.sin(t) * 0.12, Math.sin(t * 1.7) * 0.09, Math.cos(t * 0.8) * 0.1)
  })
  return (
    <group ref={group}>
      <Html position={agent.at} center zIndexRange={[20, 10]}>
        <Orb agent={agent} selected={selected} onSelect={onSelect} loose />
      </Html>
    </group>
  )
}

function Orb({
  agent,
  selected,
  onSelect,
  loose = false,
}: {
  agent: TreeAgent
  selected: boolean
  onSelect: () => void
  loose?: boolean
}) {
  const { Glyph } = agent
  const { Mark, label } = HARNESS_MARK[agent.harness]
  return (
    <button
      type="button"
      className={`orb${loose ? ' is-loose' : ''}${selected ? ' is-selected' : ''}${agent.running ? ' is-running' : ''}`}
      onClick={onSelect}
      aria-label={`${agent.name}, ${label}`}
      aria-pressed={selected}
      title={agent.name}
    >
      <Glyph size={loose ? 24 : 36} weight="light" />
      <span className="orb-mark" aria-hidden="true">
        <Mark size={loose ? 9 : 11} weight="bold" />
      </span>
    </button>
  )
}

/**
 * Where a new agent will grow. Clicking it opens the grow form in place of the agent card.
 *
 * It moves to the next free branch as agents are added, so it always shows where the next one
 * will hang. Disabled in a plain browser tab, where there is no `grove.json` to write to, except
 * in demo mode, where the form opens so it can be judged but its Grow button stays off.
 */
function Bud({ at, open }: { at: [number, number, number]; open: boolean }) {
  const grow = useFlow((state) => state.grow)
  const canWrite = typeof window !== 'undefined' && Boolean(window.grove)
  const [x, y, z] = at
  const label = canWrite || DEMO ? 'New agent' : 'New agent (needs the app)'
  return (
    <group>
      <Line
        points={[
          [x, y, z],
          [x - 0.06, y - THREAD * 0.8, z - 0.05],
        ]}
        color={open ? palette.energy : palette.vein}
        lineWidth={1}
        transparent
        opacity={open ? 0.8 : 0.35}
      />
      <Html position={at} center zIndexRange={[20, 10]}>
        <button
          type="button"
          className={`orb is-bud${open ? ' is-selected' : ''}`}
          disabled={!canWrite && !DEMO}
          onClick={grow}
          aria-label={label}
          aria-pressed={open}
          title={label}
        >
          <Plus size={18} weight="thin" />
        </button>
      </Html>
    </group>
  )
}

/**
 * The light that carries an agent to a stone.
 *
 * It leaves the agent's place in the canopy, drops to the trunk's foot and runs out along the
 * ground to the stone, which is the path the mycelium draws. Taking the roots rather than flying
 * straight there is the point: the brief says the network is roots, not wires, and a spark that
 * crossed open air would make the roots decoration.
 */
export function DeployWisp({
  from,
  to,
  animate,
  onArrive,
}: {
  from: [number, number, number]
  to: [number, number]
  animate: boolean
  onArrive: () => void
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const progress = useRef(0)
  const arrived = useRef(false)

  const path = useMemo(() => {
    const start = new THREE.Vector3(...from)
    const trunk = new THREE.Vector3(0.1, 0.35, 0.25)
    const end = new THREE.Vector3(to[0], 0.45, to[1])
    const bend = trunk.clone().lerp(end, 0.5).setY(0.12)
    return new THREE.CatmullRomCurve3([start, new THREE.Vector3(0, 2.4, 0.4), trunk, bend, end], false, 'centripetal')
  }, [from, to])

  useFrame((_, delta) => {
    if (arrived.current) return
    // Two and a half seconds end to end: long enough to follow with the eye from the side of a
    // screen, short enough that it never feels like waiting.
    progress.current = animate ? Math.min(progress.current + delta / 2.5, 1) : 1
    const eased = 1 - (1 - progress.current) ** 2
    const at = path.getPointAt(eased)
    mesh.current?.position.copy(at)
    light.current?.position.copy(at)
    if (progress.current >= 1) {
      arrived.current = true
      onArrive()
    }
  })

  return (
    <group>
      <mesh ref={mesh}>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshBasicMaterial color={palette.energy} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color={palette.energy} intensity={2.2} distance={2.4} decay={2} />
    </group>
  )
}
