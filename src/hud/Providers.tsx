/**
 * The provider marks, top right: Claude and ChatGPT, and nothing else.
 *
 * **Five hours at a glance, the week on hover.** Each mark sits inside a thin ring that fills with
 * the share of the five-hour allowance still left, with the number under it, so you can read both
 * providers without moving the pointer. Hovering (or clicking, which pins it) opens the detail:
 * the week, when each window resets, which of the provider's products are here, and, for anything
 * missing, a button that sets it up.
 *
 * **Honest about what is known.** A ring is filled only from an `official` figure. Where the Grove
 * can only count tokens, the ring is dotted and the number is a dash; where nothing is known it
 * stays dark. Amber, the grove's one colour for "this needs you", appears when under a tenth is left.
 *
 * Grok Bots used to have a mark here. They were replaced by ChatGPT Dots on 30 September 2026, and
 * Dots live under the ChatGPT mark, so two marks cover everything the Grove works with.
 */
import { useEffect, useRef, useState } from 'react'
import { Asterisk, OpenAiLogo, type Icon } from '@phosphor-icons/react'
import { LOW_HEADROOM, compactTokens, until } from '../../core/usage/format.ts'
import type { ProviderUsage, UsageWindow } from '../../core/usage/types.ts'
import type { SetupStatus, SetupTool } from '../../core/setup.ts'
import { useGrove } from '../store/grove'

/** Headroom left in one window, or `null` when the limit is not known. */
function left(window: UsageWindow | undefined): number | null {
  if (!window || window.provenance !== 'official' || window.usedPercent === null) return null
  return Math.max(0, Math.round(100 - window.usedPercent))
}

const RING = 2 * Math.PI * 17

