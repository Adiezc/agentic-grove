/**
 * Settings, opened from the gear on the rail.
 *
 * Everything here is saved in `grove.json` in `~/.agentic-grove`, outside the app, so updating the
 * Grove never resets it. Most used first: how the grove draws, what it shows, notifications, Claude's
 * official limits, updates, and live updates from Claude Code.
 *
 * The live-updates section is where the Grove asks to edit another tool's file, so it follows
 * DECISIONS.md to the letter. Nothing is written until you have seen the exact lines that will
 * change and pressed Apply. The same review step guards Remove, because taking lines out is a
 * change too.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowsClockwise, Asterisk, Bell, Eye, Gauge, Monitor, Plugs, Trash, X } from '@phosphor-icons/react'
import { ToolSetup } from './Setup'
import type { HooksAction, HooksPlan } from '../../core/hooks/install.ts'
import type { HooksStatus, UninstallPlan } from '../../electron/bridge.ts'
import { GRAPHICS_MODES, type GraphicsMode, type GroveSettings } from '../../core/state/schema.ts'
import { WINDOW_NAME, ago, figure } from '../../core/usage/format.ts'
import { useGrove } from '../store/grove'
import { saveSettings, useSettings, useSettingsError } from '../store/settings'
import { useDrawing, type Reason } from '../scene/graphics'

const MODE_NAME: Record<GraphicsMode, string> = { performance: 'Performance', balanced: 'Balanced', grove: 'Grove' }
const MODE_LINE: Record<GraphicsMode, string> = {
  performance: 'For slower Macs. No reflections or glow, held at 60 frames a second.',
  balanced: 'Nearly the full look for about half the work.',
  grove: 'Everything, at your screen’s full refresh rate.',
}
const REASON_LINE: Record<Reason, string> = {
  chosen: '',
  busy: 'because your Mac is busy',
  slow: 'to keep it smooth',
  away: 'while it is behind other windows',
}

function Switch({ label, detail, on, onChange }: { label: string; detail?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        {label}
        {detail ? <small>{detail}</small> : null}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  )
}

function Section({ icon, name, children }: { icon: ReactNode; name: string; children: ReactNode }) {
  return (
    <section className="setting">
      <header className="setting-head">
        <span className="setting-mark" aria-hidden="true">
          {icon}
        </span>
        <p className="setting-name">{name}</p>
      </header>
      {children}
    </section>
  )
}

function Graphics({ settings }: { settings: GroveSettings }) {
  const drawing = useDrawing()
  const lowered = drawing.mode !== settings.graphics
  return (
    <Section icon={<Monitor size={14} weight="regular" />} name="Graphics">
      <div className="segmented" role="radiogroup" aria-label="Graphics mode">
        {GRAPHICS_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={settings.graphics === mode}
            className={`segment${settings.graphics === mode ? ' is-on' : ''}`}
            onClick={() => void saveSettings({ graphics: mode })}
          >
            {MODE_NAME[mode]}
          </button>
        ))}
      </div>
      <p className="setting-line">{MODE_LINE[settings.graphics]}</p>
      <Switch
        label="Adapt automatically"
        detail="Steps down when your Mac is busy or the grove is behind other windows, and back up after. Never above your choice."
        on={settings.adaptiveGraphics}
        onChange={(on) => void saveSettings({ adaptiveGraphics: on })}
      />
      <Switch
        label="Draw less when nothing is happening"
        detail="8 frames a second while no agent is working and you are not using the window. Full speed the moment anything moves."
        on={settings.quietWhenIdle}
        onChange={(on) => void saveSettings({ quietWhenIdle: on })}
      />
      <p className="setting-fine">
        {lowered
          ? `Drawing at ${MODE_NAME[drawing.mode]} for now, ${REASON_LINE[drawing.reason]}.`
          : `Drawing at ${MODE_NAME[drawing.mode]}${drawing.refreshHz && drawing.mode !== 'performance' ? `, ${drawing.refreshHz} fps screen` : ''}.`}
      </p>
    </Section>
  )
}

function Showing({ settings }: { settings: GroveSettings }) {
  return (
    <Section icon={<Eye size={14} weight="regular" />} name="In the grove">
      <Switch
        label="Everyday coworkers"
        detail="ChatGPT Dots and Claude Cowork, drifting round the tree"
        on={settings.showFireflies}
        onChange={(on) => void saveSettings({ showFireflies: on })}
      />
      <Switch label="Counts" detail="Agents, running and tasks, bottom left" on={settings.showCounts} onChange={(on) => void saveSettings({ showCounts: on })} />
      <Switch
        label="Always show stone names"
        detail="Otherwise names show on hover"
        on={settings.alwaysShowNames}
        onChange={(on) => void saveSettings({ alwaysShowNames: on })}
      />
      <Switch label="Drifting motes" on={settings.ambientMotion} onChange={(on) => void saveSettings({ ambientMotion: on })} />
      <Switch
        label="Turn slowly when left alone"
        detail="After five quiet minutes. Any movement brings the view home."
        on={settings.idleDrift}
        onChange={(on) => void saveSettings({ idleDrift: on })}
      />
    </Section>
  )
}

/**
 * When the Grove may show a macOS notification about work it started. Always silent, and never
 * while a Grove window is in front. See `core/attention.ts` for the rules.
 */
