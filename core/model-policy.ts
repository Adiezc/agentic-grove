/**
 * PM's rule book for models: which model and how much effort a job gets, and when to ask you.
 *
 * Agreed with Adrian on 17 October 2026. Three kinds of job:
 *
 *   - **quick**, a short question: Haiku at low effort. Fast, and barely touches the allowance.
 *   - **build**, day-to-day work in a project: Opus at medium effort. PM may ask for high on a
 *     bigger build, by passing an explicit effort; that is PM's judgement, not a rule here.
 *   - **plan**, planning the day, the roadmap, the architecture: Opus at extra-high effort.
 *
 * Codex follows the same shape with its own model names. Those change too often to write down, so
 * Codex keeps whatever model you chose in Codex and only the effort changes with the kind of job.
 *
 * **PM proposes, you decide.** Every pick comes with one sentence PM can say ("Planning, so Opus at
 * extra-high effort"), and the interface shows it as a chip you can change in one click. Your
 * Settings come first: the models you approved, and any model or effort you set for a kind of job.
 *
 * **When to ask.** Your model mode decides: always, never, or (the default) only for costly picks,
 * meaning Opus or Fable at extra-high effort or more, or any model outside your approved list. The
 * allowance rules in `usage/limits.ts` sit on top and cannot be switched off by the mode: above
 * 70% of the five hours a costly model always asks, above 90% only the lightest model runs and
 * new jobs queue.
 *
 * **Rules, not a model call.** The Grove never spends your subscription on its own (DECISIONS.md,
 * "Sending an agent opens Terminal with your own Claude Code"), so this is plain, testable code.
 * PM, a real Claude Code session, reads the job properly and can call these rules through a tool.
 *
 * Pure. `npm run verify:model-policy` checks it.
 */
import { effortLabel, effortsFor, isEffort, modelLabel, toolOf, type ModelTool } from './models.ts'
import type { GroveSettings } from './state/schema.ts'
import { usageTier, type UsageLevel } from './usage/limits.ts'
import type { UsageReport } from './usage/types.ts'

export type JobTier = 'quick' | 'build' | 'plan'
export const JOB_TIERS: readonly JobTier[] = ['quick', 'build', 'plan']

/** When PM asks before using a model. See the header. */
export type ModelMode = 'auto-ask-costly' | 'auto' | 'always-ask'
export const MODEL_MODES: readonly ModelMode[] = ['auto-ask-costly', 'auto', 'always-ask']

/** A model and effort you set for one kind of job. Empty fields mean "PM's default". */
export interface TierChoice {
  model: string
  effort: string
}

/* -------------------------------------------------------------------------------------------
 * Reading what kind of job it is
 * ---------------------------------------------------------------------------------------- */

