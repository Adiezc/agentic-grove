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
import { useEffect, useRef, useState, type RefObject } from 'react'
import { BookOpen, Cube, File, Gear, PlusCircle, Pulse, Record, User, X } from '@phosphor-icons/react'

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
 * The rune console.
 *
 * A pill with the placeholder from the art and a plus on its right edge that attaches files, the
 * way the plus beside Claude's and ChatGPT's own message boxes does. Files can also be dropped
 * straight onto the pill. They wait as small chips above it until the console can send them
 * somewhere, which is roadmap step 10; Enter sends the words.
 *
 * The art also had a sparkle button beside the pill. It was a placeholder with no job, so it went
 * (30 September 2026): a button that does nothing teaches people that buttons here do nothing.
 */
export function RuneConsole({
  inputRef,
  placeholder = 'Ask. Build. Orchestrate...',
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  // The same file twice is one attachment, not two chips with the same name.
  const attach = (incoming: FileList | null) => {
    if (!incoming?.length) return
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}`))
      return [...current, ...[...incoming].filter((file) => !known.has(`${file.name}:${file.size}`))]
    })
  }

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
      <form
        className={`console${dragging ? ' is-dropping' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          setValue('')
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
