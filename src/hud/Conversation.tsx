/**
 * The conversation with PM, opening above the console.
 *
 * There is one place to talk to the Grove: the console at the bottom. Anything for PM goes to one
 * long-lived PM session (`core/pm/`), and its answers open here, just above where you typed, with
 * the steps it is taking listed as it takes them ("Read core/scan.ts", "Grove: send_agent"), the way
 * Claude Code shows its work. Naming another agent in the console still sends that agent straight
 * to a stone, for people who want to direct the work themselves.
 *
 * It needs you in two ways, both amber: a reply PM flagged, and a permission prompt from PM's
 * session, which you can Allow or Deny here without going to Terminal. The bar stays visible
 * while either waits, even with the conversation folded away.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, CaretDown, CaretUp, Check, Play, X } from '@phosphor-icons/react'
import { useGrove } from '../store/grove'
import { usePmPanel } from '../store/pm'
import { DEMO } from '../demo'
import type { ChatMessage } from '../../core/pm/chat.ts'
import type { PmView } from '../../electron/bridge.ts'

const OFF: PmView = { connected: false, working: false, needsYou: false, messages: [], window: 'unknown', steps: [] }

export function pmStatus(pm: PmView): string {
  if (pm.blocked) return 'Cannot start'
  if (pm.connected && pm.working) return 'Working'
  if (pm.connected) return 'Listening'
  if (pm.window === 'open') return 'Starting'
  return 'Not running'
}

export function Conversation() {
  const pm = useGrove((state) => state.snapshot?.pm ?? OFF)
  const { open, setOpen, toggle } = usePmPanel()
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  // A new reply from PM, or anything that needs you, unfolds the conversation.
  const last = pm.messages[pm.messages.length - 1]
  useEffect(() => {
    if (last && last.from !== 'you') setOpen(true)
  }, [last?.id])
  useEffect(() => {
    if (pm.needsYou) setOpen(true)
  }, [pm.needsYou])

  // Newest at the bottom, kept in view as messages and steps arrive.
  useEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [open, last?.id, pm.working, pm.steps.length])

  if (DEMO || !window.grove) return null
  if (pm.messages.length === 0 && !pm.connected && pm.window !== 'open' && !pm.blocked) return null

  const start = async (fresh = false) => {
    setStarting(true)
    setError(null)
    const result = await window.grove!.pmStart({ fresh }).catch((failure: unknown) => ({ ok: false, error: String(failure) }))
    setStarting(false)
    if (!result.ok) setError(result.error ?? 'PM did not start')
  }

  return (
    <section className={`convo${pm.needsYou ? ' needs-you' : ''}`} aria-label="Conversation with PM">
      <header className="convo-bar">
        <button type="button" className="convo-toggle" onClick={toggle} aria-expanded={open}>
          <span className="convo-title">PM</span>
          <span className={`convo-status${pm.connected ? ' is-live' : ''}${pm.working ? ' is-working' : ''}`}>{pmStatus(pm)}</span>
          {open ? <CaretDown size={11} weight="thin" aria-hidden="true" /> : <CaretUp size={11} weight="thin" aria-hidden="true" />}
        </button>
        <span className="convo-actions">
          {!pm.connected && pm.window !== 'open' && !pm.blocked ? (
            <button type="button" className="pm-icon" disabled={starting} onClick={() => void start()} title="Start PM in its Terminal window">
              <Play size={12} weight="thin" />
            </button>
          ) : null}
          {pm.window !== 'open' && !pm.connected && pm.messages.length > 0 ? (
            <button type="button" className="pm-icon" disabled={starting} onClick={() => void start(true)} title="Start a new conversation">
              <ArrowCounterClockwise size={12} weight="thin" />
            </button>
          ) : null}
        </span>
      </header>

      {open ? (
        <div className="convo-messages" ref={list} aria-live="polite">
          {pm.messages.map((message) => <Message key={message.id} message={message} />)}
          {pm.working ? (
            <div className="convo-steps">
              {pm.steps.map((step, index) => (
                <p key={`${index}:${step}`} className="convo-step">{step}</p>
              ))}
              <p className="pm-working">{pm.steps.length ? 'Working' : 'Thinking'}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {pm.blocked ? <p className="pm-blocked">{pm.blocked}</p> : null}
      {error ? <p className="panel-error pm-error">{error}</p> : null}
    </section>
  )
}

function Message({ message }: { message: ChatMessage }) {
  if (message.permission) return <PermissionCard message={message} />
  const kind = message.from === 'you' ? 'is-you' : message.from === 'grove' ? 'is-grove' : 'is-pm'
  return (
    <div className={`pm-message ${kind}${message.needsYou ? ' needs-you' : ''}`}>
      {message.steps?.length ? <Steps steps={message.steps} /> : null}
      <p>{message.text}</p>
    </div>
  )
}

/** What PM did on the way to a reply. The last three show; the rest fold behind a count. */
function Steps({ steps }: { steps: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? steps : steps.slice(-3)
  const hidden = steps.length - shown.length
  return (
    <div className="convo-steps is-done">
      {hidden > 0 ? (
        <button type="button" className="convo-more" onClick={() => setAll(true)}>
          {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
        </button>
      ) : null}
      {shown.map((step, index) => (
        <p key={`${index}:${step}`} className="convo-step">{step}</p>
      ))}
    </div>
  )
}

/** A permission prompt from PM's session. Answer here or in Terminal; whichever comes first counts. */
function PermissionCard({ message }: { message: ChatMessage }) {
  const request = message.permission!
  const [busy, setBusy] = useState(false)
  const answer = async (allow: boolean) => {
    setBusy(true)
    await window.grove?.pmAnswerPermission(request.request_id, allow).catch(() => undefined)
    setBusy(false)
  }
  const open = request.state === 'open'
  return (
    <div className={`pm-permission${open ? ' needs-you' : ''}`}>
      <p className="pm-permission-head">PM wants to use {request.tool_name}</p>
      <p>{request.description}</p>
      {request.input_preview ? <pre className="pm-preview">{request.input_preview}</pre> : null}
      {open ? (
        <div className="proposal-choices">
          <button type="button" className="setting-button is-primary" disabled={busy} onClick={() => void answer(true)}>
            <Check size={12} weight="thin" /> Allow
          </button>
          <button type="button" className="setting-button" disabled={busy} onClick={() => void answer(false)}>
            <X size={12} weight="thin" /> Deny
          </button>
        </div>
      ) : (
        <p className="pm-dim">{request.state === 'allowed' ? 'Allowed' : request.state === 'denied' ? 'Denied' : 'Answered in Terminal, or no longer open'}</p>
      )}
    </div>
  )
}
