/**
 * The interface for the concept art's flow: the stone panel (frame 2), the agent card (frame 3)
 * and the deploying toast (frame 4).
 *
 * Words are rationed as they are everywhere else in the HUD. Each panel has a name, at most one
 * line under it, and actions that are an icon plus a word or two. State is a coloured dot or a
 * glow, never a sentence.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowSquareOut, CaretLeft, CaretRight, Check, Cube, Eye, Plus, Trash, User, X } from '@phosphor-icons/react'
import type { AgentGlyph, AgentHarness } from '../../core/state/schema.ts'
import { GLYPH_CHOICES, GLYPHS } from '../agents/glyphs'
import { HARNESS_MARK, kindOf, ROOM, useTree } from '../agents/tree'
import type { StoneSpec } from '../scene/Runestone'
import { ago } from '../../core/usage/format.ts'
import { useFlow } from '../store/flow'
import { DEMO } from '../demo'

/** One line per fixture stone. Real stones will take theirs from the project's README or name. */
const STONE_LINES: Record<string, string> = {
  research: 'Find, analyse and synthesise.',
  data: 'Datasets and pipelines.',
  compute: 'Jobs and experiments.',
  connect: 'Integrations and APIs.',
  build: 'Ship the product.',
  archive: 'Finished work.',
}

export const STATE_LABEL: Record<StoneSpec['status'], string> = {
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
  // Removing asks twice, like removing an agent: the first press turns the bin amber and says
  // what will happen, the second takes the stone off the grove.
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setConfirming(false)
    setError(null)
  }, [stoneId, open])
  // Demo stones are pretend, and a plain browser tab has no bridge to write with.
  const canRemove = Boolean(window.grove) && !DEMO
  const remove = async () => {
    if (!stone) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    const result = await window.grove?.removeProject(stone.id)
    if (result?.ok) back()
    else setError(result?.error ?? 'Could not remove it')
  }

  return (
    <aside className={`flow-panel stone-panel${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      {stone ? (
        <>
          <button type="button" className="panel-close" onClick={back} aria-label="Close">
            <X size={16} weight="thin" />
          </button>
          {canRemove ? (
            <button
              type="button"
              className={`panel-remove${confirming ? ' is-confirming' : ''}`}
              onClick={remove}
              onBlur={() => setConfirming(false)}
              aria-label={confirming ? `Remove ${stone.name} from the grove: press again to confirm` : `Remove ${stone.name} from the grove`}
              title={confirming ? 'Press again to remove' : 'Remove from the grove'}
            >
              <Trash size={15} weight="thin" />
            </button>
          ) : null}
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
          {/* Tells: quiet flags with their reasons, so they can be judged rather than trusted.
              Grey, not amber: amber means something needs you, and a tell only might. */}
          {stone.tells?.length ? (
            <ul className="panel-tells" aria-label="Worth checking">
              {stone.tells.map((tell) => (
                <li key={`${tell.kind}-${tell.at}`} className="panel-tell">
                  <Eye size={13} weight="thin" aria-hidden="true" />
                  <span>{tell.detail}</span>
                  <span className="tell-when">{ago(tell.at, Date.now())}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {confirming ? (
            <p className="panel-note">Press the bin again to take this stone off the grove. The folder and its sessions stay as they are.</p>
          ) : null}
          {error ? <p className="panel-error">{error}</p> : null}
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
  const agentId = useFlow((state) => state.agentId)
  const growing = useFlow((state) => state.growing)
  const stoneId = useFlow((state) => state.stoneId)
  const showAgent = useFlow((state) => state.showAgent)
  const deploy = useFlow((state) => state.deploy)
  const back = useFlow((state) => state.back)
  const { agents } = useTree()
  const open = view === 'agents' && !growing
  // Falls back to Researcher when the shown agent has just been removed.
  const index = Math.max(0, agents.findIndex((each) => each.id === agentId))
  const agent = agents[index]!
  const target = stones.find((stone) => stone.id === stoneId)
  const { Glyph } = agent
  const { Mark, label } = HARNESS_MARK[agent.harness]
  const isBot = kindOf(agent) === 'bot'
  const count = agents.length
  const step = (by: number) => showAgent(agents[(index + by + count) % count]!.id)
  const [error, setError] = useState<string | null>(null)
  // Removing asks twice: the first press turns the bin amber, the second takes the agent away.
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    setConfirming(false)
    setError(null)
  }, [agent.id, open])

  const openLink = async () => {
    const result = await window.grove?.openAgentLink(agent.id)
    setError(result && !result.ok ? (result.error ?? 'Could not open it') : null)
  }
  const remove = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    const result = await window.grove?.removeAgent(agent.id)
    if (result?.ok) showAgent('researcher')
    else setError(result?.error ?? 'Could not remove it')
  }
  const canWrite = Boolean(window.grove)

  return (
    <aside className={`flow-panel agent-card${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <button type="button" className="panel-close" onClick={back} aria-label="Close">
        <X size={16} weight="thin" />
      </button>
      {agent.own && canWrite ? (
        <button
          type="button"
          className={`panel-remove${confirming ? ' is-confirming' : ''}`}
          onClick={remove}
          onBlur={() => setConfirming(false)}
          aria-label={confirming ? `Remove ${agent.name}: press again to confirm` : `Remove ${agent.name}`}
          title={confirming ? 'Press again to remove' : 'Remove'}
        >
          <Trash size={15} weight="thin" />
        </button>
      ) : null}
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
        // Grok Bots have no API to drive, so the one thing the Grove can do is open them.
        <button type="button" className="panel-send" disabled={!canWrite} onClick={openLink}>
          <span>Open in Grok</span>
          <ArrowSquareOut size={14} weight="thin" />
        </button>
      ) : (
        <button type="button" className="panel-send" onClick={() => deploy(agent.id)}>
          <span>{target ? `Send to ${target.name}` : 'Send to runestone'}</span>
          <CaretRight size={14} weight="thin" />
        </button>
      )}

      {error ? <p className="panel-error">{error}</p> : null}

      <nav className="agent-pager" aria-label="Agents">
        <button type="button" className="pager-step" onClick={() => step(-1)} aria-label="Previous agent">
          <CaretLeft size={14} weight="thin" />
        </button>
        <span className="pager-dots">
          {agents.map((each) => (
            <span key={each.id} className={`pager-dot${each.id === agent.id ? ' is-on' : ''}`} />
          ))}
        </span>
        <button type="button" className="pager-step" onClick={() => step(1)} aria-label="Next agent">
          <CaretRight size={14} weight="thin" />
        </button>
      </nav>
    </aside>
  )
}

