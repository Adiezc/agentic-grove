/**
 * The interface for the concept art's flow: the stone panel (frame 2), the agent card (frame 3)
 * and the deploying toast (frame 4).
 *
 * Words are rationed as they are everywhere else in the HUD. Each panel has a name, at most one
 * line under it, and actions that are an icon plus a word or two. State is a coloured dot or a
 * glow, never a sentence.
 */
import { useEffect } from 'react'
import { ArrowSquareOut, CaretLeft, CaretRight, Check, Cube, Plus, User, X } from '@phosphor-icons/react'
import { HARNESS_MARK, kindOf, TREE_AGENTS } from '../agents/fixtures'
import type { StoneSpec } from '../scene/Runestone'
import { useFlow } from '../store/flow'

/** One line per fixture stone. Real stones will take theirs from the project's README or name. */
const STONE_LINES: Record<string, string> = {
  research: 'Find, analyse and synthesise.',
  data: 'Datasets and pipelines.',
  compute: 'Jobs and experiments.',
  connect: 'Integrations and APIs.',
  build: 'Ship the product.',
  archive: 'Finished work.',
}

const STATE_LABEL: Record<StoneSpec['status'], string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Needs you',
  errored: 'Failed',
}

/** Frame 2: the chosen stone, and the three things you can do with it. */
export function StonePanel({ stones, onAddTask }: { stones: StoneSpec[]; onAddTask: () => void }) {
  const view = useFlow((state) => state.view)
  const stoneId = useFlow((state) => state.stoneId)
  const openAgents = useFlow((state) => state.openAgents)
  const back = useFlow((state) => state.back)
  const stone = stones.find((candidate) => candidate.id === stoneId)
  const open = view === 'stone' && Boolean(stone)

  return (
    <aside className={`flow-panel stone-panel${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      {stone ? (
        <>
          <button type="button" className="panel-close" onClick={back} aria-label="Close">
            <X size={16} weight="thin" />
          </button>
          <header className="panel-head">
            <span className={`panel-sigil tone-${stone.status}`} aria-hidden="true" />
            <div>
              <h2 className="panel-title">{stone.name}</h2>
              <p className="panel-line">{stone.line ?? STONE_LINES[stone.id] ?? ''}</p>
              <p className={`panel-state tone-${stone.status}`}>
                <span className="state-dot" aria-hidden="true" />
                {STATE_LABEL[stone.status]}
              </p>
            </div>
          </header>
          <div className="panel-actions">
            <button type="button" className="panel-row" onClick={openAgents}>
              <User size={18} weight="thin" />
              <span>Agents</span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
            {/* Opening the folder needs the Electron bridge, which does not expose it yet. Shown
                disabled rather than hidden, so the panel already has its final shape. */}
            <button type="button" className="panel-row" disabled title="Coming soon">
              <Cube size={18} weight="thin" />
              <span>Open</span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
            <button type="button" className="panel-row" onClick={onAddTask}>
              <Plus size={18} weight="thin" />
              <span>Task</span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
          </div>
        </>
      ) : null}
    </aside>
  )
}

/** Frame 3: the agent the canopy is showing, and a way to send it. */
export function AgentCard({ stones }: { stones: StoneSpec[] }) {
  const view = useFlow((state) => state.view)
  const agentIndex = useFlow((state) => state.agentIndex)
  const stoneId = useFlow((state) => state.stoneId)
  const showAgent = useFlow((state) => state.showAgent)
  const deploy = useFlow((state) => state.deploy)
  const back = useFlow((state) => state.back)
  const open = view === 'agents'
  const agent = TREE_AGENTS[agentIndex] ?? TREE_AGENTS[0]!
  const target = stones.find((stone) => stone.id === stoneId)
  const { Glyph } = agent
  const { Mark, label } = HARNESS_MARK[agent.harness]
  const isBot = kindOf(agent) === 'bot'
  const count = TREE_AGENTS.length
  const step = (by: number) => showAgent((agentIndex + by + count) % count)

  return (
    <aside className={`flow-panel agent-card${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <button type="button" className="panel-close" onClick={back} aria-label="Close">
        <X size={16} weight="thin" />
      </button>
      <header className="panel-head">
        <span className={`agent-face${isBot ? ' is-loose' : ''}`} aria-hidden="true">
          <Glyph size={24} weight="thin" />
        </span>
        <div>
          <h2 className="panel-title">{agent.name}</h2>
          <p className="panel-harness" title={label}>
            <Mark size={11} weight="bold" aria-hidden="true" />
            {label}
          </p>
          {/* A bot's state is not something the Grove can know, so it shows none. */}
          {agent.running !== null ? (
            <p className={`panel-state tone-${agent.running ? 'running' : 'idle'}`}>
              <span className="state-dot" aria-hidden="true" />
              {agent.running ? 'Running' : 'Idle'}
            </p>
          ) : null}
        </div>
      </header>
      <p className="panel-line agent-line">{agent.description}</p>

      {isBot ? (
        // Grok Bots have no API to drive. Linking out comes with the Electron bridge.
        <button type="button" className="panel-send" disabled title="Opens Grok (coming soon)">
          <span>Open in Grok</span>
          <ArrowSquareOut size={14} weight="thin" />
        </button>
      ) : (
        <button type="button" className="panel-send" onClick={() => deploy(agent.id)}>
          <span>{target ? `Send to ${target.name}` : 'Send to runestone'}</span>
          <CaretRight size={14} weight="thin" />
        </button>
      )}

      <nav className="agent-pager" aria-label="Agents">
        <button type="button" className="pager-step" onClick={() => step(-1)} aria-label="Previous agent">
          <CaretLeft size={14} weight="thin" />
        </button>
        <span className="pager-dots">
          {TREE_AGENTS.map((each, index) => (
            <span key={each.id} className={`pager-dot${index === agentIndex ? ' is-on' : ''}`} />
          ))}
        </span>
        <button type="button" className="pager-step" onClick={() => step(1)} aria-label="Next agent">
          <CaretRight size={14} weight="thin" />
        </button>
      </nav>
    </aside>
  )
}

/** Frame 4: the quiet confirmation at the bottom while an agent travels, then lands. */
export function DeployToast({ stones }: { stones: StoneSpec[] }) {
  const deployment = useFlow((state) => state.deployment)
  const finish = useFlow((state) => state.finish)
  const agent = TREE_AGENTS.find((each) => each.id === deployment?.agentId)
  const stone = stones.find((each) => each.id === deployment?.stoneId)
  const landed = deployment?.phase === 'landed'

  // Hold the landed state for a moment so the tick registers, then get out of the way.
  useEffect(() => {
    if (!landed) return
    const timer = window.setTimeout(finish, 2200)
    return () => window.clearTimeout(timer)
  }, [landed, finish])

  const open = Boolean(deployment && agent && stone)
  const Glyph = agent?.Glyph

  return (
    <div className={`deploy-toast${open ? ' is-open' : ''}`} role="status" aria-live="polite">
      {agent && stone && Glyph ? (
        <>
          <span className="agent-face is-small" aria-hidden="true">
            <Glyph size={18} weight="thin" />
          </span>
          <div className="toast-text">
            <p className="toast-title">{agent.name}</p>
            <p className="toast-line">{landed ? stone.name : `To ${stone.name}`}</p>
          </div>
          {landed ? (
            <Check size={18} weight="thin" className="toast-done" aria-label="Deployed" />
          ) : (
            <span className="toast-ring" aria-label="Deploying" />
          )}
        </>
      ) : null}
    </div>
  )
}

/** While picking a target: one word at the top, and every stone's name is showing in the scene. */
export function PickHint() {
  const view = useFlow((state) => state.view)
  const pendingAgentId = useFlow((state) => state.pendingAgentId)
  const back = useFlow((state) => state.back)
  const agent = TREE_AGENTS.find((each) => each.id === pendingAgentId)
  const open = view === 'picking' && Boolean(agent)
  return (
    <div className={`pick-hint${open ? ' is-open' : ''}`} role="status" aria-live="polite">
      {agent ? (
        <>
          <agent.Glyph size={16} weight="thin" aria-hidden="true" />
          <span>Choose a stone</span>
          <button type="button" className="pick-cancel" onClick={back} aria-label="Cancel">
            <X size={13} weight="thin" />
          </button>
        </>
      ) : null}
    </div>
  )
}
