/**
 * The press-to-check Claude limits, checked case by case. Run with `npm run verify:probe`.
 *
 * The reading rules in `core/usage/probe.ts` against lines shaped like Claude Code's own (taken
 * from a real check on 2 October 2026), then a whole check against a stand-in `claude` in a
 * disposable folder. Nothing here runs the real tool or sends a request.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PROBE_FOLDER, isProbeFolder, parseProbe, probeArgs, runProbe, withOfficial } from '../core/usage/probe.ts'
import type { ProviderUsage } from '../core/usage/types.ts'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-probe-'))
const NOW = 1_790_940_000_000
const LATER = NOW / 1000 + 3600

const event = (windows: unknown) =>
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: windows } })
const RESULT = JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 586, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, output_tokens: 37 } })
const FULL = [
  '{"type":"system","subtype":"init"}',
  event({ five_hour: { utilization: 0.03, resetsAt: LATER }, seven_day: { utilization: 0.13, resetsAt: LATER + 86_400 } }),
  RESULT,
].join('\n')

const counted: ProviderUsage = {
  provider: 'claude-code',
  name: 'Claude Code',
  windows: [
    { key: 'five_hour', provenance: 'measured', usedPercent: null, resetsAt: null, tokens: 1200, observedAt: NOW },
    { key: 'seven_day', provenance: 'measured', usedPercent: null, resetsAt: null, tokens: 9000, observedAt: NOW },
  ],
}

/** A stand-in `claude` that prints `out` and exits with `code`. */
const standIn = async (name: string, out: string, code = 0) => {
  const file = path.join(dir, name)
  await fsp.writeFile(path.join(dir, `${name}.out`), out)
  await fsp.writeFile(file, `#!/bin/sh\necho "$@" > '${dir}/${name}.args'\npwd > '${dir}/${name}.cwd'\ncat '${dir}/${name}.out'\nexit ${code}\n`, { mode: 0o755 })
  return file
}

const cases: [string, () => Promise<void> | void][] = [
  ['both windows are read, as percentages and reset times', () => {
    const { reading } = parseProbe(FULL, NOW)
    assert.deepEqual(reading, {
      at: NOW,
      windows: { five_hour: { usedPercent: 3, resetsAt: LATER * 1000 }, seven_day: { usedPercent: 13, resetsAt: (LATER + 86_400) * 1000 } },
    })
  }],
  ['the check reports what it used itself, leaving cache reads out like the crystal does', () => {
    assert.equal(parseProbe(FULL, NOW).tokens, 623)
  }],
  ['a window the line leaves out is absent, not filled in', () => {
    const { reading } = parseProbe(event({ five_hour: { utilization: 0.5, resetsAt: LATER } }), NOW)
    assert.deepEqual(Object.keys(reading!.windows), ['five_hour'])
  }],
  ['a share outside 0 to 1 is treated as missing, never clamped', () => {
    assert.equal(parseProbe(event({ five_hour: { utilization: 1.4, resetsAt: LATER }, seven_day: { utilization: 'lots' } }), NOW).reading, null)
  }],
  ['no limits line, or lines that are not JSON, give no reading', () => {
    assert.equal(parseProbe(`${RESULT}\nnot json "rate_limit_event"\n`, NOW).reading, null)
    assert.equal(parseProbe('', NOW).reading, null)
  }],
  ['a reading turns counted windows official, keeping the token count beside the percentage', () => {
    const shown = withOfficial(counted, parseProbe(FULL, NOW).reading, NOW)!
    assert.deepEqual(shown.windows.map((w) => [w.provenance, w.usedPercent, w.tokens, w.observedAt]), [
      ['official', 3, 1200, NOW],
      ['official', 13, 9000, NOW],
    ])
  }],
  ['a window whose reset time has passed loses its percentage', () => {
    const afterFiveHourReset = (LATER + 60) * 1000
    const shown = withOfficial(counted, parseProbe(FULL, NOW).reading, afterFiveHourReset)!
    assert.deepEqual(shown.windows.map((w) => [w.provenance, w.usedPercent]), [['measured', null], ['official', 13]])
    assert.match(shown.note ?? '', /counted instead/)
  }],
  ['once every window has reset, the counted figures stand alone and the note says to check again', () => {
    const shown = withOfficial(counted, parseProbe(FULL, NOW).reading, (LATER + 90_000) * 1000)!
    assert.ok(shown.windows.every((w) => w.provenance === 'measured' && w.usedPercent === null))
    assert.match(shown.note ?? '', /Check again/)
  }],
  ['with no reading, nothing changes', () => {
    assert.equal(withOfficial(counted, null, NOW), counted)
    assert.equal(withOfficial(null, null, NOW), null)
  }],
  ['the check asks for the smallest model, no tools and none of your settings', () => {
    const args = probeArgs()
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    assert.equal(after('--model'), 'haiku')
    assert.equal(after('--tools'), '')
    assert.equal(after('--setting-sources'), '')
    assert.ok(args.includes('--strict-mcp-config'))
  }],
  ['the probe folder is recognised under either of its macOS names, and nothing else is', () => {
    assert.ok(isProbeFolder(PROBE_FOLDER))
    assert.ok(isProbeFolder(`/private${PROBE_FOLDER.replace(/^\/private/, '')}`))
    assert.ok(!isProbeFolder(path.dirname(PROBE_FOLDER)))
    assert.ok(!isProbeFolder(''))
  }],
  ['a whole check: runs in its own folder and returns the reading', async () => {
    const folder = path.join(dir, 'check-here')
    const result = await runProbe(await standIn('claude-ok', FULL), NOW, folder)
    assert.equal(result.ok, true)
    assert.equal(result.reading?.windows.five_hour?.usedPercent, 3)
    assert.equal(result.tokens, 623)
    assert.equal(await fsp.realpath((await fsp.readFile(path.join(dir, 'claude-ok.cwd'), 'utf8')).trim()), await fsp.realpath(folder))
    assert.match(await fsp.readFile(path.join(dir, 'claude-ok.args'), 'utf8'), /--model haiku/)
  }],
  ['a check with no limits line says so, and one that fails says that instead', async () => {
    assert.deepEqual(await runProbe(await standIn('claude-quiet', RESULT), NOW, dir), { ok: false, tokens: 623, error: 'Claude Code did not report limits.' })
    const failed = await runProbe(await standIn('claude-out', 'Not logged in', 1), NOW, dir)
    assert.equal(failed.ok, false)
    assert.match(failed.error ?? '', /signed out/)
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
await fsp.rm(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} probe rules hold.`)
