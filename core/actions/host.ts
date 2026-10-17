/**
 * What PM's actions need from the running app, handed over once by `electron/main.ts`.
 *
 * The actions live in `core/` and must stay free of Electron, but a few of them need the app's
 * live state: the grove as the last scan saw it, the runs the Grove started, the launcher that
 * sends an agent to a stone (`launchRun` in `main.ts`, with every check it already makes), and a
 * way to say "grove.json changed, redraw". So the app passes those in as plain functions, and the
 * checks in `test/verify-actions.ts` pass in stand-ins.
 *
 * Without a host (a script, a test that sets none) the actions still work on `grove.json` alone:
 * the grove is derived with no sessions, there are no runs, and sending an agent is refused.
 */
import type { DerivedGrove } from '../state/stones.ts'
import type { Run } from '../spawn/runs.ts'

export interface LaunchRequest {
  stoneId: string
  agentId: string
  task: string
  model?: string
}

export interface ActionHost {
  /** The grove as the latest scan derived it, or `null` before the first scan. */
  derived(): DerivedGrove | null
  /** The runs the Grove started, newest first. */
  runs(): Run[]
  /** Send an agent to a stone through the app's own launcher. */
  launchRun(request: LaunchRequest): Promise<{ ok: boolean; runId?: string; error?: string }>
  /** `grove.json` or the proposals changed: rescan and redraw, so the window follows at once. */
  changed(): Promise<void> | void
}

const NO_HOST: ActionHost = {
  derived: () => null,
  runs: () => [],
  launchRun: async () => ({ ok: false, error: 'Agents can only be sent while the Grove app is running.' }),
  changed: () => {},
}

let current: ActionHost = NO_HOST

/** Called once by the app at start, and by the checks with their stand-ins. */
export function setActionHost(host: ActionHost | null): void {
  current = host ?? NO_HOST
}

export const host = (): ActionHost => current
