/**
 * The words `grove.json` uses for an agent's glyph, and the icon each one draws.
 *
 * The words live in `core/state/schema.ts` so the file can be checked without the interface. The
 * icons live here because `core/` never imports anything that draws. A `Record` over the word list
 * means adding a word there and forgetting it here is a type error, not a blank orb.
 */
import type { Icon } from '@phosphor-icons/react'
import {
  CalendarBlank,
  ChartLineUp,
  Compass,
  Eye,
  Hammer,
  MagnifyingGlass,
  PencilSimpleLine,
  Sparkle,
  Tray,
} from '@phosphor-icons/react'
import { AGENT_GLYPHS, type AgentGlyph } from '../../core/state/schema.ts'

export const GLYPHS: Record<AgentGlyph, { Icon: Icon; label: string }> = {
  search: { Icon: MagnifyingGlass, label: 'Research' },
  build: { Icon: Hammer, label: 'Build' },
  plan: { Icon: Compass, label: 'Plan' },
  review: { Icon: Eye, label: 'Review' },
  write: { Icon: PencilSimpleLine, label: 'Write' },
  data: { Icon: ChartLineUp, label: 'Data' },
  mail: { Icon: Tray, label: 'Mail' },
  calendar: { Icon: CalendarBlank, label: 'Calendar' },
  spark: { Icon: Sparkle, label: 'General' },
}

/** In the order the grow form offers them. */
export const GLYPH_CHOICES: readonly AgentGlyph[] = AGENT_GLYPHS

/** An agent written by hand without a glyph gets the plain one rather than nothing. */
export const DEFAULT_GLYPH: AgentGlyph = 'spark'
