/**
 * The rune console's reading of what you typed: which agent should do it, and on which stone.
 *
 * **Rules, not a model.** Understanding free text with a language model would mean either an API
 * key billed per token or running your subscription through this app, which Anthropic does not
 * allow (see DECISIONS.md, step 9). So the console reads with a few plain rules, in this file,
 * where they can be read and tested. The interface shows the reading before anything is sent
 * ("Builder → Shellter"), and one click changes the agent, so a rule that guesses wrong costs a
 * click rather than a wrong job.
 *
 * **Who.** In order:
 *   1. An agent you name at the start: "@builder fix the tests", "Researcher: why is the scan
 *      slow", "ask the manager to plan the release". The name is taken off the task.
 *   2. Otherwise the kind of job, from how it starts. Planning words ("plan", "break down",
 *      "prioritise") go to the Manager; questions and looking-into words ("why", "explain",
 *      "find", "review", or anything ending in a question mark) go to the Researcher; everything
 *      else, which is mostly "make or change something", goes to the Builder.
 *
 * **Where.** In order: the stone you have selected; a stone whose name appears in the text as a
 * whole word (the longest name wins, so "Grove Studio" beats "Grove"); the only stone, if there is
 * just one; otherwise nobody guesses, and you pick the stone.
 */

export interface ConsoleStone {
  id: string
  name: string
}

export interface ConsoleAgent {
  id: string
  name: string
}

export interface Reading {
  /** What the agent is actually asked, with any "@name" taken off the front. */
  task: string
  agentId: string
  agentBy: 'named' | 'kind'
  stoneId: string | null
  stoneBy: 'selected' | 'named' | 'only' | null
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The word "the" is allowed before a name, so "ask the builder" reads as naturally as "@builder". */
function namedAgent(text: string, agents: ConsoleAgent[]): { agent: ConsoleAgent; rest: string } | null {
  // Longest names first, so an agent called "Builder Two" is not read as "Builder" plus " Two".
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length)
  for (const agent of byLength) {
    const name = escape(agent.name)
    const forms = [
      new RegExp(`^@${name}\\b[:,]?\\s*`, 'i'),
      new RegExp(`^(?:the\\s+)?${name}\\s*[:,]\\s*`, 'i'),
      new RegExp(`^ask\\s+(?:the\\s+)?${name}\\s+(?:to\\s+)?`, 'i'),
    ]
    for (const form of forms) {
      const match = text.match(form)
      if (match) return { agent, rest: text.slice(match[0].length).trim() }
    }
  }
  return null
}

const PLANNING = /^(?:plan|break (?:it |this )?down|prioriti[sz]e|organi[sz]e|scope|estimate|roadmap|outline|what should (?:we|i) do|how should (?:we|i))\b/i
const LOOKING =
  // Not "do", "can" or "should": "do the refactor" and "can you add dark mode" are building jobs.
  // A genuine question in those words still reaches the Researcher through its question mark.
  /^(?:why|what|how|where|which|who|when|is|are|does|explain|find|search|look (?:into|at|for)|research|investigate|summari[sz]e|compare|review|check|read|analy[sz]e|audit|tell me|show me|describe|list)\b/i

/** The built-in agent for a kind of job. Always one of the three, which every grove has. */
export function agentForKind(task: string): 'researcher' | 'builder' | 'manager' {
  const start = task.trim()
  if (PLANNING.test(start)) return 'manager'
  if (LOOKING.test(start) || start.endsWith('?')) return 'researcher'
  return 'builder'
}

function namedStone(text: string, stones: ConsoleStone[]): ConsoleStone | null {
  const byLength = [...stones].sort((a, b) => b.name.length - a.name.length)
  for (const stone of byLength) {
    if (!stone.name.trim()) continue
    // Whole words only, and not inside a longer word: "Grove" must not match "Groves".
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(stone.name)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text)) return stone
  }
  return null
}

export function readCommand(
  text: string,
  context: { stones: ConsoleStone[]; agents: ConsoleAgent[]; selectedStoneId: string | null }
): Reading {
  const typed = text.trim()
  const named = namedAgent(typed, context.agents)
  const task = named ? named.rest : typed
  const agentId = named ? named.agent.id : agentForKind(task)

  const selected = context.stones.find((stone) => stone.id === context.selectedStoneId)
  const mentioned = selected ? null : namedStone(task, context.stones)
  const only = context.stones.length === 1 ? context.stones[0]! : null
  const stone = selected ?? mentioned ?? only
  const stoneBy = selected ? 'selected' : mentioned ? 'named' : only ? 'only' : null

  return { task, agentId, agentBy: named ? 'named' : 'kind', stoneId: stone?.id ?? null, stoneBy }
}
