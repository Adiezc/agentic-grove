/**
 * The tools PM is given through its channel, and the rules the Grove keeps for it.
 *
 * Most come straight from PM's Grove actions (`core/actions/registry.ts`). Two are added here:
 * `pick_model`, which runs the Grove's model rules (`core/model-policy.ts`) on a job, and
 * `usage_status`, which says where the allowance stands.
 *
 * **The allowance rules are kept in code, not only in PM's brief** (17 October 2026). A brief is
 * advice a model may forget; a job sent with `send_agent` passes through `guardSend` first. With
 * no model or effort given, it gets the Grove's pick. When the pick says to queue (the five-hour
 * window is almost used up), the job is refused with the reason. When it needs your yes (Opus over
 * the threshold, Fable or extra-high effort in "ask for costly" mode), PM is told to ask you first
 * and send again with `person_ok`. Your settings decide; PM cannot talk its way round them.
 */
import { PM_ACTIONS, callAction } from '../actions/registry.ts'
import { classifyJob, pickModel, JOB_TIERS, type JobTier, type ModelPick } from '../model-policy.ts'
import { usageTier } from '../usage/limits.ts'
import type { GroveSettings } from '../state/schema.ts'
import type { UsageReport } from '../usage/types.ts'
import type { PmTool } from './protocol.ts'
import type { ToolAnswer } from './bridge.ts'

export interface PmToolHost {
  settings(): Promise<GroveSettings>
  usage(): UsageReport | null
  /** Which tool an agent runs on, so a Codex worker gets a Codex pick. */
  toolFor(agent: string): Promise<'claude-code' | 'codex'>
}

const EXTRA_TOOLS: PmTool[] = [
  {
    name: 'pick_model',
    description:
      'Ask the Grove which model and effort suit a job, from its kind (quick question, building, planning), the person’s settings and the allowance. Returns the pick, a one-sentence reason to tell the person, whether to ask them first, and whether to wait for the reset. send_agent applies the same rules on its own when you leave model and effort out.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', maxLength: 20_000, description: 'The job in the person’s words or yours.' },
        tier: { type: 'string', enum: [...JOB_TIERS], description: 'Your own reading of the kind of job, if you have one: quick, build or plan.' },
        tool: { type: 'string', enum: ['claude-code', 'codex'], description: 'Defaults to claude-code.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'usage_status',
    description: 'Where the person’s allowance stands: the five-hour window and the week, for Claude Code and Codex, and what the Grove’s rules allow right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export function pmTools(): PmTool[] {
  const actions = PM_ACTIONS.map(({ name, description, inputSchema, risk }) => ({
    name,
    description: risk === 'ask' ? `${description} (Needs the person’s yes: it becomes a card in the Grove.)` : description,
    inputSchema,
  }))
  return [...actions, ...EXTRA_TOOLS]
}

const say = (pick: ModelPick) => `${pick.model || 'default model'}${pick.effort ? ` at ${pick.effort} effort` : ''}`

export async function callPmTool(name: string, args: unknown, host: PmToolHost): Promise<ToolAnswer> {
  const given = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
  if (name === 'pick_model') return pickFor(given, host)
  if (name === 'usage_status') return usageStatus(host)
  if (name === 'send_agent') {
    const guarded = await guardSend(given, host)
    if ('refused' in guarded) return { ok: false, text: guarded.refused }
    const result = await callAction(name, guarded.args)
    return { ok: result.ok, text: guarded.note ? `${result.text} ${guarded.note}` : result.text }
  }
  const result = await callAction(name, given)
  return { ok: result.ok, text: result.text }
}

async function pickFor(given: Record<string, unknown>, host: PmToolHost): Promise<ToolAnswer> {
  const task = typeof given.task === 'string' ? given.task : ''
  const tier = JOB_TIERS.includes(given.tier as JobTier) ? (given.tier as JobTier) : classifyJob(task)
  const tool = given.tool === 'codex' ? 'codex' : 'claude-code'
  const pick = pickModel({ tier, tool, usage: host.usage(), settings: await host.settings(), now: Date.now() })
  const advice = pick.queue
    ? ' Hold new jobs until the five-hour window resets, unless the person says otherwise.'
    : pick.needsOk
      ? ' Ask the person before starting.'
      : ''
  return { ok: true, text: `${pick.reason}${advice} (model "${pick.model}", effort "${pick.effort}", tier ${pick.tier})` }
}

async function usageStatus(host: PmToolHost): Promise<ToolAnswer> {
  const settings = await host.settings()
  const report = host.usage()
  const lines = (['claude-code', 'codex'] as const).map((tool) => {
    const tier = usageTier(report, settings.usageThresholds, Date.now(), tool)
    return `${tool === 'claude-code' ? 'Claude Code' : 'Codex'}: ${tier.reason}`
  })
  return { ok: true, text: lines.join(' ') }
}

/**
 * Fill in and check the model for a job before it is sent. Your settings win: a pick that needs
 * your yes is refused until PM says you gave it, and a full allowance holds the job back.
 */
export async function guardSend(
  given: Record<string, unknown>,
  host: PmToolHost
): Promise<{ args: Record<string, unknown>; note?: string } | { refused: string }> {
  const task = typeof given.task === 'string' ? given.task : ''
  const agent = typeof given.agent === 'string' ? given.agent : ''
  const tool = await host.toolFor(agent)
  const settings = await host.settings()
  const { person_ok: personOk, ...rest } = given
  const pick = pickModel({
    tier: classifyJob(task),
    tool,
    usage: host.usage(),
    settings,
    now: Date.now(),
    ...(typeof given.model === 'string' ? { model: given.model } : {}),
    ...(typeof given.effort === 'string' ? { effort: given.effort } : {}),
  })
  if (pick.queue && personOk !== true) {
    return { refused: `Not sent: ${pick.reason} Tell the person, and send it again with person_ok only if they want it to run now.` }
  }
  if (pick.needsOk && personOk !== true) {
    return { refused: `Not sent yet: ${pick.reason} Ask the person whether ${say(pick)} is all right (they can pick another), then send again with person_ok.` }
  }
  const args = { ...rest, model: pick.model, effort: pick.effort }
  return { args, note: `Running on ${say(pick)}.${pick.weeklyWarn ? ' The week’s allowance is running low: send fewer jobs at once.' : ''}` }
}