function Notifications({ settings }: { settings: GroveSettings }) {
  return (
    <Section icon={<Bell size={14} weight="regular" />} name="Notifications">
      <Switch
        label="When an agent finishes"
        detail="Jobs that took a minute or more. Failures are always shown."
        on={settings.notifyFinished}
        onChange={(on) => void saveSettings({ notifyFinished: on })}
      />
      <Switch
        label="When an agent needs you"
        detail="Otherwise its stone turns amber and waits for you"
        on={settings.notifyNeedsYou}
        onChange={(on) => void saveSettings({ notifyNeedsYou: on })}
      />
    </Section>
  )
}

/**
 * Claude's official five-hour and weekly figures, read by running your own Claude Code once. Off
 * until switched on, and a check happens only when the button is pressed, because each one is a
 * small request on your plan. See `core/usage/probe.ts`.
 */
function ClaudeLimits({ settings }: { settings: GroveSettings }) {
  const claude = useGrove((state) => state.snapshot?.usage?.providers.find((provider) => provider.provider === 'claude-code'))
  const installed = useGrove((state) => state.snapshot?.setup['claude-code'].cli)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const now = Date.now()
  const official = claude?.windows.filter((window) => window.provenance === 'official') ?? []
  const checkedAt = official[0]?.observedAt ?? null

  const check = async () => {
    if (!window.grove) return
    setChecking(true)
    setMessage(null)
    const result = await window.grove.checkClaudeLimits()
    setChecking(false)
    const used = result.tokens ? ` The check used ${result.tokens.toLocaleString('en-GB')} tokens.` : ''
    setMessage(result.ok ? `Checked.${used}` : `${result.error ?? 'The check did not work.'}${used}`)
  }

  return (
    <Section icon={<Gauge size={14} weight="regular" />} name="Claude limits">
      <Switch
        label="Official Claude limits"
        detail="Runs your own Claude Code once when you press Check now. Each check sends one small request on your plan."
        on={settings.officialClaudeLimits}
        onChange={(on) => {
          setMessage(null)
          void saveSettings({ officialClaudeLimits: on })
        }}
      />
      {settings.officialClaudeLimits ? (
        <>
          <p className="setting-line">
            {official.length
              ? `${official.map((window) => `${WINDOW_NAME[window.key]}: ${figure(window, now)}`).join('. ')}.`
              : 'Not checked yet.'}
          </p>
          <div className="setting-actions">
            <button type="button" className="setting-button" disabled={!window.grove || !installed || checking} onClick={() => void check()}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          <p className="setting-fine">
            {message ??
              (!window.grove
                ? 'Needs the app'
                : !installed
                  ? 'Needs Claude Code set up on this Mac.'
                  : checkedAt
                    ? `Checked ${ago(checkedAt, now)}. Never checks by itself.`
                    : 'Never checks by itself. Uses the smallest Claude model, with none of your settings or files.')}
          </p>
        </>
      ) : null}
    </Section>
  )
}

