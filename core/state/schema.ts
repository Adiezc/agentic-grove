/**
 * The shape of `grove.json` — the only file the Grove writes, anywhere.
 *
 * Two rules govern what belongs in here, and they are the whole design:
 *
 * **1. It stores intent, not state.** Runestones are *derived* from the sessions actually on
 * disk, every scan, by `stones.ts`. This file holds only what you have decided: that a stone is
 * hidden, that it should be called something else, the runes carved on it, the agent definitions
 * in the tree. Start a session in a new repository and a stone appears without anything being
 * written; nothing has to be kept in step, and there is no stale-record class of bug at all.
 *
 * **2. A person has to be able to edit it by hand.** The brief asks for this outright, so every
 * field is named for what it means rather than for how it is stored, there are no ids that
 * cannot be read aloud, and nothing in here is a cache. If a field would be annoying to type,
 * that is a sign it does not belong.
 *
 * What is deliberately *not* here: sessions, statuses, timestamps, token counts, anything
 * derived, and wisps. A wisp is one-off work with no project home — it spawns at the trunk,
 * glows, delivers and fades. Persisting one would be a contradiction; the grove would fill with
 * debris from work that is already finished.
 */

/** Bumped only when a change cannot be read by an older build. Nothing migrates below 1. */
import { MAX_NOTE_CHARS, NOTE_PLACES, type CarvedNote, type NotePlace } from './notes.ts'

export const GROVE_SCHEMA_VERSION = 1

/**
 * A saved, repeatable task carved on one stone.
 *
 * This is the answer to "a thing I do every week" — it becomes a rune on the project's stone
 * rather than a new stone of its own, which is what keeps the scene from filling with scenery.
 * Small enough to write by hand in ten seconds, which is the test it had to pass.
 */
export interface Rune {
  /** Short, kebab-case, yours to choose. Used to invoke it and to keep a schedule against it. */
  id: string
  /** What it is called on the stone. */
  name: string
  /** Which agent definition runs it — an `id` from `agents` below. */
  agent: string
  /** What to ask. The one field that actually does the work. */
  prompt: string
  /**
   * Optional cron expression. The data model carries it from day one so that turning scheduling
   * on later is a setting rather than a migration — but v1 does not run schedules, by decision.
   */
  schedule?: string
}

/**
 * Something you have decided about one project's stone.
 *
 * Keyed on `path`, never on name: two checkouts of the same repository have the same name and
 * are different projects, and a name can be changed by moving a folder while the stone should
 * stay the same stone.
 *
 * Every field but `path` is optional, because a stone you have no opinion about does not need an
 * entry here at all. An empty `stones` array is the normal state of a healthy grove.
 */
export interface StoneConfig {
  /** Absolute path to the project root. The stone's identity. */
  path: string
  /** Override the folder name. Only worth setting when the folder name is unhelpful. */
  name?: string
  /** Keep this project out of the grove entirely. Its sessions still exist; they are just not drawn. */
  hidden?: boolean
  /**
   * Send this project's sessions to the Wildwood instead of giving it a stone of its own.
   *
   * For work that is real but has no home worth a monolith — scratch workspaces, one-off
   * sessions run from your home directory. See `WILDWOOD_PATTERNS` in `stones.ts` for the ones
   * the Grove assumes without being told.
   */
  wildwood?: boolean
  /** Repeatable tasks bound to this project. */
  runes?: Rune[]
  /**
   * Suggested runes you said no to, as matching keys (see `core/state/suggest-runes.ts`). Kept so
   * the same suggestion is never offered twice. Delete a line to be asked again.
   */
  declinedRunes?: string[]
  /**
   * Which numbered place in the grove the stone stands on, from 0. Written when the project is
   * connected, so the stone never moves when others come and go. See `core/state/places.ts`.
   */
  place?: number
}

