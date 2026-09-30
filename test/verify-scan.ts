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
import { deriveStones, wantsYou, ERROR_ALARM_MS } from '../core/state/stones.ts'
import { defaultGrove, parseGrove } from '../core/state/schema.ts'
import { loadGrove } from '../core/state/grove.ts'
import type { Session } from '../core/harnesses/types.ts'

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

// Every nested file is either a subagent's conversation (a sidechain) or a workflow's journal.
// If this ever fails, the exclusion above may be throwing away somebody's actual work, and the
// shape of the data has changed.
//
// Workflow journals (`subagents/workflows/wf_<id>/journal.jsonl`, first record
// `{"type":"launched"}`) were found on 30 September 2026: Claude Code keeps one per multi-agent
// workflow, holding only launched / started / result markers. They are bookkeeping, not
// conversations, so leaving them out of the session count is right.
const isWorkflowJournal = (file: string) =>
  path.basename(file) === 'journal.jsonl' && file.split(path.sep).includes('workflows') && firstRecord(file)?.type === 'launched'
const unexplained = nested.filter((file) => firstRecord(file)?.isSidechain !== true && !isWorkflowJournal(file))
const journals = nested.filter(isWorkflowJournal).length
check(
  'every nested transcript is a sidechain or a workflow journal',
  unexplained.length === 0,
  unexplained.length
    ? `${unexplained.length} of ${nested.length} are neither, for example ${path.relative(claudeProjects, unexplained[0]!)} ` +
        `(first record type "${String(firstRecord(unexplained[0]!)?.type ?? 'unreadable')}")`
    : `${nested.length - journals} carry isSidechain: true on their first record, ${journals} are workflow journals`
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
 * Deriving stones from those sessions
 *
 * Checked against the real grove first, then against sessions made up on the spot for the cases
 * this machine happens not to have. `deriveStones` is pure precisely so that second half is
 * possible — no disk, no clock but the one it is handed.
 * ---------------------------------------------------------------------------------------- */

const loaded = await loadGrove()
const derived = deriveStones(result.sessions, loaded.grove)

check(
  'no two stones share a name',
  new Set(derived.stones.map((s) => s.name)).size === derived.stones.length,
  // The failure this catches is two monoliths in the grove you cannot tell apart, which is the
  // whole reason core/scan.ts bothers to disambiguate colliding project names.
  (() => {
    const names = derived.stones.map((s) => s.name)
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
    return dupes.length ? `duplicated: ${dupes.join(', ')}` : `${names.length} distinct names`
  })()
)

check(
  'no two stones share an id',
  new Set(derived.stones.map((s) => s.id)).size === derived.stones.length,
  `${derived.stones.length} stones, ${new Set(derived.stones.map((s) => s.id)).size} distinct ids`
)

// Nothing may be lost or double-counted on the way from sessions to stones. A session is either
// on exactly one stone, hidden with its project, or counted as outside every project.
const placed = derived.stones.flatMap((stone) => stone.sessions.map((session) => session.id))
const hiddenCount = derived.hidden.reduce((total, entry) => total + entry.sessionCount, 0)
check(
  'every session is placed, hidden or counted, exactly once',
  placed.length === new Set(placed).size &&
    placed.length + hiddenCount + derived.unconnectedSessions === result.sessions.length,
  `${result.sessions.length} sessions in: ${placed.length} on stones, ${hiddenCount} hidden, ${derived.unconnectedSessions} outside any project`
)

// Deriving twice from the same input must give the same answer. A stone whose name or status
// depended on iteration order would move around the grove between polls for no reason.
const again = deriveStones(result.sessions, loaded.grove)
check(
  'deriving twice gives the same grove',
  JSON.stringify(derived) === JSON.stringify(again),
  'stable across two runs'
)

/* Synthetic cases. These are the rules most likely to be argued with later, so they are pinned
 * here with sessions invented for the purpose rather than left to whatever this machine has. */

const NOW = 1_800_000_000_000

/** A grove with the fake sessions' folder connected, since only connected folders are stones. */
const DEMO = { ...defaultGrove(), stones: [{ path: '/tmp/demo' }] }

function fakeSession(overrides: Partial<Session>): Session {
  return {
    id: 'fake:1',
    harness: 'claude-code',
    harnessName: 'Claude Code',
    title: 'A made-up session',
    preview: '',
    project: 'demo',
    projectPath: '/tmp/demo',
    worktree: '',
    cwd: '/tmp/demo',
    gitBranch: '',
    model: '',
    effort: '',
    createdAt: NOW,
    lastActivityAt: NOW,
    lastFocusedAt: 0,
    status: 'idle',
    statusProvenance: 'inferred',
    unread: false,
    unreadProvenance: 'unknown',
    sizeBytes: 0,
    archived: false,
    source: 'cli',
    canOpen: false,
    ref: {},
    ...overrides,
  }
}

// An error from last week must not keep a stone lit. A grove with a permanently red stone in it
// teaches you to ignore red, which costs you the next real one.
const staleError = fakeSession({
  id: 'fake:stale',
  status: 'errored',
  lastActivityAt: NOW - ERROR_ALARM_MS - 1,
})
const staleStone = deriveStones([staleError], DEMO, NOW).stones[0]
check(
  'an error older than a day stops setting the stone colour',
  staleStone?.status === 'idle' && !wantsYou(staleError, NOW),
  `stone reads "${staleStone?.status}", and the session no longer asks for you — the session itself still reports "errored"`
)

const freshError = fakeSession({ id: 'fake:fresh', status: 'errored', lastActivityAt: NOW - 60_000 })
const freshStone = deriveStones([freshError], DEMO, NOW).stones[0]
check(
  'an error from a minute ago does set it',
  freshStone?.status === 'errored' && wantsYou(freshError, NOW),
  `stone reads "${freshStone?.status}"`
)

// Waiting outranks errored: one is something you can act on now, the other already happened.
const mixed = deriveStones(
  [
    fakeSession({ id: 'fake:err', status: 'errored', lastActivityAt: NOW - 1000 }),
    fakeSession({ id: 'fake:wait', status: 'waiting', lastActivityAt: NOW - 2000 }),
    fakeSession({ id: 'fake:run', status: 'running', lastActivityAt: NOW }),
  ],
  DEMO,
  NOW
).stones[0]
check(
  'a stone shows the most urgent thing on it',
  mixed?.status === 'waiting',
  `running + errored + waiting on one stone reads as "${mixed?.status}"`
)

// A stone is only as trustworthy as the sessions setting its colour.
const provenance = deriveStones(
  [
    fakeSession({ id: 'fake:a', status: 'running', statusProvenance: 'measured' }),
    fakeSession({ id: 'fake:b', status: 'running', statusProvenance: 'inferred' }),
  ],
  DEMO,
  NOW
).stones[0]
check(
  'a stone takes the weakest provenance of the sessions lighting it',
  provenance?.statusProvenance === 'inferred',
  `measured + inferred reads as "${provenance?.statusProvenance}"`
)

// A new grove is empty. Nothing becomes a stone until you connect it, however much work the
// scan finds, and that work is offered back as suggestions instead.
const fresh = deriveStones([fakeSession({ id: 'fake:loose', projectPath: '/tmp/elsewhere', project: 'elsewhere' })], defaultGrove(), NOW)
check(
  'a new grove has no stones, and offers the work it saw',
  fresh.stones.length === 0 && fresh.unconnectedSessions === 1 && fresh.suggestions[0]?.path === '/tmp/elsewhere',
  `${fresh.stones.length} stones, ${fresh.suggestions.length} suggestion(s)`
)

// A connected project stands even with nothing in it, and work in any folder under it lights it.
// The nearest connected folder wins, and a sibling that merely shares a prefix is not inside.
const connected = deriveStones(
  [
    fakeSession({ id: 'fake:deep', projectPath: '/tmp/work/site/src', project: 'src', status: 'running' }),
    fakeSession({ id: 'fake:sibling', projectPath: '/tmp/work/site-old', project: 'site-old' }),
  ],
  { ...defaultGrove(), stones: [{ path: '/tmp/work' }, { path: '/tmp/work/site' }, { path: '/tmp/empty' }] },
  NOW
)
const site = connected.stones.find((s) => s.path === '/tmp/work/site')
const work = connected.stones.find((s) => s.path === '/tmp/work')
check(
  'work in a subfolder lights the nearest connected project',
  site?.status === 'running' &&
    work?.sessions.map((s) => s.id).join() === 'fake:sibling' &&
    connected.stones.some((s) => s.path === '/tmp/empty' && s.sessions.length === 0),
  'site/src lights site, site-old stays with work, an empty project still stands'
)

// Scratch folders are real work, but never worth offering as a project.
const scratchPath = `${HOME}/Library/Application Support/Claude/scratch-workspaces/x/y/scratch-1`
const codexChat = `${HOME}/Documents/Codex/2026-09-14/lev`
const offered = deriveStones(
  [
    fakeSession({ id: 'fake:scratch', projectPath: scratchPath, project: 'scratch-1' }),
    fakeSession({ id: 'fake:codex', projectPath: codexChat, project: 'lev' }),
  ],
  defaultGrove(),
  NOW
)
check(
  'scratch and chat folders are never suggested',
  offered.suggestions.length === 0 && offered.unconnectedSessions === 2,
  'a Claude scratch workspace and a Codex chat folder are counted, not offered'
)

// Hiding a project must remove it from the grove without losing the session from the totals —
// hidden and gone are different things, and the interface has to be able to offer it back.
const hiddenGrove = deriveStones(
  [fakeSession({ id: 'fake:hide', projectPath: '/tmp/secret', project: 'secret' })],
  { ...defaultGrove(), stones: [{ path: '/tmp/secret', hidden: true }] },
  NOW
)
check(
  'a hidden project leaves the grove but is still reported',
  !hiddenGrove.stones.some((s) => s.path === '/tmp/secret') &&
    hiddenGrove.hidden.length === 1 &&
    hiddenGrove.totalSessions === 0,
  `hidden: ${hiddenGrove.hidden.map((h) => `${h.name} (${h.sessionCount})`).join(', ')}`
)

/* -------------------------------------------------------------------------------------------
 * grove.json, which a person edits by hand and will therefore sometimes get wrong
 * ---------------------------------------------------------------------------------------- */

// Garbage in must not take the app down, and must not be silently swallowed either.
const nonsense = parseGrove({
  version: 1,
  settings: { claudePlan: 'platinum', scanIntervalMs: 5 },
  stones: [{ path: 'not-absolute' }, { path: '/tmp/ok', runes: [{ id: 'r' }] }],
  agents: [{ name: 'no id' }],
})
check(
  'a hand-edited grove.json survives being wrong, and says how',
  nonsense.problems.length === 5 && nonsense.grove.settings.claudePlan === 'pro',
  `${nonsense.problems.length} problems reported, defaults kept: ` +
    nonsense.problems.map((p) => p.where).join(', ')
)

check(
  'a valid grove.json round-trips through parsing unchanged',
  JSON.stringify(parseGrove(defaultGrove()).grove) === JSON.stringify(defaultGrove()),
  'defaults parse back to themselves'
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
