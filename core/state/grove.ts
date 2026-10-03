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
 *   - **Changes happen one at a time, on the latest file.** Every change goes through
 *     `updateGrove`: read, change, write, as one step, queued behind any other change. Two
 *     settings saved at the same moment used to each read the file, each change their own copy,
 *     and the second write threw the first change away (found in the 30 September review). And if
 *     you save the file by hand while a change is between reading and writing, the change is
 *     made again on your version rather than written over it.
 */
import fsp from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { type GroveFile, type GroveProblem, type StoneConfig, BUILT_IN_AGENT_IDS, MAX_BRIEF_CHARS, defaultGrove, parseAgent, parseGrove } from './schema.ts'
import { assignPlaces, placeFor } from './places.ts'
import { type RepoInfo, readRepos, twinsOf } from './repos.ts'
import { MAX_NOTE_CHARS, NOTE_PLACES, type NotePlace } from './notes.ts'

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
  // guaranteed atomic within a single filesystem and /tmp is often a different one. Its name is
  // unique per write, so two writes can never trample each other's temporary file.
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
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

/** The file's text as it is now, or `null` when there is none. */
const readText = () => fsp.readFile(grovePath(), 'utf8').catch(() => null)

/** Every change waits for the one before it. See the header. */
let queue: Promise<unknown> = Promise.resolve()

/** What a change returns: its answer, and whether there is anything to write. */
export interface Change<T> {
  result: T
  /** False when the answer is "nothing to do" or a refusal, so the file is left exactly as it is. */
  write: boolean
}

/**
 * The one way the Grove changes `grove.json`. `change` gets a fresh copy of the file's contents
 * and edits it in place. A file with problems in it is never saved over, because saving would
 * quietly drop whatever could not be read; `refused` is the answer then.
 *
 * If the file changes on disk between the read and the write (you saved it by hand), the change
 * is made again on the new version, up to three times, so neither edit is lost.
 */
export function updateGrove<T>(
  change: (grove: GroveFile) => Change<T> | Promise<Change<T>>,
  refused: T
): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await readText()
      const loaded = await loadGrove()
      if (loaded.problems.length) return refused
      const { result, write } = await change(loaded.grove)
      if (!write) return result
      if ((await readText()) !== before) continue
      await saveGrove(loaded.grove)
      return result
    }
    throw new Error('grove.json kept changing while saving; try again')
  }
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

/**
 * The stones that stand on numbered places: shown, not inside another shown stone's folder, and not
 * the twin of another stone (a twin stands beside its anchor, see `core/state/repos.ts`).
 */
function topLevel(stones: StoneConfig[], repos: Map<string, RepoInfo>): StoneConfig[] {
  const shown = stones.filter((stone) => !stone.hidden)
  const twins = twinsOf(shown, repos)
  return shown.filter(
    (stone) => !twins.has(stone.path) && !shown.some((other) => other !== stone && stone.path.startsWith(other.path + path.sep))
  )
}

/**
 * What git says about every folder that might be in the grove by the time a change is made. Read
 * before `updateGrove`, which cannot wait on the disk part-way through; a folder added by hand in
 * that moment is only missing its twin until the next change.
 */
async function reposFor(...extra: string[]): Promise<Map<string, RepoInfo>> {
  const { grove } = await loadGrove()
  return readRepos([...new Set([...grove.stones.map((stone) => stone.path), ...extra])])
}

/**
 * Write down the place every top-level stone stands on right now. Done before any stone is added
 * or removed, so an older grove without numbers keeps exactly the layout it had, and nothing moves.
 */
function fixPlaces(stones: StoneConfig[], repos: Map<string, RepoInfo>): void {
  const top = topLevel(stones, repos)
  const at = assignPlaces(top.map((stone) => ({ id: stone.path, place: stone.place })))
  for (const stone of top) stone.place = at.get(stone.path)
  // A shown stone that stands off another holds no place. One connected before twins existed may
  // still have a number written; left there, it would keep an empty circle from being offered.
  for (const stone of stones) if (!stone.hidden && !top.includes(stone)) delete stone.place
}

/**
 * Add a folder to the grove as a project stone.
 *
 * The one place a stone is ever made. Re-reads the file first rather than trusting an earlier
 * copy, so an edit you made by hand a moment ago is kept rather than overwritten. Adding a folder
 * that is already there is not an error: the answer to "make this a stone" is already yes.
 */
