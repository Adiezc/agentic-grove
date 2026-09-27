/**
 * Settings, opened from the gear on the rail. For now it holds one thing: live updates from
 * Claude Code through its hooks.
 *
 * This panel is where the Grove asks to edit another tool's file, so it follows DECISIONS.md to
 * the letter. Nothing is written until you have seen the exact lines that will change and pressed
 * Apply. The same review step guards Remove, because taking lines out is a change too.
 */
import { useEffect, useState } from 'react'
import { Asterisk, X } from '@phosphor-icons/react'
import type { HooksAction, HooksPlan } from '../../core/hooks/install.ts'
import type { HooksStatus } from '../../electron/bridge.ts'
import { useGrove } from '../store/grove'

/** Heard from within this long counts as "live". Longer is still connected, just quiet. */
const LIVE_WINDOW_MS = 10 * 60_000

type Tone = 'live' | 'idle' | 'wait'

/** One short line for where the connection stands, and the colour of its dot. */
function describe(hooks: HooksStatus, now: number): { line: string; tone: Tone } {
  if (!hooks.listening) return { line: hooks.listenError ?? 'Not listening', tone: 'wait' }
  switch (hooks.state) {
    case 'unreadable':
      return { line: hooks.error ?? "Can't read Claude Code's settings", tone: 'wait' }
    case 'outdated':
      return { line: 'Needs an update', tone: 'wait' }
    case 'off':
      return { line: 'Off', tone: 'idle' }
    case 'on':
      if (hooks.lastCallAt && now - hooks.lastCallAt < LIVE_WINDOW_MS) return { line: 'Live', tone: 'live' }
      return { line: 'On. Starts with your next Claude Code session', tone: 'idle' }
  }
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hooks = useGrove((state) => state.snapshot?.hooks)
  const [plan, setPlan] = useState<HooksPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Closing throws away a half-reviewed change: a review is only good for the file it was made from.
  useEffect(() => {
    if (open) return
    setPlan(null)
    setError(null)
  }, [open])

  const review = async (action: HooksAction) => {
    if (!window.grove) return
    setBusy(true)
    setError(null)
    const next = await window.grove.planHooks(action)
    setBusy(false)
    if (!next.ok) setError(next.error ?? 'Could not read the settings')
    else if (!next.changes) setError('Nothing to change.')
    else setPlan(next)
  }

  const apply = async () => {
    if (!window.grove || !plan) return
    setBusy(true)
    const result = await window.grove.applyHooks(plan.action, plan.baseline)
    setBusy(false)
    if (result.ok) {
      setPlan(null)
      setError(null)
    } else {
      setError(result.error ?? 'That did not work')
      // The file moved under us; offer the fresh change rather than making them start over.
      if (result.error?.includes('changed since')) void review(plan.action)
    }
  }

  const status = hooks ? describe(hooks, Date.now()) : null
  const installed = hooks?.state === 'on' || hooks?.state === 'outdated'
  const canWrite = Boolean(window.grove) && hooks?.state !== 'unreadable'

  return (
    <aside
      className={`flow-panel settings-panel${open ? ' is-open' : ''}`}
      aria-hidden={!open}
      inert={!open}
      aria-label="Settings"
    >
      <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
        <X size={16} weight="thin" />
      </button>
      <h2 className="panel-title">Settings</h2>

      <section className="setting">
        <header className="setting-head">
          <span className="setting-mark" aria-hidden="true">
            <Asterisk size={14} weight="bold" />
          </span>
          <div>
            <p className="setting-name">Live updates</p>
            {status ? (
              <p className={`panel-state tone-${status.tone === 'live' ? 'running' : status.tone === 'wait' ? 'waiting' : 'idle'}`}>
                <span className="state-dot" aria-hidden="true" />
                {status.line}
              </p>
            ) : (
              <p className="panel-state">Needs the app</p>
            )}
          </div>
        </header>
        <p className="panel-line setting-line">
          Claude Code tells the grove the moment something happens, instead of every few seconds.
        </p>

        {plan ? (
          <div className="hooks-review">
            <p className="setting-line">
              {plan.action === 'install'
                ? "These lines will be added to Claude Code's settings:"
                : "These lines will be taken out of Claude Code's settings:"}
            </p>
            <pre className="hooks-diff" tabIndex={0} aria-label="The change">
              {plan.lines.map((line, index) => (
                <span key={index} className={`diff-${line.kind}`}>
                  {line.kind === 'gap' ? '⋯' : `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} ${line.text}`}
                  {'\n'}
                </span>
              ))}
            </pre>
            <p className="setting-fine">A copy of the file as it is now is kept in ~/.agentic-grove/backups.</p>
            <div className="setting-actions">
              <button type="button" className="setting-button is-primary" onClick={apply} disabled={busy}>
                Apply
              </button>
              <button type="button" className="setting-button" onClick={() => setPlan(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="setting-actions">
            {hooks?.state === 'off' ? (
              <button type="button" className="setting-button is-primary" onClick={() => review('install')} disabled={busy || !canWrite}>
                Turn on
              </button>
            ) : null}
            {hooks?.state === 'outdated' ? (
              <button type="button" className="setting-button is-primary" onClick={() => review('install')} disabled={busy || !canWrite}>
                Update
              </button>
            ) : null}
            {installed ? (
              <button type="button" className="setting-button" onClick={() => review('remove')} disabled={busy || !canWrite}>
                Turn off
              </button>
            ) : null}
          </div>
        )}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </aside>
  )
}