// Words that mean looking ahead. They win over everything else: "what's the plan for today?" is
// planning, even though it is a short question.
const PLAN_WORDS =
  /\b(plan|plans|planning|roadmap|strategy|strategic|architecture|architect|prioriti[sz]e|priorities|long[- ]term|vision|for the day|my day|today's work|this week|next week|next month|next quarter)\b/

// Words that ask for a change to be made. A request phrased as a question ("can you fix the
// tests?") is still building.
const BUILD_WORDS =
  /\b(fix|add|build|implement|refactor|write|create|make|change|update|remove|delete|rename|migrate|install|deploy|debug|test|port|upgrade|set up|wire|ship|redesign|rewrite)\b/

// How short questions start.
const QUESTION_START =
  /^(what|what's|whats|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|has|have|explain|define|tell me|remind me)\b/

const REQUEST_START = /^(can|could|would|will) you\b|^please\b|^pls\b/

/** About two sentences. A question longer than this is usually a job in disguise. */
const QUICK_MAX_WORDS = 30

/**
 * What kind of job the text is. Plain rules, so a wrong guess is easy to see and costs one click:
 * planning words first, then a short question, and everything else is building.
 */
export function classifyJob(text: string): JobTier {
  const typed = text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  if (!typed) return 'build'
  if (PLAN_WORDS.test(typed)) return 'plan'
  const words = typed.split(' ').length
  if (words > QUICK_MAX_WORDS) return 'build'
  // "Can you add dark mode?" asks for work; "can you explain the scan?" asks a question. Other
  // questions ask about something, even about work: "how do I add a stone?" wants an answer.
  if (REQUEST_START.test(typed)) return BUILD_WORDS.test(typed) ? 'build' : 'quick'
  if (typed.endsWith('?') || QUESTION_START.test(typed)) return 'quick'
  return 'build'
}

/* -------------------------------------------------------------------------------------------
 * Picking a model
 * ---------------------------------------------------------------------------------------- */

/** PM's defaults per kind of job. Codex's model is empty: whatever you chose in Codex. */
export const DEFAULT_TIER_CHOICES: Record<ModelTool, Record<JobTier, TierChoice>> = {
  'claude-code': {
    quick: { model: 'haiku', effort: 'low' },
    build: { model: 'opus', effort: 'medium' },
    plan: { model: 'opus', effort: 'xhigh' },
  },
  codex: {
    quick: { model: '', effort: 'low' },
    build: { model: '', effort: 'medium' },
    plan: { model: '', effort: 'xhigh' },
  },
}

/** Claude's models from lightest to heaviest. Used to step down to an approved one. */
const CLAUDE_LADDER = ['haiku', 'sonnet', 'opus', 'fable']

/** Opus and Fable, by short name or full id: the models the allowance rules hold back. */
export function isCostlyModel(model: string): boolean {
  return /(^|[-.])(opus|fable)($|[-.[])/i.test(model)
}

const HEAVY_EFFORTS = new Set(['xhigh', 'max', 'ultra'])

export interface PickInput {
  tier: JobTier
  tool: ModelTool
  usage: UsageReport | null
  settings: Pick<GroveSettings, 'modelMode' | 'approvedModels' | 'tierModels' | 'usageThresholds'>
  now: number
  /** PM's own call for this job, e.g. high effort for a bigger build. Your Settings still apply. */
  model?: string
  effort?: string
}

export interface ModelPick {
  tool: ModelTool
  /** Empty means the tool's own default. */
  model: string
  /** Empty means the tool's own default. */
  effort: string
  tier: JobTier
  /** One sentence PM can say, so the choice is never a mystery. */
  reason: string
  /** Ask the person before starting. */
  needsOk: boolean
  /** Hold new work until the five-hour window resets. */
  queue: boolean
  /** Where the allowance stands, so the interface can colour the chip. */
  usage: UsageLevel
  weeklyWarn: boolean
}

const TIER_REASON: Record<JobTier, string> = { quick: 'A quick question', build: 'Building', plan: 'Planning' }

/** Is this model on your approved list? An empty list approves everything, and Default is always yours. */
function approved(model: string, list: string[]): boolean {
  return !model || list.length === 0 || list.some((each) => each.toLowerCase() === model.toLowerCase())
}

/**
 * The nearest approved Claude model to the one wanted: the next lighter first, so a limit never
 * makes a job cost more, then heavier. Default when none of the four is approved.
 */
function nearestApproved(model: string, list: string[]): string {
  const at = CLAUDE_LADDER.indexOf(model.toLowerCase())
  if (at < 0) return ''
  const lighter = CLAUDE_LADDER.slice(0, at).reverse()
  const heavier = CLAUDE_LADDER.slice(at + 1)
  return [...lighter, ...heavier].find((each) => approved(each, list)) ?? ''
}

/** "Opus at medium effort", "Codex's default at low effort", "the tool's default". */
function describe(tool: ModelTool, model: string, effort: string): string {
  const name = model ? modelLabel(model) : tool === 'codex' ? "Codex's default model" : "Claude Code's default model"
  return effort ? `${name} at ${effortLabel(effort)} effort` : name
}

export function pickModel(input: PickInput): ModelPick {
  const { tier, tool, settings, now } = input
  const base = DEFAULT_TIER_CHOICES[tool][tier]
  const yours = settings.tierModels[tool]?.[tier]
  const notes: string[] = []

  // Your Settings for this kind of job beat PM's defaults; PM's explicit call beats both, as long
  // as it is a name and effort this tool accepts. A Claude model is never handed to Codex.
  let model = yours?.model || base.model
  let effort = yours?.effort || base.effort
  if (input.model !== undefined && (toolOf(input.model) === tool || input.model === '')) model = input.model
  if (input.effort !== undefined && isEffort(tool, input.effort)) effort = input.effort
  if (!isEffort(tool, effort)) effort = base.effort

  const list = settings.approvedModels[tool] ?? []
  if (!approved(model, list)) {
    const swap = tool === 'claude-code' ? nearestApproved(model, list) : ''
    notes.push(`${modelLabel(model)} is not on your approved list, so ${swap ? modelLabel(swap) : 'the default'} instead`)
    model = swap
  }

  const limits = usageTier(input.usage, settings.usageThresholds, now, tool)
  let queue = false
  let needsOk = settings.modelMode === 'always-ask'

  if (limits.level === 'haiku-only') {
    // The lightest choice there is: Haiku on Claude Code, low effort on either tool.
    if (tool === 'claude-code') model = 'haiku'
    effort = 'low'
    queue = true
    if (!approved(model, list)) needsOk = true
  } else {
    const costly = isCostlyModel(model) || HEAVY_EFFORTS.has(effort)
    if (limits.level === 'no-opus-without-asking' && costly) needsOk = true
    if (settings.modelMode === 'auto-ask-costly' && (HEAVY_EFFORTS.has(effort) || model.toLowerCase() === 'fable')) needsOk = true
  }

  const head = `${TIER_REASON[tier]}, so ${describe(tool, model, effort)}`
  const limitNote = limits.level !== 'ok' || limits.weeklyWarn ? limits.reason.replace(/\.$/, '') : ''
  const askNote = needsOk && limits.level === 'ok' ? 'PM will check with you first' : ''
  const reason = [head, ...notes, limitNote, askNote].filter(Boolean).join('; ') + '.'

  return { tool, model, effort, tier, reason, needsOk, queue, usage: limits.level, weeklyWarn: limits.weeklyWarn }
}

/* -------------------------------------------------------------------------------------------
 * What PM is told
 * ---------------------------------------------------------------------------------------- */

const MODE_LINE: Record<ModelMode, string> = {
  'auto-ask-costly': 'Go ahead with your pick for ordinary work, but ask before Fable or extra-high effort and above.',
  auto: 'Go ahead with your pick without asking, except where the allowance rules below say to ask.',
  'always-ask': 'Always say which model and effort you propose and wait for a yes before starting.',
}

/**
 * A short paragraph for PM's brief: the kinds of job, the defaults, the person's own settings and
 * the allowance rules. The main session appends it to PM's system prompt.
 */
export function modelPolicyText(settings: Pick<GroveSettings, 'modelMode' | 'approvedModels' | 'tierModels' | 'usageThresholds'>): string {
  const claude = (tier: JobTier) => {
    const yours = settings.tierModels['claude-code']?.[tier]
    const base = DEFAULT_TIER_CHOICES['claude-code'][tier]
    return describe('claude-code', yours?.model || base.model, yours?.effort || base.effort)
  }
  const limits = settings.usageThresholds
  const approvedClaude = settings.approvedModels['claude-code'] ?? []
  const approvedCodex = settings.approvedModels.codex ?? []
  const lines = [
    'Models and effort: you propose, the person decides.',
    `Sort each job into quick (a short question: ${claude('quick')}), build (day-to-day work: ${claude('build')}, or high effort for a bigger build) or plan (the day, the roadmap, architecture: ${claude('plan')}).`,
    'On Codex keep the person’s Codex model and use low, medium or extra-high effort the same way.',
    approvedClaude.length || approvedCodex.length
      ? `Only use approved models: ${[...approvedClaude, ...approvedCodex].join(', ')}.`
      : '',
    MODE_LINE[settings.modelMode],
    `Allowance: above ${limits.noOpusAbove}% of the five-hour window, ask before Opus or Fable; above ${limits.haikuOnlyAbove}%, use Haiku at low effort only and queue new jobs until the reset; above ${limits.weeklyWarnAbove}% of the week, warn the person and send fewer jobs at once. Unknown usage never blocks work.`,
    `Say your choice in one short sentence with the reason, and remember the person can change it in one click. Efforts: ${effortsFor('claude-code').join(', ')}.`,
  ]
  return lines.filter(Boolean).join(' ')
}
