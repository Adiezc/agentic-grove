/**
 * The crystal, top right: how much usage headroom is left.
 *
 * **Read at a glance, not in words.** A thin rim runs round the hexagon. Its left half is Claude
 * Code, its right half Codex. Where a provider reports a real limit, its half fills from the
 * bottom with the headroom that is left, and turns amber when less than a tenth remains, because
 * amber is the grove's one colour for "this needs you". Where the Grove can only count, the half
 * is a dotted line: activity is known, the limit is not, so there is nothing to fill. Where
 * nothing is known the half stays dark. A dark facet is better than one that lies.
 *
 * **The words live one step away.** Hovering or clicking opens a short readout with every figure
 * and where it came from (`official`, `measured`, `unknown`), because a gauge you cannot
 * question is a gauge you stop trusting.
 *
 * The rim is drawn as an SVG outline of the same hexagon the CSS clips the body to. It is a data
 * mark derived from that shape, not an icon, which is why it is not a Phosphor glyph.
 */
import { useState } from 'react'
import { LOW_HEADROOM, WINDOW_NAME, figure, source } from '../../core/usage/format.ts'
import type { ProviderUsage, UsageReport } from '../../core/usage/types.ts'
import { useGrove } from '../store/grove'

/*
 * The hexagon, in the body's own pixels (5rem by 6.8rem), matching the `clip-path` in hud.css:
 * points at 0/26/74/100 per cent of the height. The rim sits a little outside it.
 */
const W = 80
const H = 108.8
const RIM = 1.12
const centre = { x: W / 2, y: H / 2 }
const at = (x: number, y: number) => {
  const px = centre.x + (x - centre.x) * RIM
  const py = centre.y + (y - centre.y) * RIM
  return `${px.toFixed(1)},${py.toFixed(1)}`
}
// Both halves start at the bottom point and climb, so a partial fill reads as a level rising.
const LEFT = `M${at(W / 2, H)} L${at(0, H * 0.74)} L${at(0, H * 0.26)} L${at(W / 2, 0)}`
const RIGHT = `M${at(W / 2, H)} L${at(W, H * 0.74)} L${at(W, H * 0.26)} L${at(W / 2, 0)}`
const PAD = 8
const VIEW = `${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`

type Facet =
  | { kind: 'limit'; headroom: number; low: boolean }
  | { kind: 'counted' }
  | { kind: 'dark' }
  | { kind: 'absent' }

/** The tightest window decides the facet: a week at 95% matters more than five hours at 10%. */
function facetOf(provider: ProviderUsage | undefined): Facet {
  if (!provider) return { kind: 'absent' }
  const limited = provider.windows.filter((w) => w.provenance === 'official' && w.usedPercent !== null)
  if (limited.length) {
    const used = Math.max(...limited.map((w) => w.usedPercent ?? 0))
    const headroom = Math.max(0, 100 - used)
    return { kind: 'limit', headroom, low: headroom < LOW_HEADROOM }
  }
  if (provider.windows.some((w) => w.provenance === 'measured')) return { kind: 'counted' }
  return { kind: 'dark' }
}

function Half({ d, facet }: { d: string; facet: Facet }) {
  if (facet.kind === 'absent') return null
  return (
    <g className={`rim rim-${facet.kind}${facet.kind === 'limit' && facet.low ? ' is-low' : ''}`}>
      <path d={d} pathLength={100} className="rim-track" />
      {facet.kind === 'limit' && (
        <path d={d} pathLength={100} className="rim-fill" strokeDasharray={`${facet.headroom} 100`} />
      )}
    </g>
  )
}

function Readout({ report }: { report: UsageReport }) {
  const now = report.at
  return (
    <div className="crystal-readout-inner">
      {report.providers.map((provider) => (
        <section key={provider.provider} className="usage">
          <header className="usage-head">
            <p className="usage-name">{provider.name}</p>
            <p className="usage-source">{source(provider, now)}</p>
          </header>
          <dl className="usage-rows">
            {provider.windows.map((window) => (
              <div key={window.key} className={`usage-row prov-${window.provenance}`}>
                <dt>{WINDOW_NAME[window.key]}</dt>
                <dd>{figure(window, now)}</dd>
              </div>
            ))}
          </dl>
          {provider.note && <p className="usage-note">{provider.note}</p>}
        </section>
      ))}
    </div>
  )
}

function summary(report: UsageReport | null): string {
  if (!report) return 'Usage: reading'
  if (!report.providers.length) return 'Usage: no records found'
  return `Usage: ${report.providers.map((p) => `${p.name} ${source(p, report.at)}`).join(', ')}`
}

export function Crystal() {
  const report = useGrove((state) => state.snapshot?.usage ?? null)
  const [pinned, setPinned] = useState(false)
  const claude = report?.providers.find((p) => p.provider === 'claude-code')
  const codex = report?.providers.find((p) => p.provider === 'codex')

  return (
    <div className={`crystal${pinned ? ' is-pinned' : ''}`}>
      <span className="crystal-thread" aria-hidden="true" />
      <button
        type="button"
        className="crystal-button"
        aria-expanded={pinned}
        aria-label={summary(report)}
        onClick={() => setPinned((open) => !open)}
      >
        <span className="crystal-body">
          {/* The 256px copy, not the 1.6MB original: this renders at about 50px and the full
              resolution was being bundled whole. `assets/logo.png` stays the source of truth and
              is what the app icon will be cut from. */}
          <img src={new URL('../../assets/logo-mark.png', import.meta.url).href} alt="" className="crystal-mark" />
        </span>
        <svg className="crystal-rim" viewBox={VIEW} aria-hidden="true">
          <Half d={LEFT} facet={facetOf(claude)} />
          <Half d={RIGHT} facet={facetOf(codex)} />
        </svg>
      </button>
      <span className="crystal-drop" aria-hidden="true" />
      {report && report.providers.length > 0 && (
        <div className="crystal-readout" role="region" aria-label="Usage">
          <Readout report={report} />
        </div>
      )}
    </div>
  )
}
