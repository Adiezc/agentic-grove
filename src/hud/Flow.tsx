/**
 * The interface for the concept art's flow: the stone panel (frame 2), the agent card (frame 3)
 * and the deploying toast (frame 4).
 *
 * Words are rationed as they are everywhere else in the HUD. Each panel has a name, at most one
 * line under it, and actions that are an icon plus a word or two. State is a coloured dot or a
 * glow, never a sentence.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowClockwise, ArrowSquareOut, CaretLeft, CaretRight, Check, Eye, FolderOpen, GitBranch, GitFork, PencilSimple, Plus, Trash, User, Warning, X } from '@phosphor-icons/react'
import type { Run, RunState } from '../../core/spawn/runs.ts'
import type { TranscriptLine } from '../../core/spawn/transcript.ts'
import { useGrove } from '../store/grove'
import { isLinkOnly, LINK_HOME, MAX_BRIEF_CHARS, type AgentGlyph, type AgentHarness } from '../../core/state/schema.ts'
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

/** How each run state reads, and which of the grove's tones it borrows. Amber only for "needs you". */
export const RUN_LABEL: Record<RunState, { label: string; tone: StoneSpec['status'] }> = {
  starting: { label: 'Starting', tone: 'idle' },
  running: { label: 'Working', tone: 'running' },
  waiting: { label: 'Needs you', tone: 'waiting' },
  finished: { label: 'Finished', tone: 'idle' },
  ended: { label: 'Closed', tone: 'idle' },
  failed: { label: 'Failed', tone: 'errored' },
}

const NO_RUNS: Run[] = []
/** Every run the Grove started, newest first, from the latest snapshot. */
export const useRuns = () => useGrove((state) => state.snapshot?.runs ?? NO_RUNS)

