/**
 * The harness registry.
 *
 * Ported from Station-Sciences/bot-crossing (MIT) — see ./LICENSE-bot-crossing.
 *
 * Adding support for another tool means writing one module next to this file and adding it to
 * the list below. Nothing else needs to change — the scan loop, the Electron bridge and the
 * grove scene all talk to harnesses only through the interface in ./types.ts.
 */
import type { HarnessAdapter } from './types.ts'
import claudeCode from './claude-code.ts'
import codex from './codex.ts'
import cursor from './cursor.ts'

/** Claude Code first, because it is the one the Grove can also drive. */
export const HARNESSES: HarnessAdapter[] = [claudeCode, codex, cursor]

export const harnessById = (id: string): HarnessAdapter | null =>
  HARNESSES.find((harness) => harness.id === id) ?? null

/**
 * Which harnesses have data on this machine.
 *
 * Detection runs per-scan rather than once at startup, so installing a tool while the Grove is
 * open is noticed on the next poll rather than at the next restart. A `detect()` that throws is
 * read as "not here" — an adapter cannot take the scan down by failing to answer a cheap
 * question.
 */
export async function detectedHarnesses(): Promise<HarnessAdapter[]> {
  const flags = await Promise.all(
    HARNESSES.map(async (harness) => {
      try {
        return await harness.detect()
      } catch {
        return false
      }
    })
  )
  return HARNESSES.filter((_, index) => flags[index])
}