/**
 * Which tool an agent in the tree belongs to, and so what the Grove can do with it.
 *
 * Two families, and the difference is what the Grove can honestly do:
 *
 *   claude-code, codex   Agents that work *in your folders*. They hang from the branches and can
 *                        be sent to a stone, because both have a local program the Grove can run.
 *   chatgpt-dot          OpenAI's always-on agents (Dots, announced 29 September 2026). They live
 *                        in ChatGPT's cloud with no API, so the Grove opens them and nothing else.
 *   claude-cowork        Claude's everyday coworker in the Claude app. Also cloud-only, also opened.
 *   grok-bot             xAI's bots. Kept so older files still load; no longer offered, because
 *                        far more people use ChatGPT and Claude (Adrian's call, 30 September 2026).
 *
 * The link-only ones drift round the canopy as fireflies. See `LINK_HARNESSES`.
 */
export type AgentHarness = 'claude-code' | 'codex' | 'chatgpt-dot' | 'claude-cowork' | 'grok-bot'
export const AGENT_HARNESSES: readonly AgentHarness[] = ['claude-code', 'codex', 'chatgpt-dot', 'claude-cowork', 'grok-bot']

/** Tools the Grove can only open in their own app. Everything else it can run on a project. */
export const LINK_HARNESSES: readonly AgentHarness[] = ['chatgpt-dot', 'claude-cowork', 'grok-bot']
export const isLinkOnly = (harness: AgentHarness): boolean => LINK_HARNESSES.includes(harness)

/**
 * The glyph on an agent's orb: what it does, at a glance.
 *
 * Words rather than icon names, so a person editing the file by hand can guess them, and so
 * `core/` stays free of anything the interface draws with. The renderer maps each word to an icon
 * in `src/agents/glyphs.ts`; a word it does not know is reported here rather than drawn blank.
 */
export const AGENT_GLYPHS = ['search', 'build', 'plan', 'review', 'write', 'data', 'mail', 'calendar', 'spark'] as const
export type AgentGlyph = (typeof AGENT_GLYPHS)[number]

/** Where a link-only agent's orb goes when it has no link of its own. */
export const LINK_HOME: Record<string, string> = {
  'chatgpt-dot': 'https://chatgpt.com',
  'claude-cowork': 'https://claude.ai',
  'grok-bot': 'https://grok.com',
}

/**
 * PM, Researcher and Builder are built into every grove and are not written here, so no
 * definition may take their ids. If one did, `Rune.agent: "builder"` would mean two different
 * agents depending on who asked.
 */
export const BUILT_IN_AGENT_IDS = ['researcher', 'builder', 'manager'] as const

/**
 * An agent definition — one of the shapes living in the world tree.
 *
 * Note what this is not: a session. The tree holds *definitions*, and sending one to a runestone
 * *spawns* a session there. A definition is reusable across every project; a session is bound to
 * one working directory forever. Blurring those two is the mistake the mycelium metaphor exists
 * to avoid, so the types cannot be confused.
 *
 * Where the orb hangs is deliberately not stored. It is worked out from the agent's place in this
 * list, so the file stays intent and never has to be kept in step with the scene.
 */
export interface AgentDefinition {
  /** Short, kebab-case. Referenced by `Rune.agent`. */
  id: string
  /** "Researcher", "Builder", "Reviewer". What it is called in the tree. */
  name: string
  /** One line, shown when the definition is selected. Keep it short; the grove is not wordy. */
  description: string
  /** Which tool runs it. Missing in a hand-written entry means Claude Code, the common case. */
  harness: AgentHarness
  /** The face on its orb. Missing means the interface picks a plain one. */
  glyph?: AgentGlyph
  /** Link-only agents only: the page their orb opens. Must be https. Missing means `LINK_HOME`. */
  link?: string
  /** Model to run it on. Empty means "whatever the harness defaults to" — never a guess. */
  model?: string
  /** Prepended to every prompt this agent runs. Optional. */
  systemPrompt?: string
}

/** Long enough for a page of instructions; a limit so a pasted file does not end up in `grove.json`. */
export const MAX_BRIEF_CHARS = 4000

/**
 * Which Claude plan's limits the crystal should be drawn against.
 *
 * The default is Pro. The others are here as constants from the start so that anyone else can use
 * this without editing code, which is the difference between an open-source project and a
 * personal one that happens to be public.
 */
