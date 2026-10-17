/**
 * PM's questions: each change PM wants to make that is yours to decide, with Yes and No.
 *
 * A proposal is written by the node side when PM asks for an `ask` action (a permanent agent, a
 * new clearing, a sub-stone, a saved task; see `core/actions/registry.ts`). This card only shows
 * them and sends your answer: the id and yes or no, plus a reason if you give one. What a yes runs
 * is read back from the node side's own record, never from here.
 *
 * Amber, like everything else that needs you, and shown until answered. One at a time, oldest
 * first, with a count when more are waiting, so the corner of the screen never fills with cards.
 */
import { useEffect, useState } from 'react'
import { Check, Compass, X } from '@phosphor-icons/react'
import { useGrove } from '../store/grove'
import { DEMO } from '../demo'
import type { Proposal } from '../../core/actions/proposals.ts'

const NONE: Proposal[] = []

export function ProposalsCard() {
  const proposals = useGrove((state) => state.snapshot?.proposals ?? NONE)
  const [busy, setBusy] = useState(false)
  const [reasoning, setReasoning] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const current = proposals[0]

  // A new question starts clean: no half-typed reason or old error carried over from the last.
  useEffect(() => {
    setReasoning(false)
    setReason('')
    setError(null)
  }, [current?.id])

  // The result of a yes stays a moment, so you see it worked (or why not), then goes.
  useEffect(() => {
    if (!outcome) return
    const timer = window.setTimeout(() => setOutcome(null), 4000)
    return () => window.clearTimeout(timer)
  }, [outcome])

  if (DEMO || !window.grove || (!current && !outcome)) return null

  const answer = async (verdict: 'yes' | 'no') => {
    if (!current || busy) return
    setBusy(true)
    setError(null)
    const result = await window.grove!.decideProposal(current.id, verdict, reason.trim() || undefined).catch((failure: unknown) => ({ ok: false as const, error: String(failure), result: undefined }))
    setBusy(false)
    if (!result.ok) setError(result.error ?? 'That did not work')
    else if (verdict === 'yes' && result.result) setOutcome(result.result.ok ? result.result.text : `It could not be done. ${result.result.text}`)
  }

  if (!current) {
    return (
      <section className="proposal-card is-done" aria-live="polite">
        <p className="proposal-line">{outcome}</p>
      </section>
    )
  }

  const more = proposals.length - 1
  return (
    <section className="proposal-card" aria-label="PM is asking" aria-live="polite">
      <header className="proposal-head">
        <Compass size={14} weight="thin" aria-hidden="true" />
        <span>PM asks</span>
        {more > 0 ? <span className="proposal-more">{more} more waiting</span> : null}
      </header>
      <p className="proposal-summary">{current.summary}?</p>
      {current.reason ? <p className="proposal-line">{current.reason}</p> : null}
      {reasoning ? (
        <input
          className="proposal-reason"
          autoFocus
          value={reason}
          maxLength={600}
          placeholder="Why, for PM (optional)"
          aria-label="Your reason, for PM"
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setReasoning(false)
            }
          }}
        />
      ) : null}
      <div className="proposal-choices">
        <button type="button" className="setting-button is-primary" disabled={busy} onClick={() => void answer('yes')}>
          <Check size={12} weight="thin" /> Yes
        </button>
        <button type="button" className="setting-button" disabled={busy} onClick={() => void answer('no')}>
          <X size={12} weight="thin" /> No
        </button>
        {!reasoning ? (
          <button type="button" className="proposal-quiet" onClick={() => setReasoning(true)}>
            Add a reason
          </button>
        ) : null}
      </div>
      {error ? <p className="panel-error">{error}</p> : null}
    </section>
  )
}
