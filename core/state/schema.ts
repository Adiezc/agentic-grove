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
}

/**
 * Which tool an agent in the tree belongs to, and so what the Grove can do with it.
 *
 *   claude-code, codex  Hang from the branches. The Grove can send them to a stone.
 *   grok-bot            A firefly. Lives in xAI's own app with no API (checked September 2026),
 *                       so the Grove can open it and nothing else. Re-check before v1 ships.
 */
export type AgentHarness = 'claude-code' | 'codex' | 'grok-bot'
export const AGENT_HARNESSES: readonly AgentHarness[] = ['claude-code', 'codex', 'grok-bot']

/**
 * The glyph on an agent's orb: what it does, at a glance.
 *
 * Words rather than icon names, so a person editing the file by hand can guess them, and so
 * `core/` stays free of anything the interface draws with. The renderer maps each word to an icon
 * in `src/agents/glyphs.ts`; a word it does not know is reported here rather than drawn blank.
 */
export const AGENT_GLYPHS = ['search', 'build', 'review', 'write', 'data', 'mail', 'calendar', 'spark'] as const
export type AgentGlyph = (typeof AGENT_GLYPHS)[number]

/** Where a Grok Bot's orb goes when it has no link of its own. */
export const GROK_HOME = 'https://grok.com'

/**
 * Researcher is built into every grove and is not written here, so no definition may take its id.
 * If one did, `Rune.agent: "researcher"` would mean two different agents depending on who asked.
 */
export const BUILT_IN_AGENT_IDS = ['researcher'] as const

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
  /** Grok Bots only: the page their orb opens. Must be https. Missing means `GROK_HOME`. */
  link?: string
  /** Model to run it on. Empty means "whatever the harness defaults to" — never a guess. */
  model?: string
  /** Prepended to every prompt this agent runs. Optional. */
  systemPrompt?: string
}

/**
 * Which Claude plan's limits the crystal should be drawn against.
 *
 * The default is Pro. The others are here as constants from the start so that anyone else can use
 * this without editing code, which is the difference between an open-source project and a
 * personal one that happens to be public.
 */
export type ClaudePlan = 'pro' | 'max-5x' | 'max-20x'

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
}

export interface GroveFile {
  version: number
  settings: GroveSettings
  /** Only projects you have an opinion about. Normally empty. */
  stones: StoneConfig[]
  /** The agents you have connected to the tree, in the order they grew. Researcher is built in and not listed. */
  agents: AgentDefinition[]
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
    settings: { claudePlan: 'pro', scanIntervalMs: 5000 },
    stones: [],
    agents: [],
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
      message: `"${harness}" is not a tool the Grove knows. Use "claude-code", "codex" or "grok-bot".`,
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
    if (agent.harness !== 'grok-bot') {
      problems.push({ where: `${at}.link`, message: 'Only a Grok Bot has a link. The Grove runs the others itself.' })
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
