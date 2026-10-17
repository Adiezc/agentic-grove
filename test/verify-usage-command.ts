/**
 * Reading Claude's limits from `claude -p /usage`. Run with `npm run verify:usage-command`.
 * The text is Claude Code's own, as printed on 18 October 2026 (2.1.301).
 */
import assert from 'node:assert/strict'
import { parseReset, parseUsageCommand } from '../core/usage/usage-command.ts'

const SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 72% used · resets Oct 18 at 4am (Europe/Brussels)
Current week (all models): 30% used · resets Oct 22 at 7pm (Europe/Brussels)

What's contributing to your limits usage?
Last 24h · 519 requests · 8 sessions
  84% of your usage was at >150k context`

const now = new Date(2026, 9, 18, 0, 30).getTime()
const cases: [string, () => void][] = [
  ['both windows are read, with their resets in local time', () => {
    const reading = parseUsageCommand(SAMPLE, now)!
    assert.equal(reading.windows.five_hour?.usedPercent, 72)
    assert.equal(reading.windows.five_hour?.resetsAt, new Date(2026, 9, 18, 4, 0).getTime())
    assert.equal(reading.windows.seven_day?.usedPercent, 30)
    assert.equal(reading.windows.seven_day?.resetsAt, new Date(2026, 9, 22, 19, 0).getTime())
  }],
  ['"84% of your usage" in the breakdown is never mistaken for a limit', () => {
    const reading = parseUsageCommand('Last 24h\n  84% of your usage was at >150k context', now)
    assert.equal(reading, null)
  }],
  ['minutes, noon and midnight, and a reset across New Year', () => {
    assert.equal(parseReset('Oct 22 at 7:30pm', now), new Date(2026, 9, 22, 19, 30).getTime())
    assert.equal(parseReset('Oct 18 at 12pm', now), new Date(2026, 9, 18, 12, 0).getTime())
    assert.equal(parseReset('Oct 19 at 12am', now), new Date(2026, 9, 19, 0, 0).getTime())
    const lateDecember = new Date(2026, 11, 30, 22, 0).getTime()
    assert.equal(parseReset('Jan 2 at 9am', lateDecember), new Date(2027, 0, 2, 9, 0).getTime())
  }],
  ['unreadable text gives no figure rather than a guess', () => {
    assert.equal(parseUsageCommand('Current session: lots used', now), null)
    assert.equal(parseUsageCommand('', now), null)
    const noReset = parseUsageCommand('Current session: 5% used', now)!
    assert.equal(noReset.windows.five_hour?.resetsAt, null)
  }],
]
let failed = 0
for (const [name, check] of cases) {
  try {
    check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} /usage checks hold.`)
