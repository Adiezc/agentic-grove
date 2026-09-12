/**
 * `npm run scan` — print every agent session on this machine, and stop.
 *
 * This exists to answer one question before any pixel is drawn: **is the data true?** If the
 * list here does not match what is actually open, the grove would be a screensaver, however
 * good it looked. So it prints plainly, labels how much each claim can be trusted, and shows
 * the paths it looked in so a wrong answer can be chased down.
 *
 * `npm run watch` runs the same thing on the real poll loop, which is the honest test of the
 * scan: leave it running, start a session somewhere else, and watch it appear.
 *
 * Nothing in here is imported by the app. It is a truth check, and it is meant to stay one.
 */
import { scan, startScanLoop, type ScanResult } from '../scan.ts'
import { HARNESSES } from '../harnesses/index.ts'
import type { Session, SessionStatus } from '../harnesses/types.ts'

/* ANSI colours. The grove's palette, roughly, and only ever decoration — every line still
 * reads correctly with the escapes stripped, which is what happens when output is piped. */
const paint = process.stdout.isTTY
const c = (code: string, text: string) => (paint ? `\u001b[${code}m${text}\u001b[0m` : text)
const dim = (t: string) => c('2', t)
const bold = (t: string) => c('1', t)
const green = (t: string) => c('32', t)
const brightGreen = (t: string) => c('92', t)
const yellow = (t: string) => c('33', t)
const red = (t: string) => c('31', t)

/**
 * How each status reads at a glance, and what it will eventually be in the grove.
 *
 * The glyphs matter more than they look: this list is meant to be scanned down, not read, which
 * is the same job the stones do in the scene.
 */
const STATUS: Record<SessionStatus, { glyph: string; label: string; colour: (t: string) => string }> = {
  running: { glyph: '*', label: 'running', colour: brightGreen },
  waiting: { glyph: '?', label: 'waiting', colour: yellow },
  errored: { glyph: '!', label: 'errored', colour: red },
  idle: { glyph: '.', label: 'idle', colour: dim },
}

