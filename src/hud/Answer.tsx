/**
 * The tree's answer, just above the console: one sentence, then the stones in the order you came
 * to them. Each stone lights in the scene as its line appears, so the grove itself is the answer
 * and the words are its caption. Under reduced motion every line is there at once and nothing
 * takes turns.
 */
import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { describeAnswer } from '../../core/history.ts'
import { useAnswer } from '../store/answer'
import { useFlow } from '../store/flow'
import { usePrefersReducedMotion } from './Hud'

/** How long each stone holds the light before the next one is named. */
const STEP_MS = 1100

export function AnswerCard() {
  const answer = useAnswer((state) => state.answer)
  const stonesOnGrove = useAnswer((state) => state.stonesOnGrove)
  const lit = useAnswer((state) => state.lit)
  const still = usePrefersReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!answer) return
    const total = answer.stones.length
    if (still || total === 0) {
      setShown(total)
      return
    }
    setShown(0)
    let step = 0
    const next = () => {
      step += 1
      setShown(Math.min(step, total))
      // One beat past the last stone, the light lets go.
      useAnswer.getState().light(step <= total ? answer.stones[step - 1]!.id : null)
      if (step > total) window.clearInterval(timer)
    }
    const timer = window.setInterval(next, STEP_MS)
    next()
    return () => window.clearInterval(timer)
  }, [answer, still])

  if (!answer) return null
  const { headline, notes } = describeAnswer(answer, stonesOnGrove)
  return (
    <section className="answer-card" aria-label="The tree answers" aria-live="polite">
      <button type="button" className="panel-close" onClick={() => useAnswer.getState().clear()} aria-label="Close the answer">
        <X size={14} weight="thin" />
      </button>
      <p className="answer-headline">{headline}</p>
      {answer.stones.length ? (
        <ol className="answer-stones">
          {answer.stones.slice(0, shown).map((stone) => (
            <li key={stone.id} className={lit === stone.id ? 'is-lit' : ''}>
              <button
                type="button"
                className="answer-stone"
                onClick={() => {
                  useAnswer.getState().clear()
                  useFlow.getState().selectStone(stone.id)
                }}
                onPointerEnter={() => useAnswer.getState().light(stone.id)}
                onPointerLeave={() => useAnswer.getState().light(null)}
              >
                {stone.name}
              </button>
              <span className="answer-detail">
                {stone.sessions === 1 ? '1 session' : `${stone.sessions} sessions`}
                {stone.titles.length ? `: ${stone.titles.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="answer-note">
          {note}
        </p>
      ))}
      <p className="answer-note">From the session records on this Mac, for projects on the grove.</p>
    </section>
  )
}
