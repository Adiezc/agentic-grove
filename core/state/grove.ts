/**
 * Reading and writing `grove.json` — the only file this project writes, anywhere.
 *
 * Where it lives: `~/.agentic-grove/grove.json`, overridable with `AGENTIC_GROVE_HOME`. A
 * dotfolder in the home directory rather than inside the app's own Application Support
 * directory, because the brief asks for a file the user can put under version control, and
 * nobody commits `~/Library/Application Support`. People do commit dotfiles.
 *
 * Two things this module is careful about, both for the same reason — the file is something a
 * person edits by hand, so both of us are writing to it:
 *
 *   - **Writes are atomic.** Write to a temporary file, then rename over the original. A rename
 *     within one filesystem either happens or does not, so a crash or a full disk mid-write
 *     cannot leave a half-written grove.json. Truncating the real file first and writing into it
 *     is how people lose configuration.
 *   - **Nothing is written that was not asked for.** Loading a malformed file does not rewrite
 *     it, and loading a missing file does not create one. The Grove works from defaults and says
 *     what it could not read. The first write happens when you change something.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { type GroveFile, type GroveProblem, BUILT_IN_AGENT_IDS, defaultGrove, parseAgent, parseGrove } from './schema.ts'

/** `AGENTIC_GROVE_HOME` exists so tests can point somewhere disposable. */
export const groveHome = (): string =>
  process.env.AGENTIC_GROVE_HOME || path.join(os.homedir(), '.agentic-grove')

export const grovePath = (): string => path.join(groveHome(), 'grove.json')

export interface LoadedGrove {
  grove: GroveFile
  /** Anything wrong with the file, in terms the person who typed it can act on. */
  problems: GroveProblem[]
  /** False when there is no file yet, which is the normal state on first launch. */
  exists: boolean
  /** Where it was read from, so the interface can offer to open it. */
  path: string
}

/**
 * Load the grove, falling back to defaults for anything unreadable.
 *
 * This never throws and never refuses to start. A syntax error in `grove.json` should cost you
 * your customisations until you fix the comma, not cost you the application.
 */
