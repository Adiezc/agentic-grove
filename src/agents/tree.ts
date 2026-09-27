/**
 * The agents in the tree: Researcher, plus whatever you have connected in `grove.json`.
 *
 * Two kinds, and the difference is the whole reason `kindOf` exists:
 *
 *   grove  Agents the Grove can *run*: Claude Code or Codex. They hang from the branches on a
 *          thread of light, because they belong to the tree and the tree can send them down the
 *          mycelium to a stone.
 *   bot    Grok Bots. Day-to-day coworkers that live in xAI's own app, with no API to create,
 *          task or watch them (checked September 2026, see the brief). They drift loose around
 *          the canopy like fireflies: visible, but not tied to anything the Grove controls, and
 *          they cannot be sent to a stone. Tapping one opens Grok. That is the brief's
 *          "launcher, not cockpit" distinction drawn as a picture rather than written as a label.
 *
 * Researcher is the one agent every grove starts with: everybody researches, so a new grove is
 * never empty of help, and it is Researcher who walks you through the grove the first time. It is
 * built in rather than written to `grove.json`, so it cannot be deleted by accident.
 *
 * **Where an orb hangs is worked out, not stored.** Each kind has a short list of places on the
 * canopy, read off the scene by eye, and agents take them in the order they grew. `grove.json`
 * stays intent, and removing an agent simply lets the ones after it move up a place.
 */
import { useMemo } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Asterisk, MagnifyingGlass, Spiral, X } from '@phosphor-icons/react'
import type { AgentDefinition, AgentGlyph, AgentHarness } from '../../core/state/schema.ts'
import { DEMO } from '../demo'
import { useGrove } from '../store/grove'
import { DEFAULT_GLYPH, GLYPHS } from './glyphs'

export type Harness = AgentHarness

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
  /** Where the orb hangs, in world units. Taken from the slot lists below. */
  at: [number, number, number]
  /** True for agents you connected, which you may also take away. False for Researcher. */
  own: boolean
}

export const HARNESS_MARK: Record<Harness, { Mark: Icon; label: string }> = {
  'claude-code': { Mark: Asterisk, label: 'Claude Code' },
  codex: { Mark: Spiral, label: 'Codex' },
  'grok-bot': { Mark: X, label: 'Grok Bot' },
}

export const kindOf = (agent: { harness: Harness }): 'grove' | 'bot' => (agent.harness === 'grok-bot' ? 'bot' : 'grove')

/**
 * Places on the branches, nearest the viewer first. The first is Researcher's, where the concept
 * art puts it. Seven in all: a bonsai with more lanterns than that stops reading as a tree.
 */
const HANGING: [number, number, number][] = [
  [-0.4, 4.35, 0.75],
  [-1.45, 3.75, 0.85],
  [0.75, 3.75, 0.95],
  [-1.2, 4.75, 0.6],
  [0.45, 4.3, 0.7],
  [-2.1, 3.55, 0.7],
  [0.0, 2.95, 1.0],
]

/** Places in the air round the canopy for Grok Bots, higher and further out than the branches. */
const DRIFTING: [number, number, number][] = [
  [1.25, 4.6, 0.4],
  [-2.1, 4.7, -0.2],
  [1.95, 5.15, -0.1],
  [-1.35, 5.45, 0.1],
  [0.55, 5.6, 0.2],
  [-0.3, 5.9, 0.1],
]

/** How many of each kind the tree has room for. The grow form says so when one is full. */
export const ROOM = { grove: HANGING.length, bot: DRIFTING.length }

/** Where the bud sits once every branch is taken: low and in front, out of every orb's way. */
const BUD_WHEN_FULL: [number, number, number] = [-0.8, 3.0, 1.0]

const RESEARCHER_DEF: AgentDefinition = {
  id: 'researcher',
  name: 'Researcher',
  description: 'Search, read and summarise.',
  harness: 'claude-code',
  glyph: 'search',
}

export const RESEARCHER = { name: RESEARCHER_DEF.name, Glyph: MagnifyingGlass }

/** Shown only in demo mode, so the two kinds can be judged side by side against the art. */
const EXAMPLES: AgentDefinition[] = [
  { id: 'builder', name: 'Builder', description: 'Write and change code.', harness: 'codex', glyph: 'build' },
  { id: 'inbox', name: 'Inbox', description: 'Sorts and answers email.', harness: 'grok-bot', glyph: 'mail' },
  { id: 'planner', name: 'Planner', description: 'Keeps the calendar.', harness: 'grok-bot', glyph: 'calendar' },
]

/**
 * Lay the definitions out on the tree. Pure, so the same list always hangs the same way.
 *
 * Anything past the room for its kind is left off rather than piled on the last place. The grow
 * form stops you getting there; this only matters for a hand-edited file, and `grove.json` still
 * has every entry.
 */
export function placeAgents(definitions: AgentDefinition[]): { agents: TreeAgent[]; bud: [number, number, number] } {
  let hanging = 0
  let drifting = 0
  const agents: TreeAgent[] = []
  for (const definition of definitions) {
    const bot = kindOf(definition) === 'bot'
    const at = bot ? DRIFTING[drifting++] : HANGING[hanging++]
    if (!at) continue
    const glyph: AgentGlyph = definition.glyph ?? DEFAULT_GLYPH
    agents.push({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      harness: definition.harness,
      Glyph: GLYPHS[glyph].Icon,
      // Nothing spawns yet, so nothing the Grove runs can be running. The demo shows the art's
      // "Running" on Researcher. A bot's state is unknowable, so it is null rather than false.
      running: bot ? null : DEMO && definition.id === 'researcher',
      at,
      own: definition.id !== 'researcher',
    })
  }
  return { agents, bud: HANGING[hanging] ?? BUD_WHEN_FULL }
}

const NO_AGENTS: AgentDefinition[] = []

/** The tree as it stands now: Researcher first, then your agents in the order they grew. */
export function useTree(): { agents: TreeAgent[]; bud: [number, number, number]; counts: { grove: number; bot: number } } {
  const connected = useGrove((state) => state.snapshot?.agents ?? NO_AGENTS)
  return useMemo(() => {
    const definitions = [RESEARCHER_DEF, ...(DEMO ? EXAMPLES : connected)]
    const placed = placeAgents(definitions)
    const counts = { grove: 0, bot: 0 }
    for (const definition of definitions) counts[kindOf(definition)] += 1
    return { ...placed, counts }
  }, [connected])
}
