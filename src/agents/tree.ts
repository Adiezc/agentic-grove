/**
 * The agents in the tree: the three built in, plus whatever you have connected in `grove.json`.
 *
 * Two kinds, and the difference is the whole reason `kindOf` exists:
 *
 *   grove  Agents the Grove can *run* on a project: Claude Code or Codex. They hang from the
 *          branches on a thread of light, because they belong to the tree and the tree can send
 *          them down the mycelium to a stone.
 *   bot    Everyday coworkers that live in their own company's app: ChatGPT Dots and Claude
 *          Cowork. Neither has an API to create, task or watch them (checked 30 September 2026).
 *          They drift loose around the canopy like fireflies: visible, but not tied to anything
 *          the Grove controls, and they cannot be sent to a stone. Tapping one opens its app.
 *          That is the brief's "launcher, not cockpit" distinction drawn as a picture.
 *
 * Every grove starts with three agents, built in rather than written to `grove.json` so they
 * cannot be deleted by accident:
 *
 *   Researcher  everybody researches. Also the one who walks you through the grove the first time.
 *   Builder     writes and changes code and files.
 *   Manager     the project manager. Decides which tool takes which job, from what you have
 *               connected and how much of each allowance is left. See `core/routing.ts`.
 *
 * **Where an orb hangs is worked out, not stored.** Each kind has a short list of places on the
 * canopy, read off the scene by eye, and agents take them in the order they grew. `grove.json`
 * stays intent, and removing an agent simply lets the ones after it move up a place.
 */
import { useMemo } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Asterisk, Compass, Hammer, MagnifyingGlass, OpenAiLogo, X } from '@phosphor-icons/react'
import { isLinkOnly, type AgentDefinition, type AgentGlyph, type AgentHarness } from '../../core/state/schema.ts'
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
  /** True for agents you connected, which you may also take away. False for the built-in three. */
  own: boolean
}

/**
 * The seal on an orb says which company's tool it is; the label says which product. Claude Code
 * and Claude Cowork share a seal, as Codex and ChatGPT Dots do, so the two companies read at a
 * glance and the product is one word away.
 */
export const HARNESS_MARK: Record<Harness, { Mark: Icon; label: string; opens?: string }> = {
  'claude-code': { Mark: Asterisk, label: 'Claude Code' },
  codex: { Mark: OpenAiLogo, label: 'Codex' },
  'chatgpt-dot': { Mark: OpenAiLogo, label: 'ChatGPT Dot', opens: 'ChatGPT' },
  'claude-cowork': { Mark: Asterisk, label: 'Claude Cowork', opens: 'Claude' },
  'grok-bot': { Mark: X, label: 'Grok Bot', opens: 'Grok' },
}

export const kindOf = (agent: { harness: Harness }): 'grove' | 'bot' => (isLinkOnly(agent.harness) ? 'bot' : 'grove')

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

/** Places in the air round the canopy for the fireflies, higher and further out than the branches. */
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

/**
 * The three every grove starts with. Their tool is the one you have: Claude Code if it is here,
 * otherwise Codex. The Manager's routing can still hand any job to the other when that is better.
 */
function builtIns(preferred: AgentHarness): AgentDefinition[] {
  return [
    { id: 'researcher', name: 'Researcher', description: 'Search, read and summarise.', harness: preferred, glyph: 'search' },
    { id: 'builder', name: 'Builder', description: 'Write and change code and files.', harness: preferred, glyph: 'build' },
    {
      id: 'manager',
      name: 'Manager',
      description: 'Plans the work and picks the right tool for each job.',
      harness: preferred,
      glyph: 'plan',
    },
  ]
}

export const RESEARCHER = { name: 'Researcher', Glyph: MagnifyingGlass }
export const BUILDER = { name: 'Builder', Glyph: Hammer }
export const MANAGER = { name: 'Manager', Glyph: Compass }

/** Shown only in demo mode, so the two kinds can be judged side by side against the art. */
const EXAMPLES: AgentDefinition[] = [
  { id: 'inbox', name: 'Inbox', description: 'Sorts and answers email.', harness: 'chatgpt-dot', glyph: 'mail' },
  { id: 'planner', name: 'Planner', description: 'Keeps the calendar.', harness: 'claude-cowork', glyph: 'calendar' },
]

const BUILT_IN = new Set(['researcher', 'builder', 'manager'])

/**
 * Lay the definitions out on the tree. Pure, so the same list always hangs the same way.
 *
 * Anything past the room for its kind is left off rather than piled on the last place. The grow
 * form stops you getting there; this only matters for a hand-edited file, and `grove.json` still
 * has every entry.
 */
export function placeAgents(
  definitions: AgentDefinition[],
  busy: ReadonlySet<string> = new Set()
): { agents: TreeAgent[]; bud: [number, number, number] } {
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
      // Running when a run it was sent on is working or asking right now. The demo shows the art's
      // "Running" on Researcher. A bot's state is unknowable, so it is null rather than false.
      running: bot ? null : DEMO ? definition.id === 'researcher' : busy.has(definition.id),
      at,
      own: !BUILT_IN.has(definition.id),
    })
  }
  return { agents, bud: HANGING[hanging] ?? BUD_WHEN_FULL }
}

const NO_AGENTS: AgentDefinition[] = []

/** The tree as it stands now: the built-in three first, then your agents in the order they grew. */
export function useTree(): { agents: TreeAgent[]; bud: [number, number, number]; counts: { grove: number; bot: number } } {
  const connected = useGrove((state) => state.snapshot?.agents ?? NO_AGENTS)
  const showFireflies = useGrove((state) => state.snapshot?.settings.showFireflies ?? true)
  // Claude Code unless only Codex is on this Mac. Read once per snapshot, so installing Codex later
  // and removing Claude Code moves the built-ins over without anyone editing a file.
  const preferred = useGrove((state): AgentHarness => {
    const found = state.snapshot?.harnesses
    const has = (id: string) => found?.some((harness) => harness.id === id && harness.detected) ?? false
    return !has('claude-code') && has('codex') ? 'codex' : 'claude-code'
  })
  // Which agents have a run working or waiting right now, as one string so the tree only
  // re-lays itself when that set changes, not on every snapshot.
  const busyKey = useGrove((state) =>
    (state.snapshot?.runs ?? [])
      .filter((run) => run.state === 'running' || run.state === 'waiting')
      .map((run) => run.agentId)
      .sort()
      .join(' ')
  )
  return useMemo(() => {
    const yours = (DEMO ? EXAMPLES : connected).filter((agent) => showFireflies || kindOf(agent) === 'grove')
    const definitions = [...builtIns(preferred), ...yours]
    const placed = placeAgents(definitions, new Set(busyKey.split(' ').filter(Boolean)))
    const counts = { grove: 0, bot: 0 }
    for (const definition of definitions) counts[kindOf(definition)] += 1
    return { ...placed, counts }
  }, [connected, preferred, showFireflies, busyKey])
}
