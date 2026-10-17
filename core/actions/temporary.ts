/**
 * Temporary agents: the ones PM grows for one job, which go by themselves.
 *
 * Adrian's rule (16 October 2026): PM may start temporary agents freely; a permanent agent needs
 * his yes. A temporary agent is an ordinary definition in `grove.json` with `temporary: true` and
 * an `expiresAt`, so it hangs on the tree and can be sent like any other, and so a hand edit can
 * make one permanent by deleting two lines.
 *
 * It goes when nothing is keeping it:
 *
 *   - **its job is over**: it was sent at least once, and none of its runs is still live; or
 *   - **its time is up**: `expiresAt` has passed and none of its runs is live.
 *
 * "Live" is a run starting, working, waiting on you, or finished with its Terminal window still
 * open (you may give it more). A temporary agent is never taken off the tree mid-job, whatever the
 * clock says. `toGo` is pure, so the rules have checks; `sweepTemporaryAgents` applies them.
 */
import type { AgentDefinition } from '../state/schema.ts'
import type { Run } from '../spawn/runs.ts'
import { updateGrove } from '../state/grove.ts'

/** How long a temporary agent lasts when PM does not say. Long enough for a working session. */
export const TEMPORARY_AGENT_HOURS = 4
/** The longest PM may ask for. Anything meant to last longer should be a permanent agent, with a yes. */
export const MAX_TEMPORARY_AGENT_HOURS = 24
/** At most this many at once. The tree has seven branches and three are the built-ins'. */
export const MAX_TEMPORARY_AGENTS = 4

/** A run that may still do more work for its agent. */
export function isLive(run: Run): boolean {
  if (run.state === 'starting' || run.state === 'running' || run.state === 'waiting') return true
  return run.state === 'finished' && run.process !== 'closed'
}

/** The ids of temporary agents that should go now. */
export function toGo(agents: AgentDefinition[], runs: Run[], now: number): string[] {
  return agents
    .filter((agent) => agent.temporary)
    .filter((agent) => {
      const own = runs.filter((run) => run.agentId === agent.id)
      if (own.some(isLive)) return false
      const expired = now >= Date.parse(agent.expiresAt ?? '')
      return own.length > 0 || expired
    })
    .map((agent) => agent.id)
}

/**
 * Take every temporary agent that should go off the tree, with any note on it. Returns the ids
 * removed. A `grove.json` with an error is left alone, as every change does.
 */
export async function sweepTemporaryAgents(runs: Run[], now = Date.now()): Promise<string[]> {
  return updateGrove<string[]>((grove) => {
    const going = new Set(toGo(grove.agents, runs, now))
    if (!going.size) return { result: [], write: false }
    grove.agents = grove.agents.filter((agent) => !going.has(agent.id))
    grove.notes = grove.notes.filter((note) => !(note.on === 'agent' && going.has(note.id)))
    return { result: [...going], write: true }
  }, [])
}

/**
 * Sweep on a timer, so a temporary agent goes soon after its run ends even when PM is not looking.
 * Started once by the app; returns a stop function.
 */
export function startSweeping(runs: () => Run[], changed: () => unknown, everyMs = 30_000): () => void {
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    void sweepTemporaryAgents(runs())
      .then((gone) => (gone.length ? changed() : undefined))
      .catch(() => {})
      .finally(() => {
        busy = false
      })
  }, everyMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
