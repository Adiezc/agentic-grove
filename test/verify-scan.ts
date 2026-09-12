/**
 * `npm run verify` — check the scanner against the raw files, independently.
 *
 * The scan itself is one opinion about what is on this machine. This is a second one, arrived at
 * differently: it counts files with its own code, works out from their contents how many *should*
 * be sessions, and complains if the scanner disagrees. Two implementations that agree are worth
 * far more than one that looks convincing.
 *
 * It exists because the whole project rests on this data being true. If the grove shows six
 * agents when four are running it is a screensaver with extra steps, and the failure would be
 * invisible — a wrong number looks exactly like a right one.
 *
 * Deliberately duplicated rather than shared: importing the adapters' own helpers would make
 * this agree with them by construction, which is the one thing a check must not do.
 *
 * Read-only, like everything else here.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scan } from '../core/scan.ts'

const HOME = os.homedir()

const results: { ok: boolean; label: string; detail: string }[] = []

function check(label: string, ok: boolean, detail: string): void {
  results.push({ ok, label, detail })
}

/** Every file under a directory, at any depth. */
function walk(dir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const firstRecord = (file: string): Record<string, unknown> | null => {
  try {
    for (const line of fs.readFileSync(file, 'utf8').slice(0, 500_000).split('\n')) {
      if (!line.trim().startsWith('{')) continue
      return JSON.parse(line) as Record<string, unknown>
    }
  } catch {
    /* unreadable or mid-write */
  }
  return null
}

const result = await scan()
const byHarness = (id: string) => result.sessions.filter((s) => s.harness === id)

/* -------------------------------------------------------------------------------------------
 * Claude Code
 * ---------------------------------------------------------------------------------------- */

const claudeProjects = path.join(HOME, '.claude', 'projects')
const allClaudeTranscripts = walk(claudeProjects).filter((f) => f.endsWith('.jsonl'))

// A subagent transcript sits one folder deeper, under `<sessionId>/subagents/`. Counted here by
// its position on disk rather than by asking the adapter what it thinks a subagent is.
const isNested = (file: string) =>
  path.relative(claudeProjects, file).split(path.sep).length > 2
const topLevel = allClaudeTranscripts.filter((f) => !isNested(f))
const nested = allClaudeTranscripts.filter(isNested)

check(
  'Claude subagent transcripts are excluded',
  byHarness('claude-code').length === topLevel.length,
  `${allClaudeTranscripts.length} transcripts on disk, ${nested.length} of them subagent ` +
    `passes in a nested folder, so ${topLevel.length} real sessions — the scan reports ` +
    `${byHarness('claude-code').length}`
)

// Every nested transcript really is a sidechain. If this ever fails, the exclusion above is
// throwing away somebody's actual work and the shape of the data has changed.
const nestedAreSidechains = nested.every((file) => firstRecord(file)?.isSidechain === true)
check(
  'every nested transcript is genuinely a sidechain',
  nested.length === 0 || nestedAreSidechains,
  nested.length === 0
    ? 'no nested transcripts on this machine'
    : `all ${nested.length} carry isSidechain: true on their first record`
)

/* -------------------------------------------------------------------------------------------
 * The live process, which is the one genuinely checkable fact
 * ---------------------------------------------------------------------------------------- */

const liveDir = path.join(HOME, '.claude', 'sessions')
const liveRecords = walk(liveDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  })
  .filter((r): r is Record<string, unknown> => r !== null)
  .filter((r) => {
    // The registry keeps files for processes that have exited, so ask the OS.
    try {
      process.kill(Number(r.pid), 0)
      return true
    } catch {
      return false
    }
  })

// This is the strongest check in the file. These sessions demonstrably exist — there is a
// process answering for each one — so every one of them must appear in the scan, and must not
// be sitting there marked idle.
for (const live of liveRecords) {
  const sessionId = String(live.sessionId)
  const found = result.sessions.find((s) => s.id === `claude-code:${sessionId}`)
  check(
    `live process ${live.pid} appears in the scan`,
    Boolean(found),
    found
      ? `${found.project} — ${found.status}, last activity ${Math.round((Date.now() - found.lastActivityAt) / 1000)}s ago`
      : `session ${sessionId} in ${String(live.cwd)} is running right now and the scan missed it`
  )
  if (found) {
    check(
      `live process ${live.pid} is not reported as idle`,
      found.status !== 'idle',
      `reported as "${found.status}" (${found.statusProvenance})`
    )
    check(
      `live process ${live.pid} is attributed to the right folder`,
      found.cwd === String(live.cwd),
      found.cwd === String(live.cwd)
        ? found.cwd
        : `scan says ${found.cwd}, the process says ${String(live.cwd)}`
    )
  }
}

// Nothing may be marked running without a live process behind it. This is the check that would
// catch the grove glowing with work that finished days ago.
const liveIds = new Set(liveRecords.map((r) => `claude-code:${String(r.sessionId)}`))
const claimingActive = byHarness('claude-code').filter(
  (s) => s.status === 'running' || s.status === 'waiting'
)
check(
  'nothing Claude-side claims to be active without a live process',
  claimingActive.every((s) => liveIds.has(s.id)),
  `${claimingActive.length} session(s) reported running or waiting, ${liveRecords.length} live process(es) on the machine`
)

