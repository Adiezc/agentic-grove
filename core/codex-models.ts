/**
 * Codex's own list of models, as Codex shows it in its picker.
 *
 * Codex fetches the list from OpenAI and keeps a copy in `~/.codex/models_cache.json` (checked on
 * 17 October 2026, Codex 0.163). Reading that copy is the only honest way to offer Codex names:
 * they change every few weeks, so a list written into the Grove would be wrong within a month,
 * and the Grove never asks OpenAI itself.
 *
 * Only what the file says is used: the models marked `"visibility": "list"` (the ones Codex's own
 * picker shows), in Codex's order, with Codex's names for them. Anything unexpected about the file
 * (missing, unreadable, a new layout) gives an empty list, and the picker falls back to Default
 * and Other. Read-only, like everything the Grove does with another tool's files.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isModelName, type ModelChoice } from './models.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The visible models in a parsed `models_cache.json`, in Codex's own order. */
export function parseCodexModels(raw: unknown): ModelChoice[] {
  if (!isRecord(raw) || !Array.isArray(raw.models)) return []
  return raw.models
    .filter(isRecord)
    .filter((entry) => entry.visibility === 'list' && typeof entry.slug === 'string' && entry.slug !== '' && isModelName(entry.slug))
    .map((entry) => ({
      value: entry.slug as string,
      label: typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim().slice(0, 40) : (entry.slug as string),
      priority: typeof entry.priority === 'number' ? entry.priority : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.priority - b.priority)
    .map(({ value, label }) => ({ value, label }))
}

/** Codex's home folder: `$CODEX_HOME` if set, as Codex itself does, otherwise `~/.codex`. */
function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

export async function readCodexModels(home = codexHome()): Promise<ModelChoice[]> {
  try {
    return parseCodexModels(JSON.parse(await fsp.readFile(path.join(home, 'models_cache.json'), 'utf8')))
  } catch {
    return []
  }
}