export type ClaudePlan = 'pro' | 'max-5x' | 'max-20x'

/**
 * How much the scene draws. Named for what you get rather than for the machine:
 *
 *   performance  no reflections, no bloom, and the frame rate held at 60. For slower Macs.
 *   balanced     half-resolution reflections and bloom. Close to the full look for about half the cost.
 *   grove        everything, at whatever refresh rate the screen runs (60, or 120 on ProMotion).
 */
export type GraphicsMode = 'performance' | 'balanced' | 'grove'
export const GRAPHICS_MODES: readonly GraphicsMode[] = ['performance', 'balanced', 'grove']

/**
 * Settings live in `grove.json` under the home folder, never inside the app, so an update replaces
 * the app and leaves every one of these as you left it.
 */
export interface GroveSettings {
  claudePlan: ClaudePlan
  /**
   * How often to re-scan, in milliseconds.
   *
   * Five seconds is comfortable: a pass costs 25–70ms on a real machine, so the loop is idle
   * more than 99% of the time. This exists because somebody with forty projects and very large
   * transcripts may want it slower, not because the default is in doubt.
   */
  scanIntervalMs: number
  /** The scene's detail. See `GraphicsMode`. */
  graphics: GraphicsMode
  /**
   * Step the graphics down on their own when the Mac is busy or the frame rate drops, and back up
   * when it recovers. Never above the mode you chose. Off means exactly your mode, always.
   */
  adaptiveGraphics: boolean
  /** Ask GitHub once a day whether a newer Grove has been released. Nothing else is sent. */
  checkForUpdates: boolean
  /** The link-only coworkers drifting round the canopy (ChatGPT Dots, Claude Cowork). */
  showFireflies: boolean
  /** The three counts in the bottom-left corner. */
  showCounts: boolean
  /** Every stone's name, all the time, instead of on hover. */
  alwaysShowNames: boolean
  /** The motes drifting through the air. Purely atmosphere; off saves a little work. */
  ambientMotion: boolean
  /**
   * After five quiet minutes the camera turns slowly round the grove, for a screen left on. Any
   * movement brings the view home. Never while something needs you.
   */
  idleDrift: boolean
  /**
   * When nothing is running and you have not touched the window for a few seconds, draw 8 frames
   * a second instead of 60. Measured on 3 October 2026: a visible, idle grove cost two-thirds of a
   * CPU core at full rate. Any movement, or any work starting, brings full speed straight back.
   */
  quietWhenIdle: boolean
  /** A macOS notification when an agent you sent finishes a job that took a minute or more. */
  notifyFinished: boolean
  /** A macOS notification when an agent you sent is waiting on you. Off by default: amber is enough. */
  notifyNeedsYou: boolean
  /**
   * Allow "Check now" to read Claude's official limits by running your own Claude Code once. Off by
   * default, because each check sends one small request on your plan. See `core/usage/probe.ts`.
   */
  officialClaudeLimits: boolean
}

/** The settings a brand-new grove starts with. One place, so the loader and the default agree. */
export function defaultSettings(): GroveSettings {
  return {
    claudePlan: 'pro',
    scanIntervalMs: 5000,
    graphics: 'grove',
    adaptiveGraphics: true,
    checkForUpdates: true,
    showFireflies: true,
    showCounts: true,
    alwaysShowNames: false,
    ambientMotion: true,
    idleDrift: true,
    quietWhenIdle: true,
    notifyFinished: true,
    notifyNeedsYou: false,
    officialClaudeLimits: false,
  }
}

/** The on-off settings, listed once so the loader and the settings form share one list. */
export const SETTING_SWITCHES = [
  'adaptiveGraphics',
  'checkForUpdates',
  'showFireflies',
  'showCounts',
  'alwaysShowNames',
  'ambientMotion',
  'idleDrift',
  'quietWhenIdle',
  'notifyFinished',
  'notifyNeedsYou',
  'officialClaudeLimits',
] as const satisfies readonly (keyof GroveSettings)[]

