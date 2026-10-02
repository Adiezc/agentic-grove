/**
 * The interface layer over the grove: rail, harness row, crystal, counts, console.
 *
 * Every position here is measured off `assets/concept/grove-main.png` and expressed as a
 * percentage of the viewport, so the composition holds at any window size rather than only at the
 * art's aspect ratio. The measurements are noted in comments beside each one, because the next
 * person to nudge one of these should know whether they are correcting the art or departing
 * from it.
 *
 * Two rules carried over from the palette work, and they are what keeps this quiet:
 *   - **Text is grey, never green.** Green means a thing is alive. A label is not alive.
 *   - **Eleven words.** That is how many the concept art contains. Every addition here has to
 *     justify itself against that, which is principle three of the project.
 *
 * Icons come from Phosphor. The runes on the stones are brand marks and are drawn in
 * `scene/runes.ts`; nothing in the interface hand-rolls an SVG path.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowRight, BookOpen, Cube, File, Gear, PlusCircle, Pulse, Record, Tree, User, X } from '@phosphor-icons/react'
import { readCommand, type ConsoleStone } from '../../core/console.ts'
import { answerHistory, readQuestion } from '../../core/history.ts'
import { useAnswer } from '../store/answer'
import { AnswerCard } from './Answer'
import { healthOf } from '../../core/health.ts'
import { useGrove } from '../store/grove'
import { HARNESS_MARK, kindOf, useTree } from '../agents/tree'
import { headroomFrom, route } from '../../core/routing.ts'
import { useFlow } from '../store/flow'

/** Every icon at one weight. Phosphor's `thin` is what matches the art's hairline rail. */
const ICON = { size: 17, weight: 'thin' } as const

export type RailPanel = 'projects' | 'runes' | 'settings' | null

/**
 * The left rail: six places, top to bottom in the order you reach for them.
 *
 *   Grove        back to the home view
 *   Projects     every stone as a list, with sub-stones and split suggestions
 *   Agents       the tree's agents, close up
 *   Saved tasks  the runes carved on every stone
 *   Activity     the raw session list underneath the scene, for checking it tells the truth
 *   Settings
 *
 * In the concept art these were undifferentiated glyphs. Each one now does something, and its name
 * shows beside it on hover, because an icon rail nobody can read is decoration.
 */
export function Rail({
  panel,
  onPanel,
  onToggleData,
  dataOpen,
  onHome,
  onAgents,
  inAgents,
}: {
  panel: RailPanel
  onPanel: (panel: RailPanel) => void
  onToggleData: () => void
  dataOpen: boolean
  onHome: () => void
  onAgents: () => void
  inAgents: boolean
}) {
  const toggle = (which: Exclude<RailPanel, null>) => () => onPanel(panel === which ? null : which)
  const items = [
    { key: 'grove', Icon: Record, label: 'Grove', action: onHome, on: !inAgents && !dataOpen && !panel },
    { key: 'projects', Icon: Cube, label: 'Projects', action: toggle('projects'), on: panel === 'projects' },
    { key: 'agents', Icon: User, label: 'Agents', action: onAgents, on: inAgents },
    { key: 'runes', Icon: BookOpen, label: 'Saved tasks', action: toggle('runes'), on: panel === 'runes' },
    { key: 'activity', Icon: Pulse, label: 'Activity', action: onToggleData, on: dataOpen },
    { key: 'settings', Icon: Gear, label: 'Settings', action: toggle('settings'), on: panel === 'settings' },
  ]

  return (
    <nav className="rail" aria-label="Grove sections">
      {/* The hairline and dot hanging from the top of the frame, as in the art. Decorative, and
          the only purely decorative element kept from it. */}
      <span className="rail-thread" aria-hidden="true" />
      {items.map(({ key, Icon, label, action, on }) => (
        <button
          key={key}
          type="button"
          className={`rail-item${on ? ' is-on' : ''}`}
          onClick={action}
          aria-label={label}
          aria-pressed={Boolean(on)}
        >
          <Icon size={ICON.size} weight={ICON.weight} />
          <span className="rail-label" aria-hidden="true">
            {label}
          </span>
        </button>
      ))}
    </nav>
  )
}