/** A task cut to one line for a list. */
const oneLine = (text: string, length = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
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
  const canOpen = Boolean(window.grove) && !DEMO
  /** Give part of this project its own sub-stone: a suggested part, or one you pick in Finder. */
  const splitOff = async (suggested?: string) => {
    if (!stone || !window.grove) return
    const result = suggested ? await window.grove.connectSuggested(suggested) : await window.grove.browseSubProject(stone.id)
    setError(!result.ok && !result.cancelled ? (result.error ?? 'Could not split it') : null)
  }
  const openFolder = async () => {
    if (!stone) return
    const result = await window.grove?.openProjectFolder(stone.id)
    setError(result && !result.ok ? (result.error ?? 'Could not open it') : null)
  }
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
              {/* The branch only where it tells two stones apart: on a twin, and on the stone it stands by. */}
              {stone.branch && (stone.twin || stones.some((other) => other.twin && other.parent === stone.id)) ? (
                <p className="panel-branch">
                  <GitBranch size={12} weight="thin" aria-hidden="true" /> {stone.branch}
                </p>
              ) : null}
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
          <StoneRuns stoneId={stone.id} />
          {stone.splits?.length && canOpen ? (
            <div className="split-offer">
              <p>Work here has spread over {stone.splits.length} big parts. Give each its own stone?</p>
              <div className="split-choices">
                {stone.splits.map((split) => (
                  <button key={split.path} type="button" className="setting-button" onClick={() => void splitOff(split.path)}>
                    {split.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {confirming ? (
            <p className="panel-note">Press the bin again to take this stone off the grove. The folder and its sessions stay as they are.</p>
          ) : null}
          {error ? <p className="panel-error">{error}</p> : null}
          {/* Each action says what it does in a second line. The first version had one word each
              (Agents, Open, Task) and nobody could tell them apart without trying them. */}
          <div className="panel-actions">
            <button type="button" className="panel-row" onClick={openAgents}>
              <User size={18} weight="thin" />
              <span>
                Send an agent
                <small>Pick one from the tree to work here</small>
              </span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
            <button type="button" className="panel-row" onClick={openFolder} disabled={!canOpen}>
              <FolderOpen size={18} weight="thin" />
              <span>
                Open folder
                <small>See the project's files in Finder</small>
              </span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
            <button type="button" className="panel-row" onClick={onAddTask}>
              <Plus size={18} weight="thin" />
              <span>
                New task
                <small>Type a job for this project below</small>
              </span>
              <CaretRight size={13} weight="thin" className="row-caret" />
            </button>
          </div>
          {canOpen ? (
            <button type="button" className="panel-link" onClick={() => void splitOff()}>
              <GitFork size={13} weight="thin" aria-hidden="true" />
              Split off a part as its own stone
            </button>
          ) : null}
        </>
      ) : null}
    </aside>
  )
}

/**
 * The work the Grove started on this stone, newest first: who, what, and how it is going. Only
 * runs, never sessions it merely watched, so this list is exactly "what I sent here". Each opens
 * the run panel with its transcript.
 */
function StoneRuns({ stoneId }: { stoneId: string }) {
  const runs = useRuns()
  const openRun = useFlow((state) => state.openRun)
  const here = runs.filter((run) => run.stoneId === stoneId).slice(0, 4)
  if (!here.length) return null
  return (
    <ul className="panel-runs" aria-label="Sent here">
      {here.map((run) => {
        const { label, tone } = RUN_LABEL[run.state]
        return (
          <li key={run.id}>
            <button type="button" className="panel-run" onClick={() => openRun(run.id)} title={`${run.agentName}: ${label}`}>
              <span className={`state-dot tone-${tone}`} aria-hidden="true" />
              <span className="run-what">
                {run.agentName}
                <small>{run.task ? oneLine(run.task) : 'Opened with no task'}</small>
              </span>
              <span className="tell-when">{label === 'Working' ? label : ago(run.updatedAt, Date.now())}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * One run: what was asked, how it is going, and the last few things it said and did, read live
 * from its transcript every two seconds while the panel is open. Read-only; the conversation
 * itself is in Terminal, and "Resume in Terminal" is the way back into it.
 */
export function RunPanel({ stones }: { stones: StoneSpec[] }) {
  const view = useFlow((state) => state.view)
  const runId = useFlow((state) => state.runId)
  const back = useFlow((state) => state.back)
  const runs = useRuns()
  const { agents } = useTree()
  const run = runs.find((each) => each.id === runId)
  const open = view === 'run' && Boolean(run)
  const stone = stones.find((each) => each.id === run?.stoneId)
  const Glyph = agents.find((agent) => agent.id === run?.agentId)?.Glyph ?? User
  const [lines, setLines] = useState<TranscriptLine[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)

  useEffect(() => {
    setLines(null)
    setNote(null)
    setError(null)
    if (!open || !run || !window.grove) return
    let alive = true
    const read = async () => {
      const result = await window.grove!.readTranscript(run.id).catch(() => null)
      if (!alive || !result) return
      if (result.ok) setLines(result.lines ?? [])
      else setNote(result.error ?? null)
    }
    void read()
    const timer = window.setInterval(read, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [open, run?.id])

  // Follow the newest line, the way a terminal does.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [lines?.length])

  const resume = async () => {
    if (!run) return
    const result = await window.grove?.resumeRun(run.id)
    setError(result && !result.ok ? (result.error ?? 'Could not reopen it') : null)
  }

  const state = run ? RUN_LABEL[run.state] : null
  const canResume = run?.harness === 'claude-code' && (run.state === 'finished' || run.state === 'ended' || run.state === 'failed')

  return (
    <aside className={`flow-panel run-panel${open ? ' is-open' : ''}`} aria-hidden={!open} inert={!open}>
      {run && state ? (
        <>
          <button type="button" className="panel-close" onClick={back} aria-label="Back to the stone">
            <X size={16} weight="thin" />
          </button>
          <header className="panel-head">
            <span className="agent-face" aria-hidden="true">
              <Glyph size={22} weight="thin" />
            </span>
            <div>
              <h2 className="panel-title">{run.agentName}</h2>
              <p className="panel-line">{stone?.name ?? run.stoneId.split('/').pop()}</p>
              <p className={`panel-state tone-${state.tone}`}>
                <span className="state-dot" aria-hidden="true" />
                {state.label}
                <span className="tell-when"> · {ago(run.createdAt, Date.now())}</span>
              </p>
            </div>
          </header>
          {run.task ? <p className="run-task">{run.task}</p> : null}
          {run.error ? <p className="panel-error">{run.error}</p> : null}
          {note ? (
            <p className="panel-aside">{note}</p>
          ) : (
            <ol className="run-lines" ref={list} aria-label="Latest from the transcript" aria-live="polite">
              {lines?.length ? (
                lines.map((line, index) => (
                  <li key={index} className={`run-line is-${line.kind}`}>
                    {line.text}
                  </li>
                ))
              ) : (
                <li className="run-line is-empty">{lines ? 'Nothing written yet.' : 'Reading…'}</li>
              )}
            </ol>
          )}
          {error ? <p className="panel-error">{error}</p> : null}
          {/* Answer or wait: the Grove never answers for an agent. It says where the question is
              and takes you there; until you go, the run simply waits. */}
          {run.state === 'waiting' ? (
            <>
              <p className="panel-note run-waiting">Waiting for your answer in its Terminal window.</p>
              <button type="button" className="panel-send is-attention" onClick={() => void window.grove?.focusTerminal()}>
                <span>Answer in Terminal</span>
                <ArrowSquareOut size={14} weight="thin" />
              </button>
            </>
          ) : null}
          {canResume ? (
            <button type="button" className="panel-send" onClick={resume}>
              <span>Resume in Terminal</span>
              <ArrowClockwise size={14} weight="thin" />
            </button>
          ) : null}
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
  const { Mark, label, opens } = HARNESS_MARK[agent.harness]
  const isBot = kindOf(agent) === 'bot'
  const count = agents.length
  const step = (by: number) => showAgent(agents[(index + by + count) % count]!.id)
  const [error, setError] = useState<string | null>(null)
  // Removing asks twice: the first press turns the bin amber, the second takes the agent away.
  const [confirming, setConfirming] = useState(false)
  // The task travels with the agent. Kept while you page between agents, so trying Researcher
  // and then Builder for the same job does not mean typing it twice; cleared when the card closes.
  const [task, setTask] = useState('')
  useEffect(() => {
    setConfirming(false)
    setError(null)
  }, [agent.id, open])
  useEffect(() => {
    if (!open) setTask('')
  }, [open])
  const send = () => deploy(agent.id, task)
  // Enter sends, as in the console; Shift+Enter is a new line for a longer task.
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

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
          className="panel-remove panel-edit"
          onClick={() => useFlow.getState().edit(agent.id)}
          aria-label={`Change ${agent.name}`}
          title="Change"
        >
          <PencilSimple size={15} weight="thin" />
        </button>
      ) : null}
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
      {agent.at === null ? <p className="panel-aside">Every branch is taken, so this agent has no orb. It works the same.</p> : null}

      {isBot ? (
        // Dots and Cowork have no API to drive, so the one thing the Grove can do is open them.
        <button type="button" className="panel-send" disabled={!canWrite} onClick={openLink}>
          <span>Open in {opens}</span>
          <ArrowSquareOut size={14} weight="thin" />
        </button>
      ) : (
        <>
          <label className="grow-field task-field">
            <span>Task</span>
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={onKey}
              rows={3}
              maxLength={20_000}
              placeholder={`What should ${agent.name} do?`}
            />
          </label>
          <button type="button" className="panel-send" onClick={send}>
            <span>{target ? `Send to ${target.name}` : 'Send to runestone'}</span>
            <CaretRight size={14} weight="thin" />
          </button>
        </>
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

/**
 * The tools an agent can belong to, in the order the form offers them: the two that work in your
 * folders, then the two everyday coworkers that live in their own apps. Grok Bot is not offered any
 * more, though an older `grove.json` that has one still loads.
 */
const KINDS: AgentHarness[] = ['claude-code', 'codex', 'claude-cowork', 'chatgpt-dot']

/**
 * Growing an agent: opened from the bud, in the agent card's place.
 *
 * Four fields, and only the name is required. The tool decides everything else about how the
 * Grove treats the agent: Claude Code and Codex hang from the branches and can be sent to a stone;
 * a ChatGPT Dot or Claude Cowork drifts loose and can only be opened. The one line under the
 * choices says which, so nobody grows a firefly expecting it to take orders.
 */
export function GrowCard() {
  const view = useFlow((state) => state.view)
  const growing = useFlow((state) => state.growing)
  const grown = useFlow((state) => state.grown)
  const back = useFlow((state) => state.back)
  const editingId = useFlow((state) => state.editingId)
  const { counts } = useTree()
  const open = view === 'agents' && growing

  const [harness, setHarness] = useState<AgentHarness>('claude-code')
  const [name, setName] = useState('')
  const [line, setLine] = useState('')
  const [glyph, setGlyph] = useState<AgentGlyph>('spark')
  const [link, setLink] = useState('')
  const [brief, setBrief] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A fresh form each time it opens, so a half-typed agent from last time does not reappear. Opened
  // on one of your agents, it starts from that agent as `grove.json` has it.
  useEffect(() => {
    if (!open) return
    const editing = editingId ? useGrove.getState().snapshot?.agents.find((agent) => agent.id === editingId) : undefined
    setHarness(editing?.harness ?? 'claude-code')
    setName(editing?.name ?? '')
    setLine(editing?.description ?? '')
    setGlyph(editing?.glyph ?? 'spark')
    setLink(editing?.link ?? '')
    setBrief(editing?.systemPrompt ?? '')
    setModel(editing?.model ?? '')
    setError(null)
  }, [open, editingId])

  const isBot = isLinkOnly(harness)
  // Changing an agent takes no new place on the tree.
  const full = editingId ? false : isBot ? counts.bot >= ROOM.bot : counts.grove >= ROOM.grove

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!window.grove || busy || full) return
    setBusy(true)
    setError(null)
    const draft = {
      harness,
      name,
      description: line,
      glyph,
      link: isBot && link.trim() ? link.trim() : undefined,
      brief: isBot ? undefined : brief,
      model: isBot ? undefined : model,
    }
    const result = await (editingId ? window.grove.updateAgent(editingId, draft) : window.grove.addAgent(draft))
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
            <h2 className="panel-title">{editingId ? 'Change agent' : 'New agent'}</h2>
            <p className="panel-harness">
              {isBot ? `Everyday work. Opens in ${HARNESS_MARK[harness].opens}` : 'Works in your project folders'}
            </p>
          </div>
        </header>

        {/* An agent's tool is fixed once it has grown: a different tool is a different agent. */}
        {editingId ? null : (
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
        )}

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
              placeholder={LINK_HOME[harness]}
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            <label className="grow-field">
              <span>Brief (optional)</span>
              <textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                maxLength={MAX_BRIEF_CHARS}
                rows={3}
                placeholder="How it should work. Sent ahead of every job you give it."
              />
            </label>
            <label className="grow-field">
              <span>Model (optional)</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={80}
                placeholder={`${HARNESS_MARK[harness].label}'s own choice`}
                spellCheck={false}
              />
            </label>
          </>
        )}

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
          <span>{full ? 'No room on the tree' : editingId ? 'Save' : 'Grow'}</span>
          {editingId ? <Check size={14} weight="thin" /> : <Plus size={14} weight="thin" />}
        </button>
        {error ? <p className="panel-error">{error}</p> : null}
      </form>
    </aside>
  )
}

/**
 * Frame 4: the quiet confirmation at the bottom while an agent travels, then lands.
 *
 * The tick means the tool has confirmed a session exists (a hook or the scan saw it), never
 * merely that a window was asked to open. Until then the ring keeps turning; if Claude Code is
 * waiting on a question in Terminal first (trusting a new folder, say), the line says where to
 * look. A failure stays until you dismiss it, and offers the one-button setup when the reason is
 * a missing tool.
 */
export function DeployToast({ stones }: { stones: StoneSpec[] }) {
  const deployment = useFlow((state) => state.deployment)
  const finish = useFlow((state) => state.finish)
  const runs = useRuns()
  const { agents } = useTree()
  const agent = agents.find((each) => each.id === deployment?.agentId)
  const stone = stones.find((each) => each.id === deployment?.stoneId)
  const landed = deployment?.phase === 'landed'
  const run = runs.find((each) => each.id === deployment?.runId)
  const error = deployment?.error ?? (run?.state === 'failed' ? (run.error ?? 'It did not start') : null)
  // Demo mode and a plain browser tab have no runs, so there the landing itself is the answer.
  const confirmed = DEMO || !window.grove ? landed : Boolean(run && run.state !== 'starting' && run.state !== 'failed')
  const [slow, setSlow] = useState(false)

  // Hold the confirmed state for a moment so the tick registers, then get out of the way.
  useEffect(() => {
    if (!landed || !confirmed || error) return
    const timer = window.setTimeout(finish, 2200)
    return () => window.clearTimeout(timer)
  }, [landed, confirmed, error, finish])

  // Past a few seconds without a session, Terminal is most likely asking something first.
  useEffect(() => {
    setSlow(false)
    if (!landed || confirmed || error) return
    const timer = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(timer)
  }, [landed, confirmed, error])

  const open = Boolean(deployment && agent && stone)
  const Glyph = agent?.Glyph
  const setUp = () => {
    if (deployment?.missing) void window.grove?.setUpTool(deployment.missing)
    finish()
  }

  let line = stone ? `To ${stone.name}` : ''
  if (error) line = error
  else if (confirmed && stone) line = stone.name
  else if (landed) line = slow ? 'Waiting in Terminal. Answer it there if it asks.' : 'Starting in Terminal'

  return (
    <div className={`deploy-toast${open ? ' is-open' : ''}${error ? ' is-failed' : ''}`} role="status" aria-live="polite">
      {agent && stone && Glyph ? (
        <>
          <span className="agent-face is-small" aria-hidden="true">
            <Glyph size={18} weight="thin" />
          </span>
          <div className="toast-text">
            <p className="toast-title">{agent.name}</p>
            <p className="toast-line">{line}</p>
          </div>
          {error ? (
            <>
              {deployment?.missing ? (
                <button type="button" className="setting-button" onClick={setUp}>
                  Set up
                </button>
              ) : (
                <Warning size={18} weight="thin" className="toast-failed" aria-hidden="true" />
              )}
            </>
          ) : confirmed ? (
            <Check size={18} weight="thin" className="toast-done" aria-label="Started" />
          ) : (
            <span className="toast-ring" aria-label="Starting" />
          )}
          {error || slow ? (
            <button type="button" className="toast-close" onClick={finish} aria-label="Dismiss">
              <X size={13} weight="thin" />
            </button>
          ) : null}
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
