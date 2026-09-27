/**
 * The first-launch walkthrough, given by Researcher.
 *
 * Four cards, one idea each, a sentence or two apiece: what the grove is, what a runestone is,
 * where agents come from, and how to read the heartbeat. Told by an agent rather than by the app,
 * because the grove's whole premise is that the agents live here, and meeting one first is the
 * quickest way to understand that.
 *
 * Shown once. Whether it has been seen is kept in the window's own storage, which is per machine
 * and survives restarts, and which is fine to lose: the worst case is seeing it again.
 */
import { useEffect, useState } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { ArrowRight, CircleDashed, Heartbeat, TreeEvergreen, UsersThree } from '@phosphor-icons/react'
import { RESEARCHER } from '../agents/tree'
import { DEMO } from '../demo'

const SEEN_KEY = 'grove:intro-seen'

const STEPS: { Glyph: Icon; text: string }[] = [
  { Glyph: TreeEvergreen, text: "This is your grove. I'm Researcher. I live in the tree, with the agents you'll add." },
  { Glyph: CircleDashed, text: 'Each runestone is a project. Choose an empty circle to create one or connect a folder.' },
  { Glyph: UsersThree, text: 'Connect Claude Code or Codex for heavier work. Grok Bots drift round the tree as fireflies.' },
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
  const { Glyph, text } = STEPS[step]!
  const Face = RESEARCHER.Glyph
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
        <span className="intro-name">{RESEARCHER.name}</span>
        <button type="button" className="intro-skip" onClick={done}>
          Skip
        </button>
      </header>
      <div className="intro-body" key={step}>
        <Glyph size={26} weight="thin" className="intro-glyph" aria-hidden="true" />
        <p className="intro-text">{text}</p>
      </div>
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