/**
 * The counts, bottom left. Three lines, two words each, exactly as in the art.
 *
 * The dots are the one place the project allows a decorative-looking status dot, and they are not
 * decorative: each is the colour of the thing it counts, which is how you read the grove's state
 * without reading the words at all.
 */
export function Counts({ agents, running, tasks }: { agents: number; running: number; tasks: number }) {
  const rows = [
    { key: 'agents', value: agents, label: agents === 1 ? 'agent' : 'agents', tone: 'idle' },
    { key: 'running', value: running, label: 'running', tone: 'live' },
    { key: 'tasks', value: tasks, label: tasks === 1 ? 'task' : 'tasks', tone: 'idle' },
  ]
  return (
    <div className="counts">
      {rows.map((row) => (
        <p key={row.key} className={`count tone-${row.tone}`}>
          <span className="count-dot" aria-hidden="true" />
          {row.value} {row.label}
        </p>
      ))}
    </div>
  )
}

/**
 * The health line, bottom left: whether what the grove shows is current and complete.
 *
 * Quiet when all is well ("Live" or "Watching", in the counts' dim grey), and only coloured when
 * it is not: grey-orange for a part that could not be read, dim for stale. Never amber, which is
 * kept for "something needs you". Always there, even with the counts switched off, because a
 * scanner that has stopped must not look like a quiet afternoon. Clicking it opens Activity,
 * where the full reasons are. The rules are in `core/health.ts`.
 */
export function HealthLine({ onOpen }: { onOpen: () => void }) {
  const snapshot = useGrove((state) => state.snapshot)
  const loading = useGrove((state) => state.loading)
  const bridgeMissing = useGrove((state) => state.bridgeMissing)
  // Its own clock, so "Updated 3 minutes ago" keeps counting when no snapshot arrives, which is
  // exactly the case it exists for.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  // In a plain browser tab there is no scanner to report on.
  if (bridgeMissing) return null
  const health = snapshot
    ? healthOf(
        {
          at: snapshot.at,
          scanIntervalMs: snapshot.settings.scanIntervalMs,
          unreadable: snapshot.problems.map(
            (problem) => snapshot.harnesses.find((harness) => harness.id === problem.harness)?.name ?? problem.harness
          ),
          groveProblems: snapshot.groveProblems.length,
          hooks: snapshot.hooks,
        },
        now
      )
    : { tone: 'stale' as const, text: loading ? 'Looking' : 'No data', detail: 'Waiting for the first scan.' }

  return (
    <button type="button" className={`health tone-${health.tone}`} onClick={onOpen} title={health.detail} aria-label={`${health.text}. ${health.detail} Open Activity.`}>
      <span className="count-dot" aria-hidden="true" />
      {health.text}
    </button>
  )
}

/**
 * The rune console: type a job, and the Grove sends the right agent to the right stone.
 *
 * As you type, a line above the pill says what it will do ("Builder → Shellter"), read by the
 * rules in `core/console.ts`. Clicking the agent there steps through the other agents that can
 * work in a folder, for when the reading guessed wrong. With no stone selected or named, Enter
 * asks you to choose one, as sending from the tree does. Enter then goes through the same launch
 * as the agent card; the text is cleared only once Terminal has been asked to open without error,
 * so a job that failed to start is still there to try again.
 *
 * The plus attaches files (or drop them on the pill). Each one's location is added to the task,
 * so the agent can open it; Claude Code asks before reading anything outside the project.
 *
 * The art also had a sparkle button beside the pill. It was a placeholder with no job, so it went
 * (30 September 2026): a button that does nothing teaches people that buttons here do nothing.
 */
