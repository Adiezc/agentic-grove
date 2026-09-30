/**
 * The one "Get ready" button: what it should do next, worked out from what is already on this Mac.
 *
 * **Why one button** (Adrian, 30 September 2026: "one button setup, or two at most if anything needs
 * authorisation"). The first version showed four rows: two desktop apps and two command-line tools,
 * each with its own button. Live updates were a separate switch in Settings. A newcomer had to know
 * which of the four mattered. Now the first-launch card asks one question, "what is the next thing
 * missing?", and the button does exactly that:
 *
 *   1. **Nothing to run agents with.** Install Claude Code in Terminal and sign in there. The
 *      sign-in is the one step that needs you, and it happens in your browser.
 *   2. **Installed but signed out.** Sign in, in Terminal.
 *   3. **Signed in, live updates off.** Turn them on (a backup of Claude Code's settings is kept).
 *   4. **Ready.** Nothing to press.
 *
 * Live updates ride along with steps 1 and 2 when they are off, so a newcomer presses once, signs
 * in, and is done. A tool whose sign-in could not be checked counts as signed in: better to let the
 * first run ask than to nag someone who is fine. Codex alone is enough to be ready; live updates
 * only exist for Claude Code, so they are not asked for then.
 *
 * Pure and type-only, so the page can work out the button itself from the snapshot, and the main
 * process can check the same answer before acting on it. Checked in `test/verify-readiness.ts`.
 */
import type { HooksState } from './hooks/install.ts'
import type { SetupStatus, SetupTool, ToolPresence } from './setup.ts'

export type SetupStep =
  | { kind: 'ready' }
  | { kind: 'install'; tool: SetupTool; liveUpdates: boolean }
  | { kind: 'sign-in'; tool: SetupTool; liveUpdates: boolean }
  | { kind: 'live-updates' }

/** Installed, and not known to be signed out. */
const usable = (tool: ToolPresence) => tool.cli && tool.signedIn !== false

export function nextSetupStep(status: SetupStatus, hooks: HooksState): SetupStep {
  const claude = status['claude-code']
  // "Unreadable" means Claude Code's settings file has an error; offering to write it would fail.
  const liveUpdates = hooks === 'off' || hooks === 'outdated'
  if (usable(claude)) return liveUpdates ? { kind: 'live-updates' } : { kind: 'ready' }
  if (usable(status.codex)) return { kind: 'ready' }
  if (claude.cli) return { kind: 'sign-in', tool: 'claude-code', liveUpdates }
  if (status.codex.cli) return { kind: 'sign-in', tool: 'codex', liveUpdates: false }
  return { kind: 'install', tool: 'claude-code', liveUpdates }
}

const NAMES: Record<SetupTool, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const ACCOUNTS: Record<SetupTool, string> = { 'claude-code': 'Claude', codex: 'ChatGPT' }

/** The button's label and the sentence under it, which says everything the press will do. */
export function describeStep(step: SetupStep): { label: string; line: string } | null {
  const alsoLive = (on: boolean) => (on ? ' It also turns on live updates.' : '')
  switch (step.kind) {
    case 'ready':
      return null
    case 'install':
      return {
        label: 'Get ready',
        line: `Installs ${NAMES[step.tool]} in a Terminal window, then you sign in with your ${ACCOUNTS[step.tool]} account.${alsoLive(step.liveUpdates)}`,
      }
    case 'sign-in':
      return {
        label: `Sign in to ${NAMES[step.tool]}`,
        line: `${NAMES[step.tool]} is here but signed out. Terminal opens so you can sign in with your ${ACCOUNTS[step.tool]} account.${alsoLive(step.liveUpdates)}`,
      }
    case 'live-updates':
      return {
        label: 'Turn on live updates',
        line: 'Adds a few lines to Claude Code’s settings so the grove hears about work the moment it happens. A backup is kept.',
      }
  }
}