/** The three tools an agent can belong to, in the order the form offers them. */
const KINDS: AgentHarness[] = ['claude-code', 'codex', 'grok-bot']

/**
 * Growing an agent: opened from the bud, in the agent card's place.
 *
 * Four fields, and only the name is required. The tool decides everything else about how the
 * Grove treats the agent: Claude Code and Codex hang from the branches and can be sent to a stone;
 * a Grok Bot drifts loose and can only be opened. The one line under the choices says which, so
 * nobody grows a firefly expecting it to take orders.
 */
export function GrowCard() {
  const view = useFlow((state) => state.view)
  const growing = useFlow((state) => state.growing)
  const grown = useFlow((state) => state.grown)
  const back = useFlow((state) => state.back)
  const { counts } = useTree()
  const open = view === 'agents' && growing

  const [harness, setHarness] = useState<AgentHarness>('claude-code')
  const [name, setName] = useState('')
  const [line, setLine] = useState('')
  const [glyph, setGlyph] = useState<AgentGlyph>('spark')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A fresh form each time it opens, so a half-typed agent from last time does not reappear.
  useEffect(() => {
    if (!open) return
    setHarness('claude-code')
    setName('')
    setLine('')
    setGlyph('spark')
    setLink('')
    setError(null)
  }, [open])

  const isBot = harness === 'grok-bot'
  const full = isBot ? counts.bot >= ROOM.bot : counts.grove >= ROOM.grove

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!window.grove || busy || full) return
    setBusy(true)
    setError(null)
    const result = await window.grove
      .addAgent({ harness, name, description: line, glyph, link: isBot && link.trim() ? link.trim() : undefined })
      .catch((reason: unknown) => ({ ok: false, error: String(reason), id: undefined }))
    setBusy(false)
    if (result.ok) grown(result.id)
    else setError(result.error ?? 'That did not work')
  }

  const Face = GLYPHS[glyph].Icon

  return (
    <aside className={`flow-panel agent-card grow-card${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      <button type="button" className="panel-close" onClick={back} aria-label="Close">
        <X size={16} weight="thin" />
      </button>
      <form onSubmit={submit}>
        <header className="panel-head">
          <span className={`agent-face${isBot ? ' is-loose' : ''}`} aria-hidden="true">
            <Face size={24} weight="thin" />
          </span>
          <div>
            <h2 className="panel-title">New agent</h2>
            <p className="panel-harness">{isBot ? 'Opens in Grok' : 'Can be sent to a stone'}</p>
          </div>
        </header>

        <div className="grow-kinds" role="radiogroup" aria-label="Tool">
          {KINDS.map((kind) => {
            const { Mark, label } = HARNESS_MARK[kind]
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={harness === kind}
                className={`grow-kind${harness === kind ? ' is-on' : ''}`}
                onClick={() => setHarness(kind)}
              >
                <Mark size={14} weight="bold" aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>

        <label className="grow-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} spellCheck={false} required />
        </label>
        <label className="grow-field">
          <span>What it does</span>
          <input value={line} onChange={(event) => setLine(event.target.value)} maxLength={120} placeholder="One line" />
        </label>
        {isBot ? (
          <label className="grow-field">
            <span>Link</span>
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              type="url"
              placeholder="https://grok.com"
              spellCheck={false}
            />
          </label>
        ) : null}

        <div className="grow-glyphs" role="radiogroup" aria-label="Face">
          {GLYPH_CHOICES.map((choice) => {
            const { Icon, label } = GLYPHS[choice]
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={glyph === choice}
                aria-label={label}
                title={label}
                className={`grow-glyph${glyph === choice ? ' is-on' : ''}`}
                onClick={() => setGlyph(choice)}
              >
                <Icon size={17} weight="thin" />
              </button>
            )
          })}
        </div>

        <button type="submit" className="panel-send" disabled={!window.grove || busy || full || !name.trim()}>
          <span>{full ? 'No room on the tree' : 'Grow'}</span>
          <Plus size={14} weight="thin" />
        </button>
        {error ? <p className="panel-error">{error}</p> : null}
      </form>
    </aside>
  )
}

/** Frame 4: the quiet confirmation at the bottom while an agent travels, then lands. */
export function DeployToast({ stones }: { stones: StoneSpec[] }) {
  const deployment = useFlow((state) => state.deployment)
  const finish = useFlow((state) => state.finish)
  const { agents } = useTree()
  const agent = agents.find((each) => each.id === deployment?.agentId)
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
  const { agents } = useTree()
  const agent = agents.find((each) => each.id === pendingAgentId)
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
