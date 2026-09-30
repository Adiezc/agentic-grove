/**
 * When the Grove taps you on the shoulder: which run changes earn a macOS notification.
 *
 * The Grove is meant to sit on a screen all day, so it only interrupts for work *it started* (a
 * run, not every session on the Mac) and only when the news would change what you do next:
 *
 *   - **Failed**: always. A job that never started is the one you most need to hear about.
 *   - **Finished**: when it had been working for at least a minute. A long job finishing is the
 *     moment you would otherwise keep checking for; a quick back-and-forth in Terminal, where you
 *     are already looking, would ping you on every reply.
 *   - **Needs you** (a permission prompt or a question): only if you switch it on. The brief's
 *     default is calm: the stone turns amber and a mote rises from it, and the Grove waits. It never
 *     answers for an agent.
 *
 * Nothing is sent while a Grove window is in front of you: the stone and the toast already say it.
 * No sound, ever, unless a later setting adds one. Pure, so each rule has a check in
 * `test/verify-attention.ts`.
 */
import type { Run, RunState } from './spawn/runs.ts'

/** Working time before a finished run is worth a notification. */
export const WORTH_TELLING_AFTER_MS = 60_000

export interface NotifySettings {
  notifyFinished: boolean
  notifyNeedsYou: boolean
}

export interface Notice {
  title: string
  body: string
}

/** The stone's name when none is given: the last part of the project folder. */
const place = (run: Run) => run.stoneId.split('/').filter(Boolean).pop() ?? run.stoneId

/** The start of the task, for the second line. */
function gist(run: Run): string {
  const task = run.task.replace(/\s+/g, ' ').trim()
  if (!task) return ''
  return task.length > 80 ? `${task.slice(0, 79)}…` : task
}

/**
 * The notice for a change, or `null` for none. `from` and `since` describe the state the run has
 * just left: which one, and when it began.
 */
export function noticeFor(
  run: Run,
  from: RunState,
  since: number,
  now: number,
  settings: NotifySettings,
  where = place(run)
): Notice | null {
  if (run.state === from) return null
  if (run.state === 'failed') {
    return { title: `${run.agentName} could not start on ${where}`, body: run.error ?? gist(run) }
  }
  if (run.state === 'finished' && from === 'running' && settings.notifyFinished && now - since >= WORTH_TELLING_AFTER_MS) {
    return { title: `${run.agentName} finished on ${where}`, body: gist(run) }
  }
  if (run.state === 'waiting' && settings.notifyNeedsYou) {
    return { title: `${run.agentName} needs you on ${where}`, body: 'Answer it in Terminal.' }
  }
  return null
}
