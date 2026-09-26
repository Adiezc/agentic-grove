/**
 * The agents in the tree, until `grove.json` holds real ones (session eight).
 *
 * Two kinds, and the difference is the whole reason this file has a `kind` field:
 *
 *   grove  Agents the Grove can *run*: Claude Code, Codex, or a model we hold an API key for.
 *          They hang from the branches on a thread of light, because they belong to the tree
 *          and the tree can send them down the mycelium to a stone.
 *   bot    Grok Bots. Day-to-day coworkers that live in xAI's own app, with no API to create,
 *          task or watch them (checked September 2026, see the brief). They drift loose around
 *          the canopy like fireflies: visible, but not tied to anything the Grove controls, and
 *          they cannot be sent to a stone. Tapping one opens Grok. That is the brief's
 *          "launcher, not cockpit" distinction drawn as a picture rather than written as a label.
 *
 * Researcher is the one agent every grove starts with: everybody researches, so a new grove is
 * never empty of help, and it is Researcher who walks you through the grove the first time. The
 * heavier agents arrive when you connect Claude Code or Codex, and the fireflies when you connect
 * Grok Bots. The examples below appear only in demo mode, so the two kinds can be judged side by
 * side against the art.
 */
import type { Icon } from '@phosphor-icons/react'
import { DEMO } from '../demo'
import { Asterisk, CalendarBlank, Hammer, MagnifyingGlass, Spiral, Tray, X } from '@phosphor-icons/react'

export type Harness = 'claude-code' | 'codex' | 'grok-bot'

export interface TreeAgent {
  id: string
  name: string
  /** One line. The grove is not wordy. */
  description: string
  harness: Harness
  /** What the agent does, as a glyph. The orb's face. */
  Glyph: Icon
  /** Only a grove agent has a live state the Grove can know. A bot's is `null`: unknown, honestly. */
  running: boolean | null
  /** Where the orb hangs, in world units. Read off the canopy by eye; see `Canopy.tsx`. */
  at: [number, number, number]
}

export const HARNESS_MARK: Record<Harness, { Mark: Icon; label: string }> = {
  'claude-code': { Mark: Asterisk, label: 'Claude Code' },
  codex: { Mark: Spiral, label: 'Codex' },
  'grok-bot': { Mark: X, label: 'Grok Bot' },
}

export const kindOf = (agent: TreeAgent): 'grove' | 'bot' => (agent.harness === 'grok-bot' ? 'bot' : 'grove')

export const RESEARCHER: TreeAgent = {
  id: 'researcher',
  name: 'Researcher',
  description: 'Search, read and summarise.',
  harness: 'claude-code',
  Glyph: MagnifyingGlass,
  // Nothing spawns yet, so nothing it runs can be running. The demo shows the art's "Running".
  running: DEMO,
  at: [-0.4, 4.35, 0.75],
}

const EXAMPLES: TreeAgent[] = [
  {
    id: 'builder',
    name: 'Builder',
    description: 'Write and change code.',
    harness: 'codex',
    Glyph: Hammer,
    running: false,
    at: [-1.45, 3.75, 0.85],
  },
  {
    id: 'inbox',
    name: 'Inbox',
    description: 'Sorts and answers email.',
    harness: 'grok-bot',
    Glyph: Tray,
    running: null,
    at: [1.25, 4.6, 0.4],
  },
  {
    id: 'planner',
    name: 'Planner',
    description: 'Keeps the calendar.',
    harness: 'grok-bot',
    Glyph: CalendarBlank,
    running: null,
    at: [-2.1, 4.7, -0.2],
  },
]

export const TREE_AGENTS: TreeAgent[] = DEMO ? [RESEARCHER, ...EXAMPLES] : [RESEARCHER]

/** Where the empty bud hangs: the place a new agent will grow. */
export const BUD_AT: [number, number, number] = [0.75, 3.75, 0.95]
