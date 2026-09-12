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
import { type GroveFile, type GroveProblem, defaultGrove, parseGrove } from './schema.ts'

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
