/**
 * What each built-in agent is told when it starts, and how PM gets its team.
 *
 * **PM is the front door** (Adrian, 3 October 2026). You talk to PM; PM works out what the job
 * needs, plans it, and hands the parts to the agents whose job they are. Researcher and Builder are
 * still on the tree and can still be sent directly ("@builder fix the tests"), but by default work
 * goes through PM.
 *
 * **How PM delegates, and why this way.** Researched before building (DECISIONS.md, 3 October):
 *
 *   - One manager that keeps the conversation and calls specialists for bounded pieces of work
 *     (Anthropic's orchestrator-workers pattern, OpenAI's "agents as tools"), rather than handing
 *     the whole conversation over to whoever looks right.
 *   - The workers are the tool's own subagents. Claude Code takes a session's subagents on the
 *     command line (`--agents`), so nothing is written into your project or your settings, and
 *     each worker runs in its own context and reports back a summary. Codex only delegates when
 *     its instructions ask it to, so for Codex the team is described in the brief instead.
 *   - One level deep. Workers do not start workers of their own (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
 *     in `launch.ts`): deeper trees cost more and drift further from what you asked.
 *   - Reading in parallel, changing files one at a time. Parallel agents that each change files make
 *     decisions the others never see, and the results conflict.
 *   - Effort matched to the job. A team of agents uses many times the tokens of one, which on a
 *     Pro plan is the difference between finishing the week and not. A small job is just done.
 *
 * Short on purpose otherwise. Claude Code and Codex already know how to work in a project; a brief
 * only says which *kind* of work this agent does. The project's own CLAUDE.md or AGENTS.md still
 * applies and still wins on how the project is run. Written as plain sentences so a person can
 * read exactly what their agent was told.
 */

/** PM's id. Kept from when it was called Manager, so earlier runs and saved tasks still point at it. */
export const PM_ID = 'manager'

export const BUILT_IN_NAMES: Record<string, string> = {
  manager: 'PM',
  researcher: 'Researcher',
  builder: 'Builder',
}

/** A worker PM can hand a piece of the job to. */
export interface Worker {
  /** Lower-case letters, digits and dashes: what PM calls it when delegating. */
  key: string
  name: string
  /** When PM should choose it. One sentence. */
  description: string
  /** What the worker is told. */
  prompt: string
  /** Claude Code tool names it may use; left out means every tool. */
  tools?: string[]
  /** Empty means the session's own model. */
  model?: string
}

const RESEARCHER_PROMPT =
  'You are the Researcher on an Agentic Grove team, asked by the PM to find something out. Read the ' +
  'code, documents and anything else the question needs, then reply with a short summary of what you ' +
  'found, where (file paths and line numbers), and how sure you are. Never change files.'

const BUILDER_PROMPT =
  'You are the Builder on an Agentic Grove team, asked by the PM to make a change. Make exactly the ' +
  'change asked for, keep it as small as does the job, stay inside the files you were pointed at ' +
  'unless the change truly needs more, and check it works (run the tests or the build if the project ' +
  'has them). Reply with a short list of what you changed and how you checked it.'

/** The built-in workers, always on PM's team. */
export const BUILT_IN_WORKERS: Worker[] = [
  {
    key: 'researcher',
    name: 'Researcher',
    description: 'Finds things out without changing anything: reads code and documents, searches, explains, reviews a change.',
    prompt: RESEARCHER_PROMPT,
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'],
  },
  {
    key: 'builder',
    name: 'Builder',
    description: 'Makes changes: writes and edits code and files, then checks they work.',
    prompt: BUILDER_PROMPT,
  },
]

/** One of your own agents, as `grove.json` has it, enough to put it on PM's team. */
export interface OwnAgent {
  id: string
  name: string
  description: string
  systemPrompt?: string
  model?: string
}

/** A name Claude Code accepts as a subagent's: lower-case words joined by dashes. */
export function workerKey(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agent'
  )
}

/**
 * PM's team: the built-in workers, then your own agents that run on the same tool as this PM run,
 * so a reviewer you connected is someone PM can ask. Your agent keeps its own brief and model.
 * A key already taken (your agent called "Builder") gets a number rather than replacing the other.
 */
