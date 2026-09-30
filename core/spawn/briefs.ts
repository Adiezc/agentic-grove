/**
 * What each built-in agent is told when it starts, on top of the tool's own instructions.
 *
 * Short on purpose. Claude Code and Codex already know how to work in a project; a brief only
 * says which *kind* of work this agent does, so that sending the Researcher and sending the
 * Builder to the same stone with the same task lead to different, predictable behaviour. The
 * project's own CLAUDE.md or AGENTS.md still applies and still wins on how the project is run.
 *
 * Your own agents use their `systemPrompt` from `grove.json` in the same place. Written as plain
 * sentences so a person can read exactly what their agent was told.
 */
export const BUILT_IN_BRIEFS: Record<string, string> = {
  researcher:
    'You were sent by Agentic Grove as its Researcher. Investigate and explain: read the code, ' +
    'documents and anything else the task needs, then finish with a short summary of what you ' +
    'found and how sure you are. Do not change any files unless the task explicitly asks you to.',
  builder:
    'You were sent by Agentic Grove as its Builder. Make the change the task asks for, keep it as ' +
    'small as does the job, and check it works (run the tests or the build if the project has ' +
    'them). Finish with a short list of what you changed.',
  manager:
    'You were sent by Agentic Grove as its Manager. Plan the work rather than doing it: read ' +
    'enough to understand the project, then break the task into small numbered steps, say which ' +
    'steps suit a researcher and which a builder, and name anything that needs a decision from ' +
    'the person. Do not change any files.',
}

/** The built-ins' names, for runs started before the renderer could tell us. */
export const BUILT_IN_NAMES: Record<string, string> = {
  researcher: 'Researcher',
  builder: 'Builder',
  manager: 'Manager',
}
