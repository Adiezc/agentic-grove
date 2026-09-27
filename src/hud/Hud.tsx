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
import { useEffect, useState, type RefObject } from 'react'
import {
  Asterisk,
  BookOpen,
  Cube,
  CubeTransparent,
  Gear,
  PlusCircle,
  Prohibit,
  Pulse,
  Record,
  Spiral,
  Sparkle,
  User,
  X,
} from '@phosphor-icons/react'

/** Every icon at one weight. Phosphor's `thin` is what matches the art's hairline rail. */
const ICON = { size: 17, weight: 'thin' } as const

/**
 * The left rail.
 *
 * In the concept art these are undifferentiated glyphs, and in the spike they still are, with one
 * exception: the pulse icon toggles the raw session list from session two. That is deliberate —
 * the one rail item that does something is the one that shows you the real data underneath the
 * scene, which is the most useful thing to have a shortcut to while judging whether the scene is
 * telling the truth.
 */
export function Rail({
  onToggleData,
  dataOpen,
  onHome,
  onAgents,
  inAgents,
  onSettings,
  settingsOpen = false,
}: {
  onToggleData: () => void
  dataOpen: boolean
  onHome: () => void
  onAgents: () => void
  inAgents: boolean
  onSettings?: () => void
  settingsOpen?: boolean
}) {
  const items = [
    { key: 'grove', Icon: Record, label: 'Grove', action: onHome, on: !inAgents && !dataOpen },
    { key: 'agents', Icon: User, label: 'Agents', action: onAgents, on: inAgents },
    { key: 'runes', Icon: BookOpen, label: 'Runes' },
    { key: 'projects', Icon: Cube, label: 'Projects' },
    { key: 'activity', Icon: Pulse, label: 'Session data', action: onToggleData, on: dataOpen },
    { key: 'settings', Icon: Gear, label: 'Settings', action: onSettings, on: settingsOpen },
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
          disabled={!action}
          aria-label={label}
          aria-pressed={action ? Boolean(on) : undefined}
          title={action ? label : `${label} (not in the spike)`}
        >
          <Icon size={ICON.size} weight={ICON.weight} />
        </button>
      ))}
    </nav>
  )
}

/**
 * The harness row, top right.
 *
 * Five glyphs with a dot beneath each: the tools the Grove can see. The dot is the only part that
 * carries state, which is why it is allowed to be green. In the art the fifth glyph is dimmer
 * than the rest, and that maps exactly onto the project's honesty requirement — a tool that is
 * not installed is shown as not installed rather than hidden.
 */
export function HarnessRow() {
  const harnesses = [
    { key: 'claude', Icon: Asterisk, label: 'Claude Code', on: true },
    { key: 'codex', Icon: Spiral, label: 'Codex', on: true },
    { key: 'cursor', Icon: Prohibit, label: 'Cursor (not installed)', on: false },
    { key: 'xai', Icon: X, label: 'xAI', on: false },
    { key: 'api', Icon: CubeTransparent, label: 'Direct API', on: false },
  ]

  return (
    <div className="harness-row" role="list" aria-label="Tools the Grove can see">
      {harnesses.map(({ key, Icon, label, on }) => (
        <div key={key} className={`harness${on ? ' is-on' : ''}`} role="listitem" title={label}>
          <Icon size={18} weight="thin" />
          <span className="harness-dot" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </div>
      ))}
    </div>
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
 * The rune console.
 *
 * A pill with the placeholder from the art, a plus on its right edge, and a separate sparkle
 * button outside it. The grouping matters: in the art the pill is left of centre and the sparkle
 * sits apart from it, and the *pair* is centred. Centring the pill alone puts the sparkle out
 * past the middle and the whole bottom edge stops balancing.
 *
 * It does nothing in the spike. It is focusable and typeable because a console you cannot click
 * into reads as an image of a console, and part of what is being judged is whether this feels
 * like something you would talk to.
 */
export function RuneConsole({
  inputRef,
  placeholder = 'Ask. Build. Orchestrate...',
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  return (
    <div className="console-group">
      <form
        className="console"
        onSubmit={(event) => {
          event.preventDefault()
          setValue('')
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
        <button type="submit" className="console-send" aria-label="Send">
          <PlusCircle size={22} weight="thin" />
        </button>
      </form>
      <button type="button" className="console-spark" aria-label="Suggestions">
        <Sparkle size={20} weight="thin" />
      </button>
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
