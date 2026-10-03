/**
 * Three stages of a grove's life, for the README's demo animation: `?demo&stage=1`, `2` or `3`.
 *
 * Plain `?demo` stays the concept art's six stones, for judging the scene against the art. The
 * stages exist to show how the grove looks as it is used, from the first day to a full one:
 *
 *   1  Day one. Two projects, PM at work on one, the empty circles waiting.
 *   2  A few weeks in. Six projects, one waiting for you, a reviewer you added, a firefly.
 *   3  A full grove. Every home place taken and rows further back, sub-stones and twins, a team
 *      on the branches, several stones waiting or failing at once. The grove under load.
 *
 * Pretend data, like the rest of demo mode, and never shown outside it.
 */
import type { AgentDefinition } from '../core/state/schema.ts'
import type { Pairing } from '../core/state/pairings.ts'
import { DEMO } from './demo'
import type { StoneSpec } from './scene/Runestone'
import { childPlace, placeAt, twinPlace } from './scene/layout'

export type Stage = 1 | 2 | 3

const asked = Number(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('stage'))
export const STAGE: Stage | null = DEMO && (asked === 1 || asked === 2 || asked === 3) ? asked : null

export interface StageGrove {
  stones: StoneSpec[]
  /** Who is shown working on each stone, by agent id. */
  workers: Record<string, string[]>
  pairs: Pairing[]
  /** Agents beyond the built-in three. */
  agents: AgentDefinition[]
  /** The counter's saved tasks. */
  tasks: number
  /** Place numbers already taken, so the empty circles show only where a new grove has them. */
  used: number[] | null
}

const ago = (minutes: number) => Date.now() - minutes * 60_000

const REVIEWER: AgentDefinition = { id: 'reviewer', name: 'Reviewer', description: 'Reads every change before it ships.', harness: 'claude-code', glyph: 'review' }
const INBOX: AgentDefinition = { id: 'inbox', name: 'Inbox', description: 'Sorts and answers email.', harness: 'chatgpt-dot', glyph: 'mail' }
const PLANNER: AgentDefinition = { id: 'planner', name: 'Planner', description: 'Keeps the calendar.', harness: 'claude-cowork', glyph: 'calendar' }

function dayOne(): StageGrove {
  return {
    stones: [
      { id: 'site', name: 'Website', rune: 'anm', status: 'running', at: placeAt(0), scale: 0.96, turn: 0.14 },
      { id: 'notes', name: 'Notes', rune: 'neta', status: 'idle', at: placeAt(1), scale: 0.92, turn: -0.16 },
    ],
    workers: { site: ['manager'] },
    pairs: [],
    agents: [],
    tasks: 1,
    used: [0, 1],
  }
}

function fewWeeks(): StageGrove {
  return {
    stones: [
      { id: 'site', name: 'Website', rune: 'anm', status: 'running', at: placeAt(0), scale: 0.96, turn: 0.14 },
      { id: 'notes', name: 'Notes', rune: 'neta', status: 'idle', at: placeAt(1), scale: 0.92, turn: -0.16 },
      { id: 'app', name: 'App', rune: 'celi', status: 'running', at: placeAt(2), scale: 1.04, turn: 0.09 },
      { id: 'api', name: 'API', rune: 'mucoi', status: 'waiting', at: placeAt(3), scale: 1.02, turn: -0.13 },
      { id: 'data', name: 'Data', rune: 'maqi', status: 'idle', at: placeAt(4), scale: 1.0, turn: -0.22 },
      { id: 'docs', name: 'Docs', rune: 'avi', status: 'idle', at: placeAt(5), scale: 0.98, turn: -0.18 },
    ],
    workers: { site: ['manager', 'builder'], app: ['builder'], api: ['reviewer'] },
    pairs: [{ a: 'app', b: 'api', hours: 5, freshness: 1 }],
    agents: [REVIEWER, INBOX],
    tasks: 9,
    used: null,
  }
}