export function RuneConsole({
  inputRef,
  stones,
  placeholder = 'Ask. Build. Orchestrate...',
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  stones: ConsoleStone[]
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  /** An agent you chose by clicking the preview, over what the rules read. Cleared with the text. */
  const [chosen, setChosen] = useState<string | null>(null)
  /** A tool you chose the same way, for a built-in agent. */
  const [chosenTool, setChosenTool] = useState<'claude-code' | 'codex' | null>(null)
  const setup = useGrove((state) => state.snapshot?.setup)
  const usage = useGrove((state) => state.snapshot?.usage ?? null)
  const picker = useRef<HTMLInputElement>(null)
  const { agents } = useTree()
  const selectedStoneId = useFlow((state) => state.stoneId)
  const deployTo = useFlow((state) => state.deployTo)
  const busy = useFlow((state) => state.deployment !== null)

  // Only agents that can work in a folder; Dots and Cowork cannot be sent to a stone.
  const sendable = useMemo(() => agents.filter((agent) => kindOf(agent) === 'grove'), [agents])
  const reading = useMemo(
    () => readCommand(value, { stones, agents: sendable, selectedStoneId }),
    [value, stones, sendable, selectedStoneId]
  )
  const agent = sendable.find((each) => each.id === (chosen ?? reading.agentId)) ?? sendable[0]
  const stone = stones.find((each) => each.id === reading.stoneId)
  const typed = value.trim().length > 0

  // A question about your own history is answered by the tree itself, from the scan, unless you
  // click to hand it to an agent instead. See `core/history.ts`.
  const [toAgent, setToAgent] = useState(false)
  const period = useMemo(() => readQuestion(value, Date.now()), [value])
  const treeAnswers = period !== null && !toAgent

  // Which tool will run it. Your own agents have their own; the built-in three go where the
  // Manager's rules send them (installed, allowance not used up), unless you click to change it.
  const installed = { claudeCode: Boolean(setup?.['claude-code'].cli), codex: Boolean(setup?.codex.cli) }
  const builtIn = agent ? !agent.own : false
  const proposal = route('project', { ...installed, claudeApp: false, chatgptApp: false, dots: false }, headroomFrom(usage, Date.now()))
  const tool: 'claude-code' | 'codex' = agent && !builtIn
    ? agent.harness === 'codex' ? 'codex' : 'claude-code'
    : (chosenTool ?? (proposal.harness === 'codex' ? 'codex' : 'claude-code'))
  const canSwitchTool = builtIn && installed.claudeCode && installed.codex
  const ToolMark = HARNESS_MARK[tool].Mark

  useEffect(() => {
    if (!typed) {
      setChosen(null)
      setChosenTool(null)
      setToAgent(false)
    }
  }, [typed])

  // The same file twice is one attachment, not two chips with the same name.
  const attach = (incoming: FileList | null) => {
    if (!incoming?.length) return
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}`))
      return [...current, ...[...incoming].filter((file) => !known.has(`${file.name}:${file.size}`))]
    })
  }

  const nextAgent = () => {
    if (!agent || sendable.length < 2) return
    const index = sendable.findIndex((each) => each.id === agent.id)
    setChosen(sendable[(index + 1) % sendable.length]!.id)
  }

  const send = () => {
    if (treeAnswers && period) {
      const real = useGrove.getState().snapshot?.grove.stones ?? []
      useAnswer.getState().show(answerHistory(period, real), real.length)
      setValue('')
      return
    }
    if (!typed || !agent || busy) return
    useAnswer.getState().clear()
    const paths = files.map((file) => window.grove?.pathForFile(file) ?? '').filter(Boolean)
    const task = paths.length ? `${reading.task}\n\nFiles to use:\n${paths.map((each) => `- ${each}`).join('\n')}` : reading.task
    deployTo(
      reading.stoneId,
      agent.id,
      task,
      () => {
        setValue('')
        setFiles([])
        setChosen(null)
        setChosenTool(null)
      },
      builtIn ? tool : undefined
    )
  }

  const Glyph = agent?.Glyph

  return (
    <div className="console-group">
      {files.length ? (
        <ul className="console-files" aria-label="Attached files">
          {files.map((file) => (
            <li key={`${file.name}:${file.size}`} className="console-file">
              <File size={13} weight="thin" aria-hidden="true" />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((each) => each !== file))}
              >
                <X size={11} weight="thin" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <AnswerCard />
      {/* The echo: who would take this, and where, before anything is sent. */}
      <div className={`console-echo${typed && agent ? ' is-open' : ''}`} aria-live="polite">
        {treeAnswers && period ? (
          <>
            <span className="echo-tree">
              <Tree size={14} weight="thin" aria-hidden="true" />
              The tree answers
            </span>
            <ArrowRight size={12} weight="thin" aria-hidden="true" />
            <span className="echo-stone">{period.label}</span>
            <button type="button" className="echo-tool" onClick={() => setToAgent(true)} title="Send this to an agent instead">
              Ask an agent instead
            </button>
          </>
        ) : typed && agent && Glyph ? (
          <>
            <button
              type="button"
              className="echo-agent"
              onClick={nextAgent}
              title={sendable.length > 1 ? 'Choose another agent' : agent.name}
              aria-label={`${agent.name} will take this. Choose another agent`}
            >
              <Glyph size={14} weight="thin" aria-hidden="true" />
              {agent.name}
            </button>
            <button
              type="button"
              className="echo-tool"
              disabled={!canSwitchTool}
              onClick={() => setChosenTool(tool === 'codex' ? 'claude-code' : 'codex')}
              title={chosenTool ? 'Your choice' : builtIn ? proposal.reason : `${agent.name} always runs in ${HARNESS_MARK[tool].label}`}
              aria-label={`Runs in ${HARNESS_MARK[tool].label}${canSwitchTool ? '. Switch tool' : ''}`}
            >
              <ToolMark size={11} weight="bold" aria-hidden="true" />
              {HARNESS_MARK[tool].label}
            </button>
            <ArrowRight size={12} weight="thin" aria-hidden="true" />
            <span className={`echo-stone${stone ? '' : ' is-open-choice'}`}>{stone ? stone.name : 'you choose the stone'}</span>
          </>
        ) : null}
      </div>
      <form
        className={`console${dragging ? ' is-dropping' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          attach(event.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          className="console-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label="Command the grove"
          spellCheck={false}
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            attach(event.target.files)
            // Cleared so choosing the same file again after removing it still fires a change.
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="console-send"
          aria-label="Attach files"
          title="Attach files"
          onClick={() => picker.current?.click()}
        >
          <PlusCircle size={22} weight="thin" />
        </button>
      </form>
    </div>
  )
}

/**
 * What a screen reader hears about the grove: the stone under the pointer, or where the arrow keys
 * have moved to.
 *
 * The stones' labels are drawn on the GPU and are invisible to assistive technology, so this live
 * region is their accessible counterpart. It says one short thing per move, in the same words the
 * labels and the stone panel use.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  )
}

/**
 * True while the window fills its whole screen (the green button, or ctrl-cmd-F).
 *
 * Measured against the screen rather than asked of Electron, so it needs no bridge and works in
 * the browser preview too. A maximised window is not full screen: the menu bar still takes its strip.
 */
export function useFullScreen(): boolean {
  const measure = () => window.innerWidth >= window.screen.width - 1 && window.innerHeight >= window.screen.height - 1
  const [full, setFull] = useState(measure)
  useEffect(() => {
    const onResize = () => setFull(measure())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return full
}

/**
 * True after a few seconds with no pointer or key activity. In full screen the interface fades back
 * then, so the grove fills the display like a living wallpaper; any movement brings it straight back.
 */
export function useIdle(enabled: boolean, afterMs = 6000): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }
    let timer = window.setTimeout(() => setIdle(true), afterMs)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), afterMs)
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, wake)
    }
  }, [enabled, afterMs])
  return idle
}

/** True when the viewer has asked for less movement. Everything animated respects it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}
