/**
 * What the crystal is allowed to claim about usage, and how sure it is of each claim.
 *
 * Every figure carries its provenance, because the crystal's whole job is to be trusted at a
 * glance, and a glance cannot tell a number the provider reported from one we worked out. The
 * four words are the project's, from the brief:
 *
 * - `official`  the provider itself said so (Codex records what OpenAI's servers report).
 * - `measured`  counted by the Grove from records on this machine. Exact, but only for what the
 *               records cover, and with no limit to compare against.
 * - `estimate`  worked out from something indirect. Not used yet; here so the word is reserved.
 * - `unknown`   nobody told us. A dark facet, never a guess.
 */
export type Provenance = 'official' | 'measured' | 'estimate' | 'unknown'

/** The two windows every subscription meters: a rolling five hours, and a week. */
export type WindowKey = 'five_hour' | 'seven_day'

export interface UsageWindow {
  key: WindowKey
  provenance: Provenance
  /** Share of the limit used, 0 to 100. `null` whenever the limit itself is not known. */
  usedPercent: number | null
  /** Epoch ms when the provider says this window resets, or `null`. */
  resetsAt: number | null
  /** Tokens counted in this window, for `measured` figures. Cache reads are left out; see claude.ts. */
  tokens: number | null
  /** Epoch ms the figure was true at. An official figure is only as fresh as the last session. */
  observedAt: number | null
}

export interface ProviderUsage {
  /** Matches the harness ids, so the interface can pair a provider with its sessions. */
  provider: 'claude-code' | 'codex'
  name: string
  windows: UsageWindow[]
  /**
   * One plain sentence on why a figure is missing or partial. Shown on hover, so "unknown" is
   * never left unexplained.
   */
  note?: string
}

export interface UsageReport {
  /** Epoch ms the report was put together. */
  at: number
  providers: ProviderUsage[]
}