function fullGrove(): StageGrove {
  const names: [string, string, StoneSpec['rune'], StoneSpec['status']][] = [
    ['site', 'Website', 'anm', 'running'],
    ['notes', 'Notes', 'neta', 'idle'],
    ['app', 'App', 'celi', 'running'],
    ['api', 'API', 'mucoi', 'waiting'],
    ['data', 'Data', 'maqi', 'running'],
    ['docs', 'Docs', 'avi', 'idle'],
    ['shop', 'Shop', 'koi', 'running'],
    ['infra', 'Infra', 'maqi', 'errored'],
    ['mobile', 'Mobile', 'celi', 'running'],
    ['design', 'Design', 'anm', 'idle'],
    ['billing', 'Billing', 'mucoi', 'waiting'],
    ['research', 'Research', 'neta', 'running'],
    ['blog', 'Blog', 'avi', 'idle'],
    ['tools', 'Tools', 'koi', 'idle'],
    ['archive', 'Archive', 'maqi', 'idle'],
    ['labs', 'Labs', 'celi', 'running'],
  ]
  const stones: StoneSpec[] = names.map(([id, name, rune, status], index) => ({
    id,
    name,
    rune,
    status,
    at: placeAt(index),
    scale: 0.9 + ((index * 37) % 15) / 100,
    turn: ((index % 2 ? -1 : 1) * (8 + ((index * 13) % 14))) / 100,
    ...(id === 'infra' ? { tells: [{ kind: 'repeated-failure' as const, at: ago(6), detail: 'Bash failed 3 times in a row' }] } : {}),
  }))
  const appAt = placeAt(2)
  const siteAt = placeAt(0)
  stones.push(
    { id: 'app/ios', name: 'iOS', rune: 'avi', status: 'running', at: childPlace(appAt, 0), scale: 0.74, turn: 0.1, parent: 'app' },
    { id: 'app/web', name: 'Web', rune: 'neta', status: 'idle', at: childPlace(appAt, 1), scale: 0.72, turn: -0.12, parent: 'app' },
    { id: 'site-redesign', name: 'redesign', branch: 'redesign', rune: 'koi', status: 'running', at: twinPlace(siteAt, 0), scale: 0.84, turn: -0.08, parent: 'site', twin: true }
  )
  return {
    stones,
    workers: {
      site: ['manager'],
      'site-redesign': ['builder'],
      app: ['manager', 'researcher'],
      'app/ios': ['builder'],
      data: ['analyst'],
      shop: ['builder', 'tester'],
      mobile: ['tester'],
      research: ['researcher', 'writer'],
      labs: ['builder'],
      api: ['reviewer'],
      billing: ['builder'],
    },
    pairs: [
      { a: 'app', b: 'api', hours: 9, freshness: 1 },
      { a: 'shop', b: 'billing', hours: 6, freshness: 1 },
      { a: 'data', b: 'research', hours: 4, freshness: 0.8 },
      { a: 'site', b: 'design', hours: 2, freshness: 0.5 },
      { a: 'mobile', b: 'app', hours: 3, freshness: 0.7 },
    ],
    agents: [
      REVIEWER,
      { id: 'tester', name: 'Tester', description: 'Writes and runs the tests.', harness: 'claude-code', glyph: 'spark' },
      { id: 'writer', name: 'Writer', description: 'Docs, release notes and posts.', harness: 'claude-code', glyph: 'write' },
      { id: 'analyst', name: 'Analyst', description: 'Numbers and dashboards.', harness: 'codex', glyph: 'data' },
      INBOX,
      PLANNER,
      { id: 'scout', name: 'Scout', description: 'Watches the news every morning.', harness: 'chatgpt-dot', glyph: 'search' },
    ],
    tasks: 41,
    used: null,
  }
}

export const STAGE_GROVE: StageGrove | null = STAGE === 1 ? dayOne() : STAGE === 2 ? fewWeeks() : STAGE === 3 ? fullGrove() : null