export interface GroveFile {
  version: number
  settings: GroveSettings
  /** Only projects you have an opinion about. Normally empty. */
  stones: StoneConfig[]
  /** The agents you have connected to the tree, in the order they grew. Researcher is built in and not listed. */
  agents: AgentDefinition[]
  /** Notes to your future self, waiting on a stone, an agent or the tree. See `notes.ts`. */
  notes: CarvedNote[]
}

/**
 * A brand-new grove.
 *
 * Deliberately almost empty. Everything visible on first launch should come from the sessions
 * already on the machine, so that opening the Grove for the first time shows you your own work
 * rather than a sample project and an onboarding tour.
 */
export function defaultGrove(): GroveFile {
  return {
    version: GROVE_SCHEMA_VERSION,
    settings: defaultSettings(),
    stones: [],
    agents: [],
    notes: [],
  }
}

/* -------------------------------------------------------------------------------------------
 * Reading a file a person may have edited by hand
 * ---------------------------------------------------------------------------------------- */

/**
 * What went wrong while reading `grove.json`, in a sentence the person who typed it can act on.
 *
 * The Grove never refuses to start because this file is malformed, and it never silently
 * rewrites it either. A bad entry is dropped, the reason is collected here, and the interface
 * says so — because the alternatives are both bad: crashing on a stray comma loses you the whole
 * grove, and quietly "fixing" the file throws away what you meant to say.
 */
