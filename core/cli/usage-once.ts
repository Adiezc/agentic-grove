/**
 * `npm run usage` — print what the crystal would show, and stop.
 *
 * The same job `npm run scan` does for sessions: prove the numbers before drawing them. Every
 * line says where its figure came from, so a wrong one can be chased to its source.
 */
import { usage } from '../usage/index.ts'
import type { UsageWindow } from '../usage/types.ts'

const LABEL = { five_hour: '5 hours', seven_day: '7 days' } as const

function describe(window: UsageWindow, now: number): string {
  const parts: string[] = [`${LABEL[window.key].padEnd(8)} ${window.provenance.padEnd(9)}`]
  if (window.usedPercent !== null) parts.push(`${window.usedPercent.toFixed(0)}% used`)
  if (window.tokens !== null) parts.push(`${window.tokens.toLocaleString('en-GB')} tokens`)
  if (window.resetsAt !== null) parts.push(`resets in ${Math.round((window.resetsAt - now) / 60_000)} min`)
  if (window.provenance === 'official' && window.observedAt !== null) {
    parts.push(`as of ${Math.round((now - window.observedAt) / 60_000)} min ago`)
  }
  if (window.provenance === 'unknown') parts.push('not known')
  return parts.join('  ')
}

const started = Date.now()
const report = await usage()
for (const provider of report.providers) {
  console.log(provider.name)
  for (const window of provider.windows) console.log(`  ${describe(window, report.at)}`)
  if (provider.note) console.log(`  (${provider.note})`)
}
if (!report.providers.length) console.log('No usage records found.')
console.log(`\nread in ${Date.now() - started}ms`)