function Updates({ settings }: { settings: GroveSettings }) {
  const update = useGrove((state) => state.snapshot?.update)
  const version = useGrove((state) => state.snapshot?.version)
  const [checking, setChecking] = useState(false)
  const status = (() => {
    if (!update) return 'Needs the app'
    switch (update.state) {
      case 'available':
        return `Version ${update.latest} is out. You have ${update.current}.`
      case 'current':
        return `Up to date (${update.current})${update.checkedAt ? `, checked ${ago(update.checkedAt, Date.now())}` : ''}.`
      case 'offline':
        return 'Offline. Will check when you are back online.'
      case 'error':
        return `Could not check: ${update.error ?? 'no answer'}.`
      case 'off':
        return `Not checking. You have ${update.current}.`
      default:
        return `Checks a minute after launch. You have ${version ?? update.current}.`
    }
  })()
  return (
    <Section icon={<ArrowsClockwise size={14} weight="regular" />} name="Updates">
      <Switch
        label="Check for updates once a day"
        on={settings.checkForUpdates}
        onChange={(on) => void saveSettings({ checkForUpdates: on })}
      />
      <p className="setting-line">{status}</p>
      <div className="setting-actions">
        {update?.state === 'available' ? (
          <button type="button" className="setting-button is-primary" onClick={() => void window.grove?.openRelease()}>
            Download {update.latest}
          </button>
        ) : null}
        <button
          type="button"
          className="setting-button"
          disabled={!window.grove || checking}
          onClick={async () => {
            setChecking(true)
            await window.grove?.checkForUpdates()
            setChecking(false)
          }}
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <p className="setting-fine">
        Only asks GitHub for the newest version number. Nothing about you or your projects is sent. Your settings and
        grove live outside the app, so an update never touches them.
      </p>
    </Section>
  )
}

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
  const settings = useSettings()
  const saveError = useSettingsError()
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
      {saveError ? <p className="panel-error">{saveError}</p> : null}
      <Section icon={<Plugs size={14} weight="regular" />} name="AI tools">
        <ToolSetup />
      </Section>
      <Graphics settings={settings} />
      <Showing settings={settings} />
      <Notifications settings={settings} />
      <ClaudeLimits settings={settings} />
      <Updates settings={settings} />
      <LiveUpdates open={open} />
      <Uninstall open={open} />
    </aside>
  )
}

/**
 * Uninstall, at the bottom of Settings where nobody presses it by accident. Two steps: the first
 * lists exactly what will happen on this Mac, the second does it. Your grove is kept unless you tick
 * the box, and everything removed goes to the Trash.
 */
function Uninstall({ open }: { open: boolean }) {
  const [plan, setPlan] = useState<UninstallPlan | null>(null)
  const [removeGrove, setRemoveGrove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setPlan(null)
    setRemoveGrove(false)
    setError(null)
  }, [open])

  const review = async () => {
    if (!window.grove) return
    setError(null)
    setPlan(await window.grove.planUninstall())
  }

  const run = async () => {
    if (!window.grove) return
    setBusy(true)
    const result = await window.grove.uninstall({ removeGrove })
    setBusy(false)
    if (!result.ok) setError(result.error ?? 'Could not uninstall')
  }

  return (
    <Section icon={<Trash size={14} weight="regular" />} name="Uninstall">
      {plan ? (
        <>
          <p className="setting-line">This will:</p>
          <ul className="uninstall-steps">
            {plan.hooks ? <li>Take the Grove’s lines out of Claude Code’s settings (a backup is kept)</li> : null}
            <li>{plan.appPath ? 'Move Agentic Grove to the Trash and quit' : 'Quit (running from source, so there is no app to remove)'}</li>
            {removeGrove ? <li>Move your grove ({plan.grovePath}) to the Trash</li> : null}
          </ul>
          <Switch
            label="Also remove my grove"
            detail="Your list of projects, agents and settings. Keep it if you might come back."
            on={removeGrove}
            onChange={setRemoveGrove}
          />
          <p className="setting-fine">
            Your project folders, their files and sessions, and Claude Code and Codex themselves are never touched.
            Everything removed goes to the Trash, so it can be put back.
          </p>
          <div className="setting-actions">
            <button type="button" className="setting-button is-danger" onClick={() => void run()} disabled={busy}>
              {busy ? 'Uninstalling…' : 'Uninstall'}
            </button>
            <button type="button" className="setting-button" onClick={() => setPlan(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="setting-actions">
          <button type="button" className="setting-button" disabled={!window.grove} onClick={() => void review()}>
            Uninstall Agentic Grove…
          </button>
        </div>
      )}
      {error ? <p className="panel-error">{error}</p> : null}
    </Section>
  )
}

function LiveUpdates({ open }: { open: boolean }) {
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
  )
}