export interface GroveProblem {
  /** Where in the file, in terms a person can find: `stones[2].path`. */
  where: string
  message: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Turn whatever was in the file into a valid `GroveFile`, keeping everything that makes sense
 * and reporting everything that does not.
 *
 * Written as one function rather than reached for a validation library on purpose: this is the
 * only untrusted input the Grove has, the rules are a page long, and a stack trace from a schema
 * library is no use to somebody who mistyped a path in a text editor.
 */
export function parseGrove(raw: unknown): { grove: GroveFile; problems: GroveProblem[] } {
  const problems: GroveProblem[] = []
  const grove = defaultGrove()
  if (!isRecord(raw)) {
    if (raw !== null && raw !== undefined) {
      problems.push({ where: 'grove.json', message: 'The top level should be an object, like { }.' })
    }
    return { grove, problems }
  }

  const version = Number(raw.version)
  if (Number.isFinite(version) && version > GROVE_SCHEMA_VERSION) {
    // Forwards rather than backwards: a newer file read by an older build. Better to say so than
    // to drop every field this build does not recognise and look like data loss.
    problems.push({
      where: 'version',
      message: `This file was written by a newer version of the Grove (schema ${version}, this build understands ${GROVE_SCHEMA_VERSION}). Some settings may be ignored.`,
    })
  }

  if (isRecord(raw.settings)) {
    const plan = asString(raw.settings.claudePlan)
    if (plan) {
      if (plan === 'pro' || plan === 'max-5x' || plan === 'max-20x') {
        grove.settings.claudePlan = plan
      } else {
        problems.push({
          where: 'settings.claudePlan',
          message: `"${plan}" is not a plan. Use "pro", "max-5x" or "max-20x".`,
        })
      }
    }
    const interval = Number(raw.settings.scanIntervalMs)
    // A floor, because a hand-typed 50 would spin the disk continuously for no visible gain.
    if (Number.isFinite(interval) && interval >= 1000) {
      grove.settings.scanIntervalMs = interval
    } else if (raw.settings.scanIntervalMs !== undefined) {
      problems.push({
        where: 'settings.scanIntervalMs',
        message: 'Should be a number of milliseconds, at least 1000. Keeping the default of 5000.',
      })
    }
    const graphics = asString(raw.settings.graphics)
    if (graphics) {
      if ((GRAPHICS_MODES as readonly string[]).includes(graphics)) grove.settings.graphics = graphics as GraphicsMode
      else problems.push({ where: 'settings.graphics', message: `"${graphics}" is not a mode. Use "performance", "balanced" or "grove".` })
    }
    for (const key of SETTING_SWITCHES) {
      const value = raw.settings[key]
      if (typeof value === 'boolean') grove.settings[key] = value
      else if (value !== undefined) problems.push({ where: `settings.${key}`, message: 'Should be true or false.' })
    }
  }

  if (raw.stones !== undefined) {
    if (!Array.isArray(raw.stones)) {
      problems.push({ where: 'stones', message: 'Should be a list, like [ ].' })
    } else {
      raw.stones.forEach((entry, index) => {
        const at = `stones[${index}]`
        if (!isRecord(entry)) {
          problems.push({ where: at, message: 'Should be an object with at least a "path".' })
          return
        }
        const stonePath = asString(entry.path)
        if (!stonePath.startsWith('/')) {
          problems.push({
            where: `${at}.path`,
            message: 'Needs an absolute path to the project folder, starting with "/".',
          })
          return
        }
        const stone: StoneConfig = { path: stonePath }
        const name = asString(entry.name)
        if (name) stone.name = name
        if (entry.hidden === true) stone.hidden = true
        if (entry.wildwood === true) stone.wildwood = true
        if (entry.place !== undefined) {
          if (typeof entry.place === 'number' && Number.isInteger(entry.place) && entry.place >= 0 && entry.place < 1000) {
            stone.place = entry.place
          } else {
            problems.push({ where: `${at}.place`, message: 'Should be a whole number from 0, like 2.' })
          }
        }

        if (Array.isArray(entry.declinedRunes)) {
          const declined = entry.declinedRunes.map(asString).filter(Boolean)
          if (declined.length) stone.declinedRunes = declined
        }
        if (entry.runes !== undefined) {
          if (!Array.isArray(entry.runes)) {
            problems.push({ where: `${at}.runes`, message: 'Should be a list, like [ ].' })
          } else {
            stone.runes = entry.runes.flatMap((runeEntry, runeIndex) => {
              const runeAt = `${at}.runes[${runeIndex}]`
              if (!isRecord(runeEntry)) {
                problems.push({ where: runeAt, message: 'Should be an object.' })
                return []
              }
              const id = asString(runeEntry.id)
              const name_ = asString(runeEntry.name)
              const agent = asString(runeEntry.agent)
              const prompt = asString(runeEntry.prompt)
              // A rune with no prompt does nothing when invoked, and a rune with no agent has
              // nothing to invoke. Both are worth saying rather than accepting and failing later.
              if (!id || !prompt) {
                problems.push({ where: runeAt, message: 'Needs at least an "id" and a "prompt".' })
                return []
              }
              const rune: Rune = { id, name: name_ || id, agent, prompt }
              const schedule = asString(runeEntry.schedule)
              if (schedule) rune.schedule = schedule
              return [rune]
            })
          }
        }
        grove.stones.push(stone)
      })
    }
  }

  if (raw.agents !== undefined) {
    if (!Array.isArray(raw.agents)) {
      problems.push({ where: 'agents', message: 'Should be a list, like [ ].' })
    } else {
      grove.agents = raw.agents.flatMap((entry, index) => {
        const agent = parseAgent(entry, `agents[${index}]`, problems)
        return agent ? [agent] : []
      })
      // Same reasoning as stones: two definitions with one id means runes would pick one by
      // accident of order.
      const ids = new Set<string>()
      grove.agents = grove.agents.filter((agent) => {
        if (!ids.has(agent.id)) {
          ids.add(agent.id)
          return true
        }
        problems.push({ where: 'agents', message: `Two agents called "${agent.id}". Only the first is used.` })
        return false
      })
    }
  }

  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) problems.push({ where: 'notes', message: 'Should be a list, like [ ].' })
    else {
      const seen = new Set<string>()
      grove.notes = raw.notes.flatMap((entry, index) => parseNote(entry, `notes[${index}]`, problems, seen))
    }
  }

  // Two entries for one path means one of them is being ignored, and which one would depend on
  // iteration order. Better to say so than to pick.
  const seen = new Set<string>()
  for (const stone of grove.stones) {
    if (seen.has(stone.path)) {
      problems.push({
        where: 'stones',
        message: `Two entries for "${stone.path}". Only the first is used — merge them.`,
      })
    }
    seen.add(stone.path)
  }

  return { grove, problems }
}

