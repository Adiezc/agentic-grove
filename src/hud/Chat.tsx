/**
 * Talking to PM: the Grove's front door.
 *
 * A tab on the right edge opens the conversation. You type; PM, a real Claude Code session in its
 * own Terminal window, reads it through the Grove's channel and answers here (`core/pm/`). PM
 * decides which agent, stone and model a job needs and only asks when something is yours to
 * decide, so most people never need anything but this panel.
 *
 * Three things here can need you, all amber, the Grove's one colour for it: a reply PM flagged, a
 * permission prompt from PM's session (Allow or Deny without going to Terminal), and the tab
 * itself while either is waiting.
 *
 * The chip under the box shows the model the Grove would pick for what you are typing
 * (`core/model-policy.ts`). Change it and the message carries your choice, so PM uses it: PM
 * proposes, you decide.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChatCircleDots, Check, Play, ArrowCounterClockwise, X } from '@phosphor-icons/react'
import { useGrove } from '../store/grove'
import { usePmPanel } from '../store/pm'
import { DEMO } from '../demo'
import { ModelChip, type ChipPick } from './ModelChip'
import { classifyJob, pickModel } from '../../core/model-policy.ts'
import { effortLabel, modelLabel } from '../../core/models.ts'
import type { ChatMessage } from '../../core/pm/chat.ts'
import type { PmView } from '../../electron/bridge.ts'

const OFF: PmView = { connected: false, working: false, needsYou: false, messages: [], window: 'unknown' }

function statusLine(pm: PmView): string {
  if (pm.blocked) return 'Cannot start'
  if (pm.connected && pm.working) return 'Working'
  if (pm.connected) return 'Listening'
  if (pm.window === 'open') return 'Starting'
  return 'Not running'
}

export function PmChat() {
  const pm = useGrove((state) => state.snapshot?.pm ?? OFF)
  const settings = useGrove((state) => state.snapshot?.settings)
  const usage = useGrove((state) => state.snapshot?.usage ?? null)
  const { open, setOpen, toggle } = usePmPanel()
  const [text, setText] = useState('')
  const [override, setOverride] = useState<{ model: string; effort: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Newest at the bottom, kept in view as messages arrive.
  const last = pm.messages[pm.messages.length - 1]?.id
  useEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [open, last, pm.working])

  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])

  // A new message clears any model you chose for the last one.
  useEffect(() => {
    if (!text.trim()) setOverride(null)
  }, [text])

  const pick: ChipPick | null = useMemo(() => {
    if (!settings || !text.trim()) return null
    const base = pickModel({ tier: classifyJob(text), tool: 'claude-code', usage, settings, now: Date.now() })
    return { ...base, ...(override ?? {}), needsOk: override ? false : base.needsOk }
  }, [settings, usage, text, override])

  if (DEMO || !window.grove) return null

  const start = async (fresh = false) => {
    setStarting(true)
    setError(null)
    const result = await window.grove!.pmStart({ fresh }).catch((failure: unknown) => ({ ok: false, error: String(failure) }))
    setStarting(false)
    if (!result.ok) setError(result.error ?? 'PM did not start')
  }

  const send = async () => {
    const typed = text.trim()
    if (!typed) return
    setError(null)
    const choice = override ? `\n\n(Use ${modelLabel(override.model) || 'the default model'}${override.effort ? ` at ${effortLabel(override.effort)} effort` : ''} for this.)` : ''
    const result = await window.grove!.pmSay(typed + choice).catch((failure: unknown) => ({ ok: false, error: String(failure) }))
    if (!result.ok) return setError(result.error ?? 'Not sent')
    setText('')
    // Talking to PM when it is not running starts it; the message waits until it is listening.
    if (!pm.connected && pm.window !== 'open' && !pm.blocked) void start()
  }

  const tabClass = `pm-tab${pm.needsYou ? ' needs-you' : pm.working ? ' is-working' : pm.connected ? ' is-live' : ''}`
  return (
    <>
      <button type="button" className={tabClass} onClick={toggle} aria-expanded={open} aria-label={`PM: ${statusLine(pm)}`} title="Talk to PM">
        <ChatCircleDots size={16} weight="thin" aria-hidden="true" />
        <span>PM</span>
      </button>
      {open ? (
        <section className="pm-panel" aria-label="Conversation with PM">
          <header className="pm-head">
            <span className="pm-title">PM</span>
            <span className={`pm-status${pm.connected ? ' is-live' : ''}`}>{statusLine(pm)}</span>
            <span className="pm-head-actions">
              {!pm.connected && pm.window !== 'open' && !pm.blocked ? (
                <button type="button" className="pm-icon" disabled={starting} onClick={() => void start()} title="Start PM in its Terminal window">
                  <Play size={13} weight="thin" />
                </button>
              ) : null}
              {pm.window !== 'open' && pm.messages.length > 0 ? (
                <button type="button" className="pm-icon" disabled={starting} onClick={() => void start(true)} title="Start a new conversation">
                  <ArrowCounterClockwise size={13} weight="thin" />
                </button>
              ) : null}
              <button type="button" className="pm-icon" onClick={() => setOpen(false)} aria-label="Close">
                <X size={13} weight="thin" />
              </button>
            </span>
          </header>

          <div className="pm-messages" ref={list} aria-live="polite">
            {pm.messages.length === 0 ? (
              <div className="pm-empty">
                <p>Tell PM what you need.</p>
                <p className="pm-dim">It picks the agent, the stone and the model, works in the background, and asks only when something is yours to decide.</p>
              </div>
            ) : (
              pm.messages.map((message) => <Message key={message.id} message={message} />)
            )}
            {pm.working ? <p className="pm-working">PM is working</p> : null}
          </div>

          {pm.blocked ? <p className="pm-blocked">{pm.blocked}</p> : null}
          {error ? <p className="panel-error pm-error">{error}</p> : null}

          <div className="pm-compose">
            <textarea
              ref={box}
              className="pm-input"
              rows={2}
              value={text}
              maxLength={20_000}
              placeholder={pm.connected ? 'Ask or tell PM anything' : 'Ask PM anything; it starts when you send'}
              aria-label="Message to PM"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
                if (event.key === 'Escape') setOpen(false)
              }}
            />
            <div className="pm-compose-row">
              {pick ? <ModelChip pick={pick} onChange={(model, effort) => setOverride({ model, effort })} /> : <span />}
              <button type="button" className="pm-send" disabled={!text.trim()} onClick={() => void send()} aria-label="Send to PM">
                <ArrowUp size={14} weight="bold" />
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

function Message({ message }: { message: ChatMessage }) {
  if (message.permission) return <PermissionCard message={message} />
  const kind = message.from === 'you' ? 'is-you' : message.from === 'grove' ? 'is-grove' : 'is-pm'
  return (
    <div className={`pm-message ${kind}${message.needsYou ? ' needs-you' : ''}`}>
      <p>{message.text}</p>
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
