/**
 * The Manager's rule book: which tool should take a job.
 *
 * The Manager agent on the tree decides how work is shared out, and this is the deterministic part
 * of that decision, kept here so it can be read, tested and argued with rather than hidden inside
 * a prompt. When the console can send work (roadmap step 10), the Manager reads the job, sorts it
 * into one of the kinds below, and asks `route` who should take it.
 *
 * The rules, in plain words:
 *
 *   1. Work *in a project folder* (code, files, anything on a stone) needs a tool the Grove can run:
 *      Claude Code or Codex. Whichever has more of its five-hour allowance left takes it, with
 *      Claude Code winning a tie because it is the one the Grove can watch most closely.
 *   2. *Everyday* work (email, a quick question, a document) belongs in the everyday apps: Claude
 *      Cowork or ChatGPT. The Grove opens them; it cannot type into them.
 *   3. *Recurring or always-on* work (every morning, keep an eye on) suits a ChatGPT Dot, which runs
 *      on OpenAI's own machines around the clock and does not count against your ChatGPT limits.
 *      Without Dots it falls back to a saved task (a rune) on a project tool.
 *   4. Nothing connected that fits is an answer too: say what to connect, never pretend.
 *
 * With one provider connected everything goes to it; with two or three, the rules above share it.
 */
import type { AgentHarness } from './state/schema.ts'

export type JobKind = 'project' | 'everyday' | 'recurring'

export interface Connected {
  claudeCode: boolean
  codex: boolean
  /** Signed in to the Claude app (Cowork). The Grove can only check the app is installed. */
  claudeApp: boolean
  /** Signed in to ChatGPT, and whether the plan includes Dots (Pro, Business Premium, Enterprise). */
  chatgptApp: boolean
  dots: boolean
}

/** Five-hour allowance left per project tool, 0 to 100, or `null` when unknown. */
export interface Headroom {
  claudeCode: number | null
  codex: number | null
}

export interface Route {
  harness: AgentHarness | null
  /** One sentence the Manager can say back, so a routing choice is never a mystery. */
  reason: string
}

export function route(kind: JobKind, connected: Connected, headroom: Headroom = { claudeCode: null, codex: null }): Route {
  if (kind === 'recurring') {
    if (connected.dots) return { harness: 'chatgpt-dot', reason: 'A ChatGPT Dot runs around the clock without using your ChatGPT limits.' }
    const fallback = route('project', connected, headroom)
    return fallback.harness
      ? { harness: fallback.harness, reason: `No Dots on this plan, so it becomes a saved task. ${fallback.reason}` }
      : fallback
  }

  if (kind === 'everyday') {
    if (connected.claudeApp) return { harness: 'claude-cowork', reason: 'Everyday work suits Claude Cowork.' }
    if (connected.chatgptApp) return { harness: 'chatgpt-dot', reason: 'Everyday work suits ChatGPT.' }
    const fallback = route('project', connected, headroom)
    return fallback.harness ? { harness: fallback.harness, reason: `No everyday app connected. ${fallback.reason}` } : fallback
  }

  if (connected.claudeCode && connected.codex) {
    const claude = headroom.claudeCode
    const codex = headroom.codex
    // Unknown headroom is not assumed to be full or empty; only two known figures are compared.
    if (claude !== null && codex !== null && codex > claude) {
      return { harness: 'codex', reason: `Codex has more of its five-hour allowance left (${codex}% against ${claude}%).` }
    }
    return { harness: 'claude-code', reason: 'Claude Code takes project work when it has room.' }
  }
  if (connected.claudeCode) return { harness: 'claude-code', reason: 'Claude Code is the project tool you have.' }
  if (connected.codex) return { harness: 'codex', reason: 'Codex is the project tool you have.' }
  return { harness: null, reason: 'Connect Claude Code or Codex so the Grove can work in your folders.' }
}
