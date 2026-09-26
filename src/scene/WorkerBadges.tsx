/**
 * The small orbs floating over a working stone: who is working there.
 *
 * The grove has one heartbeat, deliberately; separate pulses per project would turn the floor
 * into a light show. So when two agents are busy on two projects, the pulse cannot say which is
 * which, and these do instead: each busy stone carries the face of what is working on it. A tree
 * agent shows its own glyph; work you started yourself shows the tool's mark.
 *
 * DOM through drei's `<Html>`, like the canopy orbs, and only on stones with someone working, so
 * a quiet grove has none of them.
 */
import { Html } from '@react-three/drei'
import { Robot } from '@phosphor-icons/react'
import { HARNESS_MARK, TREE_AGENTS, type Harness } from '../agents/fixtures'

function faceFor(worker: string) {
  const agent = TREE_AGENTS.find((each) => each.id === worker)
  if (agent) return { Glyph: agent.Glyph, label: agent.name }
  const harness = HARNESS_MARK[worker as Harness]
  // An installed tool the Grove has no mark for yet, such as Cursor: a generic agent, not a guess.
  return harness ? { Glyph: harness.Mark, label: harness.label } : { Glyph: Robot, label: worker }
}

export function WorkerBadges({ workers, height, alert }: { workers: string[]; height: number; alert: boolean }) {
  return (
    <Html position={[0, height + 0.42, 0]} center zIndexRange={[12, 5]} style={{ pointerEvents: 'none' }}>
      <div className="workers" aria-label={`Working here: ${workers.map((w) => faceFor(w).label).join(', ')}`}>
        {workers.slice(0, 3).map((worker) => {
          const { Glyph } = faceFor(worker)
          return (
            <span key={worker} className={`worker${alert ? ' is-alert' : ''}`}>
              <Glyph size={14} weight="light" />
            </span>
          )
        })}
      </div>
    </Html>
  )
}