/* -------------------------------------------------------------------------------------------
 * Codex
 * ---------------------------------------------------------------------------------------- */

const codexHome = process.env.CODEX_HOME || path.join(HOME, '.codex')
const rollouts = walk(path.join(codexHome, 'sessions')).filter(
  (f) => path.basename(f).startsWith('rollout-') && f.endsWith('.jsonl')
)

// Counted from each rollout's own header, with this file's own reading of what machinery looks
// like. Kept separate from the adapter's `isSubagent` on purpose.
let codexReal = 0
let codexMachinery = 0
for (const file of rollouts) {
  const record = firstRecord(file)
  const payload =
    record && typeof record.payload === 'object' && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : {}
  const machinery =
    Boolean(payload.parent_thread_id) ||
    (typeof payload.source === 'object' && payload.source !== null && 'subagent' in payload.source) ||
    payload.thread_source === 'subagent'
  if (machinery) codexMachinery += 1
  else codexReal += 1
}

// The database can also hold sessions whose transcript has since been cleared, so the scan is
// allowed to report *more* than the transcripts alone account for — but never fewer, and never
// so many that the machinery is plainly getting through.
const codexCount = byHarness('codex').length
check(
  'Codex subagent passes are excluded',
  codexCount >= codexReal && codexCount < codexReal + codexMachinery,
  `${rollouts.length} rollouts on disk: ${codexReal} real, ${codexMachinery} machinery — ` +
    `the scan reports ${codexCount} session${codexCount === 1 ? '' : 's'}` +
    (codexCount > codexReal ? ` (${codexCount - codexReal} from the database with no transcript on disk)` : '')
)

// A blunter version of the same thing, and the one that would have caught the bug this file was
// written to find: the review passes were titled after their own boilerplate prompt.
const looksLikeMachinery = byHarness('codex').filter(
  (s) => s.model.includes('auto-review') || s.title.startsWith('The following is the Codex agent history')
)
check(
  'no Codex review pass is being shown as a session',
  looksLikeMachinery.length === 0,
  looksLikeMachinery.length
    ? `${looksLikeMachinery.length} still getting through: ${looksLikeMachinery.map((s) => s.model || s.id).join(', ')}`
    : 'none'
)

/* -------------------------------------------------------------------------------------------
 * Shape of the data itself
 * ---------------------------------------------------------------------------------------- */

check(
  'every session id is unique',
  new Set(result.sessions.map((s) => s.id)).size === result.sessions.length,
  `${result.sessions.length} sessions, ${new Set(result.sessions.map((s) => s.id)).size} distinct ids`
)

// `undefined` reaching the interface is how a field quietly becomes "the empty string" in one
// place and "NaN" in another. The adapter contract says every field is always present.
const REQUIRED = [
  'id',
  'harness',
  'title',
  'project',
  'projectPath',
  'status',
  'statusProvenance',
  'lastActivityAt',
  'sizeBytes',
] as const
const incomplete = result.sessions.filter((session) =>
  REQUIRED.some((field) => session[field] === undefined || session[field] === null)
)
check(
  'no session is missing a required field',
  incomplete.length === 0,
  incomplete.length ? `${incomplete.length} incomplete: ${incomplete.map((s) => s.id).join(', ')}` : 'all present'
)

const badTimestamps = result.sessions.filter(
  (s) => !Number.isFinite(s.lastActivityAt) || s.lastActivityAt > Date.now() + 60_000
)
check(
  'no timestamp is NaN or in the future',
  badTimestamps.length === 0,
  badTimestamps.length ? badTimestamps.map((s) => `${s.id} @ ${s.lastActivityAt}`).join(', ') : 'all sane'
)

check(
  'no harness failed to scan',
  result.problems.length === 0,
  result.problems.length ? result.problems.map((p) => `${p.harness}: ${p.message}`).join('; ') : 'none'
)

// The poll runs every few seconds, all day. A pass that takes longer than a second is a problem
// worth seeing early, while it is still a number rather than a stutter in the animation.
check(
  'a scan pass is fast enough to poll on',
  result.durationMs < 1000,
  `${result.durationMs}ms`
)

/* -------------------------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------------------------- */

const paint = process.stdout.isTTY
const colour = (code: string, text: string) => (paint ? `\u001b[${code}m${text}\u001b[0m` : text)

console.log()
for (const { ok, label, detail } of results) {
  console.log(`  ${ok ? colour('32', 'PASS') : colour('31', 'FAIL')}  ${label}`)
  console.log(`        ${colour('2', detail)}`)
}

const failed = results.filter((r) => !r.ok)
console.log()
console.log(
  failed.length
    ? colour('31', `  ${failed.length} of ${results.length} checks failed.`)
    : colour('32', `  all ${results.length} checks passed.`)
)
console.log()

process.exit(failed.length ? 1 : 0)