export function teamFor(yours: OwnAgent[]): Worker[] {
  const team = [...BUILT_IN_WORKERS]
  const taken = new Set(team.map((worker) => worker.key))
  for (const agent of yours) {
    let key = workerKey(agent.name)
    for (let n = 2; taken.has(key); n++) key = `${workerKey(agent.name)}-${n}`
    taken.add(key)
    team.push({
      key,
      name: agent.name,
      description: agent.description.trim() || `${agent.name}, one of the agents connected to this grove.`,
      prompt:
        `You are ${agent.name} on an Agentic Grove team, asked by the PM to do part of a job. ` +
        (agent.systemPrompt?.trim() ? `${agent.systemPrompt.trim()} ` : '') +
        'Reply with a short summary of what you did or found.',
      model: agent.model?.trim() || undefined,
    })
  }
  return team
}

/** The team as Claude Code's `--agents` wants it: one JSON object, keyed by worker name. */
export function claudeAgentsJson(team: Worker[]): string {
  const agents: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> = {}
  for (const worker of team) {
    agents[worker.key] = {
      description: worker.description,
      prompt: worker.prompt,
      ...(worker.tools ? { tools: worker.tools } : {}),
      ...(worker.model ? { model: worker.model } : {}),
    }
  }
  return JSON.stringify(agents)
}

/**
 * PM's brief. The same rules for both tools; only how the team is reached differs. Claude Code
 * already has the team as subagents. Codex is told who is on it and to start each as a subagent
 * with that worker's instructions, since Codex does not delegate unless asked to.
 */
export function pmBrief(team: Worker[], tool: 'claude-code' | 'codex'): string {
  const roster = team.map((worker) => `- ${worker.key}: ${worker.description}`).join('\n')
  const reach =
    tool === 'claude-code'
      ? 'Your team are subagents in this session. Delegate to one by name.'
      : 'Delegate by starting a subagent for each piece of work, giving it the instructions listed for that worker below and the piece of the job.'
  const instructions =
    tool === 'codex' ? '\n\nEach worker\'s instructions:\n' + team.map((worker) => `- ${worker.key}: ${worker.prompt}`).join('\n') : ''
  return [
    'You were sent by Agentic Grove as its PM, the project manager. The person talks to you; you make sure the job gets done well by the right agent.',
    '',
    `${reach} Your team:`,
    roster,
    '',
    'How to work:',
    '1. Understand the job first. Read enough of the project to know what it involves. If something only the person can decide is unclear, ask before starting.',
    '2. Match the effort to the job. A small job (one change, one question) goes to one worker, or you simply do it; no plan needed. A bigger job gets a short numbered plan: each step says who does it and what they hand back. Show the plan and wait for the person to agree before anything changes files.',
    '3. Give every worker a complete brief: the goal, what to send back, where to look, and what not to touch. A worker sees none of this conversation, only what you write.',
    '4. Find things out in parallel; change files one step at a time. Never have two workers changing the same files at once.',
    '5. Check the work. After a change, have it reviewed by the researcher or run the tests yourself before calling it done.',
    '6. Keep it lean. Every worker costs part of the person\'s allowance; use as few as the job needs.',
    '7. Finish with a short report: what was done and by whom, how it was checked, what is left, and anything that needs the person\'s decision.',
  ].join('\n') + instructions
}

/** What the workers are told when sent directly from the tree, without PM. */
export const BUILT_IN_BRIEFS: Record<string, string> = {
  researcher:
    'You were sent by Agentic Grove as its Researcher. Investigate and explain: read the code, ' +
    'documents and anything else the task needs, then finish with a short summary of what you ' +
    'found and how sure you are. Do not change any files unless the task explicitly asks you to.',
  builder:
    'You were sent by Agentic Grove as its Builder. Make the change the task asks for, keep it as ' +
    'small as does the job, and check it works (run the tests or the build if the project has ' +
    'them). Finish with a short list of what you changed.',
}

/** Every built-in agent, PM included. PM's brief is built per run by `pmBrief`, with its team. */
export const SPAWNABLE_BUILT_INS = new Set([PM_ID, ...Object.keys(BUILT_IN_BRIEFS)])
