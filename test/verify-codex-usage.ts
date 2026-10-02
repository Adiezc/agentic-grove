/**
 * Codex's limits are read from the right conversation. Run with `npm run verify:codex-usage`.
 *
 * Builds a pretend Codex home in a disposable folder and points `core/usage/codex.ts` at it with
 * `CODEX_HOME`. Nothing here reads your real Codex sessions.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-codex-'))
// Set before the module loads: it reads `CODEX_HOME` once, at import.
process.env.CODEX_HOME = home
const { codexUsage } = await import('../core/usage/codex.ts')

const NOW = Date.parse('2026-10-02T12:00:00Z')
const RESETS = NOW / 1000 + 3600

/** One rollout whose last line reports `used` percent of five hours, last written at `writtenAt`. */
async function rollout(day: string, name: string, used: number, writtenAt: number): Promise<void> {
  const dir = path.join(home, 'sessions', ...day.split('-'))
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, `rollout-${name}.jsonl`)
  const line = {
    timestamp: new Date(writtenAt).toISOString(),
    payload: {
      type: 'token_count',
      rate_limits: { primary: { used_percent: used, resets_at: RESETS }, secondary: { used_percent: 1, resets_at: RESETS } },
    },
  }
  await fsp.writeFile(file, JSON.stringify(line) + '\n')
  await fsp.utimes(file, writtenAt / 1000, writtenAt / 1000)
}

const fiveHour = async () => (await codexUsage(NOW))?.windows.find((w) => w.key === 'five_hour')?.usedPercent

const cases: [string, () => Promise<void>][] = [
  ['with no sessions there is no Codex figure at all', async () => {
    assert.equal(await codexUsage(NOW), null)
  }],
  ['the newest reading wins', async () => {
    await rollout('2026-10-01', 'a', 20, NOW - 3 * 3600_000)
    await rollout('2026-10-02', 'b', 30, NOW - 2 * 3600_000)
    assert.equal(await fiveHour(), 30)
  }],
  ['a conversation started weeks ago and resumed just now is found, past six newer files', async () => {
    for (let i = 0; i < 7; i++) await rollout('2026-10-02', `busy-${i}`, 31 + i, NOW - 3600_000 - i * 60_000)
    await rollout('2026-09-10', 'resumed', 77, NOW - 60_000)
    assert.equal(await fiveHour(), 77)
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
await fsp.rm(home, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} Codex usage checks hold.`)
