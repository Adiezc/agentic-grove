/**
 * Adding the Grove's hooks to Claude Code's settings, and taking them out again.
 *
 * This is the one place the Grove writes another tool's file, and DECISIONS.md sets the terms:
 * only when you ask, showing the exact change first, reversibly, and never on its own at launch
 * or on upgrade. Each rule is a piece of this file:
 *
 *   - **Asked for.** Nothing here runs except from the settings panel's buttons.
 *   - **Shown first.** `planHooks` works out the change and returns it line by line, with a
 *     fingerprint of the file it was worked out from. `applyHooks` refuses unless the file still
 *     matches that fingerprint, so what you approved is exactly what gets written. If Claude Code
 *     or you edited the file in between, you are shown the new change instead.
 *   - **Reversible.** Our entries are recognised by the `/agentic-grove/` in their address, so
 *     removing them takes out ours and nothing else, and whatever else you added since stays.
 *     A copy of the file as it was is also kept in `~/.agentic-grove/backups/` before every write.
 *   - **Only ours.** Every other hook you have, like the SessionStart one already on this machine,
 *     is left exactly where it is.
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { groveHome } from '../state/grove.ts'
import { type DiffLine, diffLines } from './diff.ts'
import { HOOK_EVENTS, HOOK_HOST, HOOK_PATH_MARK, HOOK_PORT, TOOL_EVENTS } from './protocol.ts'

/** Claude Code's own override for where it keeps settings, honoured so we edit the file it reads. */
const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
export const claudeSettingsPath = (): string => path.join(claudeDir(), 'settings.json')

/**
 *   off         none of our hooks are there
 *   on          all of them, pointing at this listener
 *   outdated    some are there but not the current set, from an older Grove. Updating asks again.
 *   unreadable  the settings file is not valid JSON, so we will not touch it
 */
export type HooksState = 'off' | 'on' | 'outdated' | 'unreadable'
export type HooksAction = 'install' | 'remove'

export interface HooksPlan {
  ok: boolean
  error?: string
  action: HooksAction
  lines: DiffLine[]
  /** Fingerprint of the file this plan was made from. `applyHooks` must be handed it back. */
  baseline: string
  /** False when the file already says what the action would make it say. */
  changes: boolean
}

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The secret in our hooks' address. Made once and kept in the Grove's own folder, so the listener
 * and the installed hooks agree across restarts.
 */
export async function hookToken(): Promise<string> {
  const file = path.join(groveHome(), 'hook-token')
  const existing = (await fsp.readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f]{32}$/.test(existing)) return existing
  const token = crypto.randomBytes(16).toString('hex')
  await fsp.mkdir(groveHome(), { recursive: true })
  await fsp.writeFile(file, token + '\n', { mode: 0o600 })
  return token
}

/**
 * The command each hook runs: forward the event to the Grove and never get in Claude Code's way.
 *
 *   -s -o /dev/null   say nothing. A PreToolUse hook's output can be read as an instruction.
 *   -m 1              give up after a second, so a stuck Grove cannot slow a session down.
 *   || true           succeed even when the Grove is closed. A failing hook shows up as an error
 *                     in Claude Code, and the Grove being shut is not an error.
 */
function hookCommand(token: string): string {
  const url = `http://${HOOK_HOST}:${HOOK_PORT}${HOOK_PATH_MARK}${token}/hook`
  return `curl -s -m 1 -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- ${url} || true`
}

const isOurs = (hook: unknown): boolean =>
  isRecord(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_PATH_MARK)

async function readSettings(): Promise<{ text: string; settings: Json } | { error: string }> {
  const text = await fsp.readFile(claudeSettingsPath(), 'utf8').catch((error: NodeJS.ErrnoException) =>
    error.code === 'ENOENT' ? '' : Promise.reject(error)
  )
  if (!text.trim()) return { text, settings: {} }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return { error: "Claude Code's settings file is not a JSON object." }
    if (parsed.hooks !== undefined && !isRecord(parsed.hooks)) return { error: 'Its "hooks" entry is not an object.' }
    return { text, settings: parsed }
  } catch {
    return { error: "Claude Code's settings file is not valid JSON, so the Grove will not touch it." }
  }
}

/**
 * The settings with every one of our hooks taken out, and nothing else changed.
 *
 * A group or event list is only dropped if removing ours is what emptied it: a list you left empty
 * on purpose stays as you left it.
 */