/** `3m`, `4h`, `12d`. Absolute timestamps are unreadable in a list this long. */
function ago(timestamp: number): string {
  if (!timestamp) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function size(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

/** Pad to a column width, and truncate with an ellipsis rather than wrapping. */
function fit(text: string, width: number): string {
  if (text.length <= width) return text.padEnd(width)
  return text.slice(0, Math.max(0, width - 1)) + '…'
}

/**
 * The provenance marker.
 *
 * A single character, because principle two of this project is "never invent a number" and this
 * is what that looks like in practice — a status you can see the confidence of without being
 * lectured about it. `~` is an inference, `=` is something actually measured, `?` is unknown.
 */
function mark(provenance: string): string {
  switch (provenance) {
    case 'measured':
      return dim('=')
    case 'official':
      return green('=')
    case 'inferred':
      return dim('~')
    default:
      return dim('?')
  }
}

/**
 * Whether this session is actually asking for something.
 *
 * Not the same as `unread`. A session that is *running* has moved on since you last looked at
 * it — that is what running means — so flagging it would put a marker beside every busy session
 * in the grove, which is precisely the "nothing pulls the eye unless it has earned it" line.
 * What earns it: a session holding the turn back waiting for you, one that errored, or one that
 * finished while you were not looking.
 */
function wantsYou(session: Session): boolean {
  if (session.status === 'waiting' || session.status === 'errored') return true
  return session.status === 'idle' && session.unread
}

function printSession(session: Session): void {
  const status = STATUS[session.status]
  const model = session.model || dim('—')
  const branch = session.gitBranch ? dim(`  ${session.gitBranch}`) : ''
  const worktree = session.worktree ? dim(` +${session.worktree}`) : ''
  const attention = wantsYou(session) ? yellow(' <—') : ''

  console.log(
    `  ${status.colour(status.glyph)} ${mark(session.statusProvenance)} ` +
      `${status.colour(fit(status.label, 8))} ` +
      `${bold(fit(session.project + worktree, 26))} ` +
      `${fit(typeof model === 'string' ? model : '', 22)} ` +
      `${dim(fit(ago(session.lastActivityAt), 5))} ` +
      `${dim(fit(size(session.sizeBytes), 6))} ` +
      `${fit(session.title, 44)}${branch}${attention}`
  )
}

function report(result: ScanResult): void {
  const { sessions, harnesses, problems, durationMs } = result

  console.log()
  console.log(bold(green('  agentic grove')) + dim(`  ·  scan in ${durationMs}ms`))
  console.log()

  // Which tools are installed, and anything each one wants to say about itself. Printed first,
  // because "no Codex sessions" means something entirely different when Codex is not installed.
  for (const harness of harnesses) {
    const count = sessions.filter((s) => s.harness === harness.id).length
    const state = harness.detected
      ? `${count} session${count === 1 ? '' : 's'}`
      : dim('not installed on this machine')
    console.log(`  ${harness.detected ? green('•') : dim('◦')} ${fit(harness.name, 14)} ${state}`)
    if (harness.diagnostic) console.log(`    ${yellow('note')} ${dim(harness.diagnostic)}`)
  }

  for (const problem of problems) {
    console.log(`  ${red('×')} ${fit(problem.harness, 14)} ${red(`failed to scan: ${problem.message}`)}`)
  }

  if (!sessions.length) {
    console.log()
    console.log(dim('  No agent sessions found. The paths searched were:'))
    for (const harness of HARNESSES) {
      for (const [name, value] of Object.entries(harness.paths)) {
        console.log(dim(`    ${harness.id}  ${name}  ${value}`))
      }
    }
    console.log()
    return
  }

  // Grouped by project, because that is what a runestone is, and because seeing the grouping
  // here is the first check that the grove will have the right stones in it.
  const byProject = new Map<string, Session[]>()
  for (const session of sessions) {
    const list = byProject.get(session.project) ?? []
    list.push(session)
    byProject.set(session.project, list)
  }

  console.log()
  console.log(
    dim('  status') +
      dim('     ') +
      dim(fit('project', 26)) +
      ' ' +
      dim(fit('model', 22)) +
      ' ' +
      dim(fit('seen', 5)) +
      ' ' +
      dim(fit('size', 6)) +
      ' ' +
      dim('title')
  )

  for (const [project, group] of byProject) {
    console.log()
    console.log(dim(`  ${project}  ${group[0]?.projectPath ?? ''}`))
    for (const session of group) printSession(session)
  }

  // The counts the definition of done is checked against.
  const count = (status: SessionStatus) => sessions.filter((s) => s.status === status).length
  const attention = sessions.filter(wantsYou).length

  console.log()
  console.log(
    `  ${bold(String(sessions.length))} sessions` +
      `  ·  ${brightGreen(`${count('running')} running`)}` +
      `  ·  ${yellow(`${count('waiting')} waiting`)}` +
      `  ·  ${dim(`${count('idle')} idle`)}` +
      (count('errored') ? `  ·  ${red(`${count('errored')} errored`)}` : '') +
      `  ·  ${String(byProject.size)} projects` +
      (attention ? `  ·  ${yellow(`${attention} want you`)}` : '')
  )
  console.log(
    dim('  provenance:  = measured, from something we actually tested   ') +
      dim('~ inferred, a reading of files on disk   ? unknown')
  )
  console.log()
}

const watching = process.argv.includes('--watch')

if (watching) {
  console.log(dim('  watching. start or stop a session somewhere else and it should appear here.'))
  console.log(dim('  ctrl-c to stop.'))
  const stop = startScanLoop(report, 5000)
  process.on('SIGINT', () => {
    stop()
    process.exit(0)
  })
} else {
  report(await scan())
}
