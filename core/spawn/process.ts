/**
 * Whether a run's Terminal process is still there: the one fact the hooks and the scan cannot give.
 *
 * Hooks only speak once Claude Code has a session, and the scan only sees transcripts. So before
 * this, a launch that died early (Claude Code's "trust this folder?" answered No, the window closed,
 * the command crashing) left its run saying "starting" for fifteen minutes, and a run whose window
 * was still open looked the same as one whose window was gone, so "Resume" could open a second
 * window on a session that was still live. The audit of 15 October 2026 found both in the real app.
 *
 * **How.** The launch script (`launch.ts`) writes two small files into the Grove's own folder,
 * named by the run's id: its process id as it starts, and the tool's exit code as it ends. The
 * Grove reads them on every scan. They are the Grove's own files about its own launch, so nothing
 * here touches another tool's data.
 *
 *   - An exit file means the tool has stopped, with its code.
 *   - A process id that is no longer running means the window was closed hard enough that the
 *     script never wrote its exit file. Counted as stopped, with no code.
 *   - Neither file means the run predates this, or Terminal has not opened the script yet. Nothing
 *     is concluded from that.
 *
 * A process id can be reused by the system for something else once its owner is gone, so an
 * "alive" answer is slightly generous. The exit file is the strong signal; the id is the fallback
 * for a window closed mid-run, and in that case the Grove only learns late, never wrongly early.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { groveHome } from '../state/grove.ts'

export type RunProcess =
  | { state: 'unknown' }
  | { state: 'alive'; pid: number }
  /** `code` is null when the window was closed before the script could write it. `at` is when it stopped, as best known. */
  | { state: 'gone'; code: number | null; at: number }

export const processFolder = (): string => path.join(groveHome(), 'run-processes')
export const pidFile = (runId: string, folder = processFolder()): string => path.join(folder, `${runId}.pid`)
export const exitFile = (runId: string, folder = processFolder()): string => path.join(folder, `${runId}.exit`)

/** Whether a process with this id exists. `EPERM` means it exists but belongs to someone else. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A whole non-negative number on the first line, or null. The files are short and ours, but read defensively. */
function wholeNumber(text: string): number | null {
  const line = text.trim().split('\n')[0] ?? ''
  return /^\d{1,10}$/.test(line) ? Number(line) : null
}

/** What the run's two files say. Never throws: an unreadable file is the same as no file. */
export async function readRunProcess(runId: string, folder = processFolder(), alive = pidAlive, now = Date.now()): Promise<RunProcess> {
  const exit = exitFile(runId, folder)
  const ended = await fsp.stat(exit).catch(() => null)
  if (ended) {
    const code = wholeNumber(await fsp.readFile(exit, 'utf8').catch(() => ''))
    return { state: 'gone', code, at: ended.mtimeMs }
  }
  const pid = wholeNumber(await fsp.readFile(pidFile(runId, folder), 'utf8').catch(() => ''))
  if (pid === null || pid === 0) return { state: 'unknown' }
  return alive(pid) ? { state: 'alive', pid } : { state: 'gone', code: null, at: now }
}

/** Forget a run's process, before resuming it, so the last attempt's exit is not read as this one's. */
export async function clearRunProcess(runId: string, folder = processFolder()): Promise<void> {
  await Promise.all([fsp.rm(pidFile(runId, folder), { force: true }), fsp.rm(exitFile(runId, folder), { force: true })]).catch(() => {})
}

/**
 * Remove the files of runs the run book no longer keeps (it holds the newest 200), so the folder
 * does not grow for ever. Only names shaped like ours are touched.
 */
export async function pruneRunProcesses(keep: Set<string>, folder = processFolder()): Promise<void> {
  const names = await fsp.readdir(folder).catch(() => [] as string[])
  for (const name of names) {
    const match = /^([0-9a-f-]{8,64})\.(pid|exit)$/i.exec(name)
    if (match && !keep.has(match[1]!)) await fsp.rm(path.join(folder, name), { force: true }).catch(() => {})
  }
}
