/**
 * The first-launch walkthrough, given by PM: the agent you talk to is the one who says hello.
 *
 * Five cards, one idea each, a sentence or two apiece: what the grove is, getting your AI tools
 * ready (one button, see `GetReady` and `core/readiness.ts`), what a runestone is, where agents come from, and
 * how to read the heartbeat. Told by an agent rather than by the app,
 * because the grove's whole premise is that the agents live here, and meeting one first is the
 * quickest way to understand that.
 *
 * Shown once. Whether it has been seen is kept in the window's own storage, which is per machine
 * and survives restarts, and which is fine to lose: the worst case is seeing it again.
 */
import { useEffect, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { ArrowRight, CircleDashed, Heartbeat, Plugs, TreeEvergreen, UsersThree } from '@phosphor-icons/react'
import { PM } from '../agents/tree'
import { DEMO } from '../demo'
import { GetReady } from './Setup'

const SEEN_KEY = 'grove:intro-seen'

const STEPS: { Glyph: Icon; text: string; setup?: boolean }[] = [
  { Glyph: TreeEvergreen, text: "This is your grove. I'm PM. Tell me what needs doing and I'll plan it and hand it to the right agent." },
  {
    Glyph: Plugs,
    text: 'First, your AI tools. I work through Claude Code or Codex. If anything is missing, one button sorts it out.',
    setup: true,
  },
  { Glyph: CircleDashed, text: 'Each runestone is a project. Choose an empty circle to create one or connect a folder.' },
  { Glyph: UsersThree, text: 'Researcher and Builder work with me on the tree, with any agents you add. Everyday coworkers from ChatGPT and Claude drift round it as fireflies.' },
  { Glyph: Heartbeat, text: 'The grove breathes slowly at rest and faster while we work. Amber means one of us needs you.' },
]

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** `hidden` steps the card aside while a rail panel (Settings) opens over the same corner; it keeps its place. */
export function Intro({ hidden = false }: { hidden?: boolean }) {
  // Never in demo mode, which exists for judging the scene, not for being greeted by it.
  const [step, setStep] = useState<number | null>(() => (DEMO || alreadySeen() ? null : 0))

  const done = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Storage refused (private window, full disk). The intro simply comes back next time.
    }
    setStep(null)
  }

  const next = () => (step !== null && step < STEPS.length - 1 ? setStep(step + 1) : done())

  // Right arrow moves on; Esc is the grove-wide "back", which here means skip. Listening in the
  // capture phase, and marking the arrow as handled, is what stops the same press also moving
  // the keyboard grove's focus to a stone while the card is still talking.
  useEffect(() => {
    if (step === null || hidden) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') done()
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (step === null) return null
  const { Glyph, text, setup } = STEPS[step]!
  const Face = PM.Glyph
  const last = step === STEPS.length - 1

  return (
    <aside
      className={`intro${hidden ? ' is-hidden' : ''}`}
      role="dialog"
      aria-label="Welcome to the grove"
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <header className="intro-head">
        <span className="agent-face" aria-hidden="true">
          <Face size={22} weight="light" />
        </span>
        <span className="intro-name">{PM.name}</span>
        <button type="button" className="intro-skip" onClick={done}>
          Skip
        </button>
      </header>
      <div className="intro-body" key={step}>
        <Glyph size={26} weight="thin" className="intro-glyph" aria-hidden="true" />
        <p className="intro-text">{text}</p>
      </div>
      {setup ? <GetReady /> : null}
      <footer className="intro-foot">
        <span className="pager-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, index) => (
            <span key={index} className={`pager-dot${index === step ? ' is-on' : ''}`} />
          ))}
        </span>
        <button type="button" className="intro-next" onClick={next} autoFocus={!hidden}>
          <span>{last ? 'Begin' : 'Next'}</span>
          <ArrowRight size={14} weight="thin" />
        </button>
      </footer>
    </aside>
  )
}
