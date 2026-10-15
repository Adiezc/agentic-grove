/**
 * Stopping a run from the Grove: the same as pressing Ctrl-C in its Terminal window, then, if
 * that is ignored, asking it to quit.
 *
 * **Only the tool, only ours.** The launch script records its own process id (`process.ts`); the
 * tool is that script's child. So the signal goes to the direct children of a process the Grove
 * itself started, and to nothing found by name. A broad `pkill claude` would stop every Claude Code
 * session on the Mac, including ones you started yourself and the one that may be building this.
 *
 * **Checked before it is trusted.** A process id is reused by the system once its owner is gone,
 * so the recorded id is only acted on while `process.ts` reads it alive *and* the process with that
 * id is still running a launch script the Grove wrote (its command names one of our
 * `agentic-grove-run-…/….command` files). Anything else is refused, never guessed at.
 *
 * **Why SIGINT first.** It is what Ctrl-C sends, so Claude Code stops the way it does when you press
 * it: the transcript is saved and the session can be resumed. SIGTERM follows only if the tool is
 * still there a few seconds later. Nothing stronger is sent: a tool that ignores both is left for
 * you to close, rather than killed mid-write.
 *
 * The script itself is not signalled. It outlives the tool by one line, to write the exit code,
 * and that exit file is how the run becomes Closed through the usual `onProcess` path.
 */
import { execFile } from 'node:child_process'
import { pidAlive, processFolder, readRunProcess } from './process.ts'

/** One row of the process table: id, parent id, and the command line. */
export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

export type StopResult = { ok: true; signal: 'SIGINT' | 'SIGTERM' } | { ok: false; error: string }

/** A launch script `launch.ts` wrote: a private `agentic-grove-run-` folder holding a `.command` file. */
const OUR_SCRIPT = /\/agentic-grove-run-[^/\s]+\/[^/\s]+\.command(\s|$)/

/** The whole process table, read once. `ps` is on every Mac; nothing here needs a shell. */
export function processTable(): Promise<ProcessRow[]> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([])
      const rows: ProcessRow[] = []
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
        if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! })
      }
      resolve(rows)
    })
  })
}

/** Send a signal. A process that has gone meanwhile is fine: that is what was wanted. */
function send(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {}
}

export interface StopOptions {
  folder?: string
  /** How long to wait after SIGINT, and again after SIGTERM, before giving up on each. */
  graceMs?: number
  table?: () => Promise<ProcessRow[]>
}

/**
 * The tool processes of a run's launch script, or why there are none to stop. Exported for the
 * checks, which compare it against a real zsh running a stand-in tool.
 */
export async function runTools(runId: string, options: StopOptions = {}): Promise<{ pids: number[] } | { error: string }> {
  const seen = await readRunProcess(runId, options.folder ?? processFolder())
  if (seen.state !== 'alive') return { error: 'Its Terminal window has already closed.' }
  const { pid } = seen
  if (pid <= 1 || pid === process.pid) return { error: 'That process is not one the Grove started.' }
  const rows = await (options.table ?? processTable)()
  const script = rows.find((row) => row.pid === pid)
  if (!script || !OUR_SCRIPT.test(script.command)) return { error: 'That process is not one the Grove started.' }
  const pids = rows.filter((row) => row.ppid === pid && row.pid > 1 && row.pid !== process.pid).map((row) => row.pid)
  if (!pids.length) return { error: 'Nothing is running in its window any more.' }
  return { pids }
}

/** True once none of these processes is left. Polled, because a signal's effect is not instant. */
async function goneWithin(pids: number[], ms: number): Promise<boolean> {
  const until = Date.now() + ms
  for (;;) {
    if (!pids.some(pidAlive)) return true
    if (Date.now() >= until) return false
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** Stop a run's tool: SIGINT, then SIGTERM if it is still there after `graceMs`. */
export async function stopRun(runId: string, options: StopOptions = {}): Promise<StopResult> {
  const found = await runTools(runId, options)
  if ('error' in found) return { ok: false, error: found.error }
  const grace = options.graceMs ?? 4000
  for (const pid of found.pids) send(pid, 'SIGINT')
  if (await goneWithin(found.pids, grace)) return { ok: true, signal: 'SIGINT' }
  for (const pid of found.pids) send(pid, 'SIGTERM')
  if (await goneWithin(found.pids, grace)) return { ok: true, signal: 'SIGTERM' }
  return { ok: false, error: 'It did not stop. Close its Terminal window to end it.' }
}
