/**
 * Which model an agent runs on, and how you change it.
 *
 * **Default means the tool's own choice** (3 October 2026). Whatever you picked in Claude Code with
 * `/model`, or in Codex's settings, is what an agent uses unless you choose otherwise here. Your
 * plan decides which models you may use, and the Grove cannot see your plan, so it never picks one
 * for you that might not be there. The one exception is the Researcher, below.
 *
 * **Names, not versions.** The choices are Claude Code's own short names (`opus`, `sonnet`,
 * `haiku`, `fable`), which always mean the newest of each, so a new release needs no change here.
 * "Other" takes any exact name, for the rare person who wants one.
 *
 * **Codex lists what Codex itself lists** (17 October 2026). Its names change often, so none are
 * written here. Codex keeps the list it shows in its own picker in `~/.codex/models_cache.json`,
 * and `core/codex-models.ts` reads the visible ones from there. With no such file (Codex not used
 * yet, or a version that keeps it elsewhere) Codex offers Default and Other, as before.
 *
 * **The Researcher defaults to Haiku on Claude Code.** It reads a great deal and changes nothing,
 * which is the work Anthropic's own docs suggest giving the fast, light model to save allowance.
 * It shows as Haiku in its card, never hidden, and one click puts it back on Default.
 *
 * **A model only goes to the tool it belongs to.** A built-in agent can be routed to either tool,
 * so a Claude model chosen for it is dropped (back to Default) if the job runs in Codex, and the
 * other way round, rather than starting a tool with a name it would refuse.
 *
 * Pure. `npm run verify:models` checks the rules.
 */

export type ModelTool = 'claude-code' | 'codex'

export interface ModelChoice {
  /** What is passed to the tool. Empty is Default. */
  value: string
  label: string
}

export const DEFAULT_MODEL: ModelChoice = { value: '', label: 'Default' }

/** Claude Code's short names, in the order its docs list them. */
export const CLAUDE_MODELS: ModelChoice[] = [
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

/**
 * The choices offered for a tool, Default first. "Other" is offered by the picker on top. Codex's
 * names come from Codex's own list on this Mac, when there is one; see `core/codex-models.ts`.
 */
export function choicesFor(tool: ModelTool, codexModels: ModelChoice[] = []): ModelChoice[] {
  return tool === 'claude-code' ? [DEFAULT_MODEL, ...CLAUDE_MODELS] : [DEFAULT_MODEL, ...codexModels]
}

/**
 * How hard the model thinks before answering. More effort is better work on hard problems, and
 * slower, and uses more of your allowance. Empty means the tool's own default.
 *
 * Claude Code takes `--effort` with these five (its `--help`, 17 October 2026). Codex takes the
 * same words through its `model_reasoning_effort` setting, plus `ultra` on some models.
 */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

export function effortsFor(tool: ModelTool): readonly string[] {
  return tool === 'claude-code' ? CLAUDE_EFFORTS : CODEX_EFFORTS
}

/** An effort the tool accepts, or empty for its default. Nothing else is ever handed over. */
export function isEffort(tool: ModelTool, text: string): boolean {
  return text === '' || effortsFor(tool).includes(text)
}

const EFFORT_LABEL: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max', ultra: 'ultra' }

/** How an effort reads in a sentence: "extra high" rather than "xhigh". */
export function effortLabel(effort: string): string {
  return effort ? (EFFORT_LABEL[effort] ?? effort) : 'default'
}

/** Longest name accepted; real model ids are well under this. */
export const MAX_MODEL_CHARS = 80

/**
 * A name that is safe to hand over: letters, digits and the punctuation real model ids use
 * (`claude-opus-5-5`, `claude-sonnet-5-5[1m]`, `gpt-6.1-sol`). Never a leading dash, which a tool
 * could read as an option. Empty is fine: it means Default.
 */
export function isModelName(text: string): boolean {
  return text === '' || (text.length <= MAX_MODEL_CHARS && /^[A-Za-z0-9][A-Za-z0-9._:\-/[\]]*$/.test(text))
}

/** Whose name this is: Claude's short names and `claude-…` ids belong to Claude Code, the rest to Codex. */
export function toolOf(model: string): ModelTool | null {
  if (!model) return null
  return /^(fable|opus|sonnet|haiku)$/i.test(model) || /^claude[-.]/i.test(model) ? 'claude-code' : 'codex'
}

/** The built-in agents' own defaults, where they differ from the tool's. Claude Code only. */
export const BUILT_IN_DEFAULT_MODELS: Record<string, string> = { researcher: 'haiku' }

/**
 * A built-in agent's model as you set it: your choice if you made one (an empty choice is a real
 * choice: "use the tool's default"), otherwise its own default.
 */
export function builtInModel(agentId: string, chosen: Record<string, string> | undefined): string {
  return chosen && agentId in chosen ? chosen[agentId]! : (BUILT_IN_DEFAULT_MODELS[agentId] ?? '')
}

/**
 * What a job actually runs on: the model picked for this one job if any, otherwise the agent's,
 * and Default if that name belongs to the other tool.
 */
export function modelForJob(tool: ModelTool, agentModel: string, forThisJob?: string): string {
  const wanted = forThisJob ?? agentModel
  const owner = toolOf(wanted)
  return owner === null || owner === tool ? wanted : ''
}

/** How a model reads in the interface. */
export function modelLabel(model: string): string {
  if (!model) return DEFAULT_MODEL.label
  return CLAUDE_MODELS.find((choice) => choice.value === model.toLowerCase())?.label ?? model
}