function Ring({ headroom, counted }: { headroom: number | null; counted: boolean }) {
  const low = headroom !== null && headroom < LOW_HEADROOM
  return (
    <svg className={`provider-ring${low ? ' is-low' : ''}${counted ? ' is-counted' : ''}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle className="ring-track" cx="20" cy="20" r="17" />
      {headroom !== null ? (
        <circle
          className="ring-fill"
          cx="20"
          cy="20"
          r="17"
          strokeDasharray={`${(headroom / 100) * RING} ${RING}`}
          transform="rotate(-90 20 20)"
        />
      ) : null}
    </svg>
  )
}

interface Product {
  name: string
  /** A short state: "Runs agents", "App installed", "Not set up". */
  state: string
  on: boolean
  setup?: SetupTool
}

interface ProviderSpec {
  key: 'claude' | 'chatgpt'
  name: string
  Mark: Icon
  usage: ProviderUsage | undefined
  products: Product[]
  /** Shown when nothing from this provider is on the Mac. */
  connect: string
}

function specs(usage: ProviderUsage[], setup: SetupStatus | undefined): ProviderSpec[] {
  const claude = setup?.['claude-code']
  const codex = setup?.codex
  return [
    {
      key: 'claude',
      name: 'Claude',
      Mark: Asterisk,
      usage: usage.find((p) => p.provider === 'claude-code'),
      products: [
        {
          name: 'Claude Code',
          state: claude?.cli ? 'Runs agents on your projects' : claude?.app ? 'In the Claude app' : 'Not set up',
          on: Boolean(claude?.cli || claude?.app),
          setup: claude?.cli ? undefined : 'claude-code',
        },
        { name: 'Cowork', state: claude?.app ? 'Everyday work, in the Claude app' : 'Needs the Claude app', on: Boolean(claude?.app) },
      ],
      connect: 'Set up Claude Code with one button below. It opens Terminal, installs, then asks you to sign in.',
    },
    {
      key: 'chatgpt',
      name: 'ChatGPT',
      Mark: OpenAiLogo,
      usage: usage.find((p) => p.provider === 'codex'),
      products: [
        {
          name: 'Codex',
          state: codex?.cli ? 'Runs agents on your projects' : 'Not set up',
          on: Boolean(codex?.cli),
          setup: codex?.cli ? undefined : 'codex',
        },
        {
          name: 'Dots',
          state: 'Always-on, in ChatGPT. Pro and Business plans. Does not use your limits',
          on: Boolean(codex?.app),
        },
      ],
      connect: 'Set up Codex with one button below. It opens Terminal, installs, then asks you to sign in with ChatGPT.',
    },
  ]
}

function Detail({ spec, now }: { spec: ProviderSpec; now: number }) {
  const [message, setMessage] = useState<string | null>(null)
  const five = spec.usage?.windows.find((w) => w.key === 'five_hour')
  const week = spec.usage?.windows.find((w) => w.key === 'seven_day')
  const line = (window: UsageWindow | undefined) => {
    const headroom = left(window)
    if (headroom !== null) return `${headroom}% left${window?.resetsAt ? `, ${until(window.resetsAt, now)}` : ''}`
    if (window?.tokens != null) return `${compactTokens(window.tokens)} counted`
    return 'unknown'
  }
  const setUp = async (tool: SetupTool) => {
    const result = await window.grove?.setUpTool(tool)
    if (!result) setMessage('Setup needs the app, not a browser tab.')
    else if (!result.ok) setMessage(result.error ?? 'Could not start setup')
    else setMessage(result.opened === 'page' ? 'Opened the install page in your browser.' : 'Follow the steps in Terminal.')
  }
  const anything = spec.products.some((product) => product.on)
  return (
    <div className="provider-detail" role="region" aria-label={`${spec.name} usage`}>
      <p className="usage-name">{spec.name}</p>
      <dl className="usage-rows">
        <div className="usage-row">
          <dt>5 hours</dt>
          <dd>{line(five)}</dd>
        </div>
        <div className="usage-row">
          <dt>This week</dt>
          <dd>{line(week)}</dd>
        </div>
      </dl>
      {spec.usage?.note ? <p className="usage-note">{spec.usage.note}</p> : null}
      <ul className="provider-products">
        {spec.products.map((product) => (
          <li key={product.name} className={product.on ? 'is-on' : ''}>
            <span className="product-dot" aria-hidden="true" />
            <span className="product-name">{product.name}</span>
            <span className="product-state">{product.state}</span>
            {product.setup ? (
              <button type="button" className="setting-button product-setup" onClick={() => void setUp(product.setup!)}>
                Set up
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!anything ? <p className="usage-note">{spec.connect}</p> : null}
      {message ? <p className="usage-note">{message}</p> : null}
    </div>
  )
}

function ProviderMark({ spec }: { spec: ProviderSpec }) {
  const [pinned, setPinned] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const now = Date.now()
  const five = spec.usage?.windows.find((w) => w.key === 'five_hour')
  const headroom = left(five)
  const counted = headroom === null && five?.provenance === 'measured'
  const connected = spec.products.some((product) => product.on)

  // Same rule as the crystal: a click pins the detail, a click anywhere else or Esc lets go.
  useEffect(() => {
    if (!pinned) return
    const release = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node)) return
      setPinned(false)
    }
    document.addEventListener('pointerdown', release, true)
    document.addEventListener('keydown', release)
    return () => {
      document.removeEventListener('pointerdown', release, true)
      document.removeEventListener('keydown', release)
    }
  }, [pinned])

  const figure = headroom !== null ? `${headroom}%` : '–'
  const label =
    headroom !== null
      ? `${spec.name}: ${headroom}% of five hours left`
      : connected
        ? `${spec.name}: five-hour allowance not known`
        : `${spec.name}: not connected`

  return (
    <div ref={root} className={`provider${pinned ? ' is-pinned' : ''}${connected ? ' is-on' : ''}`}>
      <button
        type="button"
        className="provider-button"
        aria-expanded={pinned}
        aria-label={label}
        onClick={(event) => {
          if (pinned) event.currentTarget.blur()
          setPinned(!pinned)
        }}
      >
        <span className="provider-mark">
          <Ring headroom={headroom} counted={counted} />
          <spec.Mark size={17} weight="regular" />
        </span>
        <span className={`provider-figure${headroom !== null && headroom < LOW_HEADROOM ? ' is-low' : ''}`}>{figure}</span>
      </button>
      <Detail spec={spec} now={now} />
    </div>
  )
}

const NO_USAGE: ProviderUsage[] = []

export function Providers() {
  const usage = useGrove((state) => state.snapshot?.usage?.providers ?? NO_USAGE)
  const setup = useGrove((state) => state.snapshot?.setup)
  return (
    <div className="providers" role="list" aria-label="AI providers">
      {specs(usage, setup).map((spec) => (
        <div role="listitem" key={spec.key}>
          <ProviderMark spec={spec} />
        </div>
      ))}
    </div>
  )
}