function withoutOurs(settings: Json): Json {
  if (!isRecord(settings.hooks)) return settings
  const hooks: Json = {}
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups
      continue
    }
    const kept = groups.flatMap((group) => {
      if (!isRecord(group) || !Array.isArray(group.hooks) || !group.hooks.some(isOurs)) return [group]
      const rest = group.hooks.filter((hook) => !isOurs(hook))
      return rest.length ? [{ ...group, hooks: rest }] : []
    })
    if (kept.length || groups.length === 0) hooks[event] = kept
  }
  const next: Json = { ...settings, hooks }
  if (Object.keys(hooks).length === 0 && Object.keys(settings.hooks).length > 0) delete next.hooks
  return next
}

/** The settings with our current set of hooks added, after any old ones are taken out. */
function withOurs(settings: Json, token: string): Json {
  const clean = withoutOurs(settings)
  const hooks: Json = isRecord(clean.hooks) ? { ...clean.hooks } : {}
  const command = hookCommand(token)
  for (const event of HOOK_EVENTS) {
    const ours = {
      ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
      // Three seconds is a ceiling, not an expectation: curl gives up after one.
      hooks: [{ type: 'command', command, timeout: 3 }],
    }
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    hooks[event] = [...existing, ours]
  }
  return { ...clean, hooks }
}

/** Two-space JSON with a trailing newline: what Claude Code writes, so the diff stays honest. */
const serialise = (settings: Json): string => JSON.stringify(settings, null, 2) + '\n'
const fingerprint = (text: string): string => crypto.createHash('sha256').update(text).digest('hex')

export async function hooksState(): Promise<{ state: HooksState; error?: string }> {
  const read = await readSettings().catch((error: unknown) => ({ error: String(error) }))
  if ('error' in read) return { state: 'unreadable', error: read.error }
  const hooks = isRecord(read.settings.hooks) ? read.settings.hooks : {}
  const command = hookCommand(await hookToken())
  let found = 0
  let current = 0
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const ours = groups.flatMap((group) => (isRecord(group) && Array.isArray(group.hooks) ? group.hooks.filter(isOurs) : []))
    if (ours.length) found++
    if (ours.some((hook) => isRecord(hook) && hook.command === command)) current++
  }
  const anyElsewhere = Object.entries(hooks).some(
    ([event, groups]) =>
      !(HOOK_EVENTS as readonly string[]).includes(event) &&
      Array.isArray(groups) &&
      groups.some((group) => isRecord(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs))
  )
  if (found === 0 && !anyElsewhere) return { state: 'off' }
  if (current === HOOK_EVENTS.length && found === HOOK_EVENTS.length && !anyElsewhere) return { state: 'on' }
  return { state: 'outdated' }
}

export async function planHooks(action: HooksAction): Promise<HooksPlan> {
  const read = await readSettings().catch((error: unknown) => ({ error: String(error) }))
  if ('error' in read) return { ok: false, error: read.error, action, lines: [], baseline: '', changes: false }
  const next = action === 'install' ? withOurs(read.settings, await hookToken()) : withoutOurs(read.settings)
  const after = serialise(next)
  // A missing file and an empty object read the same, so compare what would be written.
  const changes = after !== read.text && !(action === 'remove' && after === serialise(read.settings) && !read.text.trim())
  return { ok: true, action, lines: diffLines(read.text, after), baseline: fingerprint(read.text), changes }
}

export async function applyHooks(action: HooksAction, baseline: string): Promise<{ ok: boolean; error?: string }> {
  const read = await readSettings().catch((error: unknown) => ({ error: String(error) }))
  if ('error' in read) return { ok: false, error: read.error }
  if (fingerprint(read.text) !== baseline) {
    return { ok: false, error: "Claude Code's settings changed since you looked. Review the new change." }
  }
  const next = action === 'install' ? withOurs(read.settings, await hookToken()) : withoutOurs(read.settings)
  const file = claudeSettingsPath()
  if (read.text) await backup(read.text)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  // Same-directory temporary file and a rename, for the same reason as grove.json: a crash
  // mid-write must not leave Claude Code with half a settings file.
  const mode = (await fsp.stat(file).catch(() => null))?.mode ?? 0o644
  const temporary = `${file}.agentic-grove.${process.pid}.tmp`
  try {
    await fsp.writeFile(temporary, serialise(next), { mode })
    await fsp.rename(temporary, file)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true }
}

/** Keep the file as it was, in the Grove's own folder, before changing it. */
async function backup(text: string): Promise<void> {
  const dir = path.join(groveHome(), 'backups')
  await fsp.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fsp.writeFile(path.join(dir, `claude-settings-${stamp}.json`), text, { mode: 0o600 })
}