/**
 * Read one carved note. The text may be anything you wrote; the place and the date must make
 * sense, or the note could never show. A second note on the same place is dropped, since a place
 * holds one note and carving a new one replaces the old.
 */
function parseNote(entry: unknown, at: string, problems: GroveProblem[], seen: Set<string>): CarvedNote[] {
  if (!isRecord(entry)) {
    problems.push({ where: at, message: 'Should be an object with "on", "text" and "at".' })
    return []
  }
  const on = asString(entry.on) as NotePlace
  const id = on === 'tree' ? '' : asString(entry.id)
  const text = asString(entry.text).slice(0, MAX_NOTE_CHARS)
  const when = asString(entry.at)
  if (!NOTE_PLACES.includes(on) || (on !== 'tree' && !id)) {
    problems.push({ where: at, message: 'Needs "on" ("stone", "agent" or "tree") and, for a stone or an agent, its "id".' })
    return []
  }
  if (!text || !Number.isFinite(Date.parse(when))) {
    problems.push({ where: at, message: 'Needs some "text" and a date in "at", like "2026-10-03T12:00:00Z".' })
    return []
  }
  const key = `${on}:${id}`
  if (seen.has(key)) {
    problems.push({ where: at, message: `A second note on the same ${on}. Only the first is kept.` })
    return []
  }
  seen.add(key)
  return [{ on, id, text, at: new Date(when).toISOString() }]
}

/**
 * Read one agent definition, reporting anything wrong with it into `problems`.
 *
 * Separate from `parseGrove` because the Grove's own "grow an agent" form goes through exactly the
 * same rules as a hand-typed entry. One set of rules, so the form can never write something the
 * loader would then refuse.
 */
export function parseAgent(entry: unknown, at: string, problems: GroveProblem[]): AgentDefinition | null {
  if (!isRecord(entry)) {
    problems.push({ where: at, message: 'Should be an object.' })
    return null
  }
  const id = asString(entry.id)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    problems.push({ where: `${at}.id`, message: 'Needs an "id" in lower-case letters, digits and dashes, like "builder".' })
    return null
  }
  if ((BUILT_IN_AGENT_IDS as readonly string[]).includes(id)) {
    problems.push({ where: `${at}.id`, message: `"${id}" is built into the Grove. Choose another id.` })
    return null
  }

  const harness = asString(entry.harness) || 'claude-code'
  if (!(AGENT_HARNESSES as readonly string[]).includes(harness)) {
    problems.push({
      where: `${at}.harness`,
      message: `"${harness}" is not a tool the Grove knows. Use "claude-code", "codex", "chatgpt-dot" or "claude-cowork".`,
    })
    return null
  }

  const agent: AgentDefinition = {
    id,
    name: asString(entry.name) || id,
    description: asString(entry.description),
    harness: harness as AgentHarness,
  }

  const glyph = asString(entry.glyph)
  if (glyph) {
    if ((AGENT_GLYPHS as readonly string[]).includes(glyph)) agent.glyph = glyph as AgentGlyph
    else problems.push({ where: `${at}.glyph`, message: `"${glyph}" is not a glyph. Use one of: ${AGENT_GLYPHS.join(', ')}.` })
  }

  const link = asString(entry.link)
  if (link) {
    // https only: this string is handed to the system opener, and a file: or custom-scheme link
    // there would run something rather than show a page.
    if (!isLinkOnly(agent.harness)) {
      problems.push({ where: `${at}.link`, message: 'Only an agent that opens in its own app has a link. The Grove runs the others itself.' })
    } else if (!isHttpsUrl(link)) {
      problems.push({ where: `${at}.link`, message: 'Should be a web address starting with "https://".' })
    } else {
      agent.link = link
    }
  }

  const model = asString(entry.model)
  if (model) agent.model = model
  const systemPrompt = asString(entry.systemPrompt)
  if (systemPrompt) agent.systemPrompt = systemPrompt
  return agent
}

export function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:'
  } catch {
    return false
  }
}