export async function loadGrove(): Promise<LoadedGrove> {
  const file = grovePath()
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    // No file is not a problem worth reporting — it is what first launch looks like.
    return { grove: defaultGrove(), problems: [], exists: false, path: file }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    // The one case worth quoting the parser on, because "Unexpected token } in JSON at position
    // 214" is genuinely the most useful thing anyone can say about a stray comma.
    return {
      grove: defaultGrove(),
      problems: [
        {
          where: 'grove.json',
          message: `Could not be read as JSON, so the Grove is running on defaults. ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      exists: true,
      path: file,
    }
  }

  const { grove, problems } = parseGrove(raw)
  return { grove, problems, exists: true, path: file }
}

/**
 * Save the grove, atomically.
 *
 * Pretty-printed with two-space indentation and a trailing newline, because this file is meant
 * to be read and edited by a person and to produce a sane diff when it is committed.
 */
export async function saveGrove(grove: GroveFile): Promise<void> {
  const file = grovePath()
  await fsp.mkdir(path.dirname(file), { recursive: true })

  // The temporary file sits in the same directory as the target, because rename is only
  // guaranteed atomic within a single filesystem and /tmp is often a different one.
  const temporary = `${file}.${process.pid}.tmp`
  const text = JSON.stringify(grove, null, 2) + '\n'
  try {
    await fsp.writeFile(temporary, text, 'utf8')
    await fsp.rename(temporary, file)
  } catch (error) {
    // Do not leave litter next to somebody's configuration if the write failed.
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Add a folder to the grove as a project stone.
 *
 * The one place a stone is ever made. Re-reads the file first rather than trusting an earlier
 * copy, so an edit you made by hand a moment ago is kept rather than overwritten. Adding a folder
 * that is already there is not an error: the answer to "make this a stone" is already yes.
 */
export async function addProject(folder: string): Promise<{ ok: boolean; error?: string }> {
  if (!path.isAbsolute(folder)) return { ok: false, error: 'Not an absolute path' }
  const stat = await fsp.stat(folder).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'Not a folder' }

  const loaded = await loadGrove()
  // Saving over a file with problems in it would quietly drop whatever could not be read. Refuse,
  // and let the problem the interface is already showing be fixed first.
  if (loaded.problems.length) {
    return { ok: false, error: 'grove.json has an error; fix it before adding projects' }
  }
  const resolved = path.resolve(folder)
  if (!loaded.grove.stones.some((stone) => stone.path === resolved)) {
    loaded.grove.stones.push({ path: resolved })
    await saveGrove(loaded.grove)
  }
  return { ok: true }
}

/**
 * Take a project off the grove. Only its entry in `grove.json` goes: the folder, its files and
 * every session in it are untouched, and connecting the folder again brings the stone back.
 * Anything written on the entry by hand (a new name, runes) goes with it, which the interface
 * says before the second press.
 */
export async function removeProject(stonePath: string): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadGrove()
  if (loaded.problems.length) {
    return { ok: false, error: 'grove.json has an error; fix it before removing projects' }
  }
  const kept = loaded.grove.stones.filter((stone) => stone.path !== stonePath)
  if (kept.length === loaded.grove.stones.length) return { ok: false, error: 'No stone for that folder' }
  loaded.grove.stones = kept
  await saveGrove(loaded.grove)
  return { ok: true }
}

/** What the "grow an agent" form sends. The id is made here, from the name, not by page code. */
export interface AgentDraft {
  name: string
  description: string
  harness: string
  glyph?: string
  link?: string
}

/**
 * Add an agent definition to the tree.
 *
 * Runs through `parseAgent`, the same rules as a hand-typed entry, so the form can never write
 * something the loader would refuse. Re-reads the file first, for the same reason `addProject`
 * does: an edit made by hand a moment ago is kept, not overwritten.
 */
export async function addAgent(draft: AgentDraft): Promise<{ ok: boolean; id?: string; error?: string }> {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return { ok: false, error: 'Give it a name' }
  if (name.length > 40) return { ok: false, error: 'Keep the name under 40 characters' }

  const loaded = await loadGrove()
  if (loaded.problems.length) {
    return { ok: false, error: 'grove.json has an error; fix it before adding agents' }
  }

  const taken = new Set<string>([...BUILT_IN_AGENT_IDS, ...loaded.grove.agents.map((agent) => agent.id)])
  const id = uniqueId(slugify(name) || 'agent', taken)
  const problems: GroveProblem[] = []
  const agent = parseAgent(
    {
      id,
      name,
      description: typeof draft.description === 'string' ? draft.description.slice(0, 120) : '',
      harness: draft.harness,
      glyph: draft.glyph,
      link: draft.link,
    },
    'new agent',
    problems
  )
  if (!agent || problems.length) return { ok: false, error: problems[0]?.message ?? 'That agent could not be made' }

  loaded.grove.agents.push(agent)
  await saveGrove(loaded.grove)
  return { ok: true, id }
}

/** Take an agent off the tree. Its runes, if any, stay: they are yours, and say which agent they wanted. */
export async function removeAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadGrove()
  if (loaded.problems.length) {
    return { ok: false, error: 'grove.json has an error; fix it before removing agents' }
  }
  const kept = loaded.grove.agents.filter((agent) => agent.id !== id)
  if (kept.length === loaded.grove.agents.length) return { ok: false, error: 'No agent with that id' }
  loaded.grove.agents = kept
  await saveGrove(loaded.grove)
  return { ok: true }
}

/**
 * Change some settings, from the Settings panel.
 *
 * The patch goes through `parseGrove` like a hand edit, so the panel cannot write a value the loader
 * would then refuse, and fields the page sends that are not settings are simply ignored.
 */
export async function saveSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadGrove()
  if (loaded.problems.length) {
    return { ok: false, error: 'grove.json has an error; fix it before changing settings' }
  }
  const { grove, problems } = parseGrove({ ...loaded.grove, settings: { ...loaded.grove.settings, ...patch } })
  if (problems.length) return { ok: false, error: problems[0]!.message }
  await saveGrove(grove)
  return { ok: true }
}

/** "Inbox Sorter!" becomes "inbox-sorter". Readable aloud, which is the schema's rule for ids. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** Two agents called "Builder" become `builder` and `builder-2`, rather than one replacing the other. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