export async function addProject(folder: string, place?: number): Promise<{ ok: boolean; error?: string }> {
  if (!path.isAbsolute(folder)) return { ok: false, error: 'Not an absolute path' }
  const stat = await fsp.stat(folder).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'Not a folder' }

  const resolved = path.resolve(folder)
  const repos = await reposFor(resolved)
  return updateGrove<{ ok: boolean; error?: string }>(
    (grove) => {
      if (grove.stones.some((stone) => stone.path === resolved)) return { result: { ok: true }, write: false }
      fixPlaces(grove.stones, repos)
      const entry: StoneConfig = { path: resolved }
      grove.stones.push(entry)
      // A top-level stone takes the circle you chose, or the lowest free one; a sub-stone stands
      // off its parent and a twin beside its anchor, and neither takes one.
      if (topLevel(grove.stones, repos).includes(entry)) {
        const used = grove.stones.filter((stone) => stone !== entry && stone.place !== undefined).map((stone) => stone.place!)
        entry.place = placeFor(used, place)
      }
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before adding projects' }
  )
}

/**
 * Take a project off the grove. Only its entry in `grove.json` goes: the folder, its files and
 * every session in it are untouched, and connecting the folder again brings the stone back.
 * Anything written on the entry by hand (a new name, runes) goes with it, which the interface
 * says before the second press.
 */
export async function removeProject(stonePath: string): Promise<{ ok: boolean; error?: string }> {
  const repos = await reposFor()
  return updateGrove<{ ok: boolean; error?: string }>(
    (grove) => {
      const leaving = grove.stones.find((stone) => stone.path === stonePath)
      if (!leaving) return { result: { ok: false, error: 'No stone for that folder' }, write: false }
      // Numbers first, so the stones that stay keep their places and this one leaves a gap.
      fixPlaces(grove.stones, repos)
      grove.stones = grove.stones.filter((stone) => stone !== leaving)
      // A note on a stone that is gone could never show.
      grove.notes = grove.notes.filter((note) => !(note.on === 'stone' && note.id === stonePath))
      // Unless it had a twin: then the twin steps into the place it leaves, rather than jumping to
      // whichever circle happens to be lowest.
      const heir = topLevel(grove.stones, repos).find((stone) => stone.place === undefined)
      if (heir && leaving.place !== undefined && twinsOf([leaving, heir], repos).size) heir.place = leaving.place
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before removing projects' }
  )
}

/** What the "grow an agent" form sends. The id is made here, from the name, not by page code. */
export interface AgentDraft {
  name: string
  description: string
  harness: string
  glyph?: string
  link?: string
  /** How this agent should work. Sent ahead of every job it is given. Agents that work in folders only. */
  brief?: string
  /** A model name for its tool, when you want one other than the tool's default. */
  model?: string
}

const MAX_MODEL_CHARS = 80

/** The draft's fields as a hand-typed entry would have them, ready for `parseAgent`. */
function entryFrom(draft: AgentDraft, id: string, name: string, harness: string): Record<string, unknown> {
  const text = (value: unknown, most: number) => (typeof value === 'string' ? value.trim().slice(0, most) : '')
  return {
    id,
    name,
    description: text(draft.description, 120),
    harness,
    glyph: draft.glyph,
    link: draft.link,
    model: text(draft.model, MAX_MODEL_CHARS),
    systemPrompt: text(draft.brief, MAX_BRIEF_CHARS),
  }
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

  return updateGrove<{ ok: boolean; id?: string; error?: string }>(
    (grove) => {
      // The id is chosen inside the update, against the file as it is now, so two agents grown at
      // once with the same name still get `builder` and `builder-2`.
      const taken = new Set<string>([...BUILT_IN_AGENT_IDS, ...grove.agents.map((agent) => agent.id)])
      const id = uniqueId(slugify(name) || 'agent', taken)
      const problems: GroveProblem[] = []
      const agent = parseAgent(entryFrom(draft, id, name, draft.harness), 'new agent', problems)
      if (!agent || problems.length) {
        return { result: { ok: false, error: problems[0]?.message ?? 'That agent could not be made' }, write: false }
      }
      grove.agents.push(agent)
      return { result: { ok: true, id }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before adding agents' }
  )
}

/**
 * Change one of your agents: its name, line, face, brief, model or link. Its id and its tool stay
 * as they are, because runes and past runs refer to the id, and a different tool is a different agent.
 */
export async function updateAgent(id: string, draft: AgentDraft): Promise<{ ok: boolean; id?: string; error?: string }> {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return { ok: false, error: 'Give it a name' }
  if (name.length > 40) return { ok: false, error: 'Keep the name under 40 characters' }

  return updateGrove<{ ok: boolean; id?: string; error?: string }>(
    (grove) => {
      const index = grove.agents.findIndex((agent) => agent.id === id)
      const current = grove.agents[index]
      if (!current) return { result: { ok: false, error: 'No agent with that id' }, write: false }
      const problems: GroveProblem[] = []
      const agent = parseAgent(entryFrom(draft, id, name, current.harness), name, problems)
      if (!agent || problems.length) {
        return { result: { ok: false, error: problems[0]?.message ?? 'That change could not be made' }, write: false }
      }
      grove.agents[index] = agent
      return { result: { ok: true, id }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before changing agents' }
  )
}

/** Take an agent off the tree. Its runes, if any, stay: they are yours, and say which agent they wanted. */
export async function removeAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  return updateGrove<{ ok: boolean; error?: string }>(
    (grove) => {
      const kept = grove.agents.filter((agent) => agent.id !== id)
      if (kept.length === grove.agents.length) return { result: { ok: false, error: 'No agent with that id' }, write: false }
      grove.agents = kept
      grove.notes = grove.notes.filter((note) => !(note.on === 'agent' && note.id === id))
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before removing agents' }
  )
}

/**
 * Carve a note on a stone, an agent or the tree, replacing any note already there. Empty text
 * takes the note away. The place must exist: a stone in the grove, or an agent on the tree.
 */
export async function carveNote(on: unknown, id: unknown, text: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!NOTE_PLACES.includes(on as NotePlace)) return { ok: false, error: 'Not a place for a note' }
  const place = on as NotePlace
  const key = place === 'tree' ? '' : typeof id === 'string' ? id : ''
  const words = typeof text === 'string' ? text.trim() : ''
  if (words.length > MAX_NOTE_CHARS) return { ok: false, error: `Keep it under ${MAX_NOTE_CHARS} characters` }
  return updateGrove<{ ok: boolean; error?: string }>(
    (grove) => {
      const exists =
        place === 'tree' ||
        (place === 'stone' && grove.stones.some((stone) => stone.path === key)) ||
        (place === 'agent' && ((BUILT_IN_AGENT_IDS as readonly string[]).includes(key) || grove.agents.some((agent) => agent.id === key)))
      if (!exists) return { result: { ok: false, error: 'Nothing there to carve on' }, write: false }
      const others = grove.notes.filter((note) => !(note.on === place && note.id === key))
      grove.notes = words ? [...others, { on: place, id: key, text: words, at: new Date().toISOString() }] : others
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before carving notes' }
  )
}

/** A note has been read where it showed: it goes. Reading one that is already gone is not an error. */
export async function readNote(on: unknown, id: unknown): Promise<{ ok: boolean; error?: string }> {
  const key = on === 'tree' ? '' : typeof id === 'string' ? id : ''
  return updateGrove<{ ok: boolean; error?: string }>(
    (grove) => {
      const kept = grove.notes.filter((note) => !(note.on === on && note.id === key))
      if (kept.length === grove.notes.length) return { result: { ok: true }, write: false }
      grove.notes = kept
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before reading notes' }
  )
}

/**
 * Change some settings, from the Settings panel.
 *
 * The patch goes through `parseGrove` like a hand edit, so the panel cannot write a value the loader
 * would then refuse, and fields the page sends that are not settings are simply ignored.
 */
export async function saveSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return updateGrove<{ ok: boolean; error?: string }>(
    (current) => {
      const { grove, problems } = parseGrove({ ...current, settings: { ...current.settings, ...patch } })
      if (problems.length) return { result: { ok: false, error: problems[0]!.message }, write: false }
      // Checked, so it replaces the copy in place: `updateGrove` writes the object it handed over.
      Object.assign(current, grove)
      return { result: { ok: true }, write: true }
    },
    { ok: false, error: 'grove.json has an error; fix it before changing settings' }
  )
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
