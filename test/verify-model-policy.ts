/**
 * PM's model rules, checked case by case. Run with `npm run verify:model-policy`.
 *
 * What kind of job a line of text is, which model and effort each kind gets, how the allowance
 * rules hold PM back, that unknown or old figures never do, your approved models and choices, Codex,
 * the settings as `grove.json` stores them, and Codex's own model list.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { classifyJob, isCostlyModel, modelPolicyText, pickModel, type PickInput } from '../core/model-policy.ts'
import { DEFAULT_THRESHOLDS, usageTier } from '../core/usage/limits.ts'
import type { UsageReport, UsageWindow } from '../core/usage/types.ts'
import { defaultSettings, parseGrove, type GroveSettings } from '../core/state/schema.ts'
import { parseCodexModels, readCodexModels } from '../core/codex-models.ts'
import { choicesFor, isEffort } from '../core/models.ts'

const NOW = Date.UTC(2026, 9, 17, 12, 0)
const HOUR = 60 * 60_000

function window(key: UsageWindow['key'], usedPercent: number | null, fields: Partial<UsageWindow> = {}): UsageWindow {
  return { key, provenance: 'official', usedPercent, resetsAt: NOW + HOUR, tokens: null, observedAt: NOW - 60_000, ...fields }
}

function report(provider: 'claude-code' | 'codex', fiveHour: number | null, weekly: number | null = 10, fields: Partial<UsageWindow> = {}): UsageReport {
  return {
    at: NOW,
    providers: [{ provider, name: provider, windows: [window('five_hour', fiveHour, fields), window('seven_day', weekly, { resetsAt: NOW + 72 * HOUR })] }],
  }
}

function settings(patch: Partial<GroveSettings> = {}): GroveSettings {
  return { ...defaultSettings(), ...patch }
}

const pick = (fields: Partial<PickInput> & Pick<PickInput, 'tier'>) =>
  pickModel({ tool: 'claude-code', usage: null, settings: settings(), now: NOW, ...fields })

const cases: [string, () => Promise<void> | void][] = [
  ['short questions are quick', () => {
    for (const text of ['what is a worktree?', 'Why does the scan skip hidden folders', 'which model is PM on?', 'how do I add a stone', 'What’s in the crystal right now?']) {
      assert.equal(classifyJob(text), 'quick', text)
    }
  }],
  ['planning words win, even in a question', () => {
    for (const text of ['Plan my day', "what's the plan for the day?", 'Update the roadmap with the chat panel', 'Think through the architecture for Windows', 'what should our strategy be for launch?', 'Prioritise this week']) {
      assert.equal(classifyJob(text), 'plan', text)
    }
  }],
  ['work, including work asked as a question, is building', () => {
    for (const text of ['Fix the failing spawn test', 'add dark mode to settings', 'Can you fix the login bug?', 'please rename the clearings file', '', 'Refactor the scanner so each harness adapter is its own module and every failure costs only its own figures, then run verify and write up anything that changed in the docs folder for the next session']) {
      assert.equal(classifyJob(text), 'build', JSON.stringify(text))
    }
  }],
  ['each kind of job has its default on Claude Code', () => {
    assert.deepEqual([pick({ tier: 'quick' }).model, pick({ tier: 'quick' }).effort], ['haiku', 'low'])
    assert.deepEqual([pick({ tier: 'build' }).model, pick({ tier: 'build' }).effort], ['opus', 'medium'])
    assert.deepEqual([pick({ tier: 'plan' }).model, pick({ tier: 'plan' }).effort], ['opus', 'xhigh'])
    assert.equal(pick({ tier: 'build' }).needsOk, false, 'ordinary building should not ask')
    assert.equal(pick({ tier: 'plan' }).needsOk, true, 'extra-high effort asks in the default mode')
    assert.match(pick({ tier: 'plan' }).reason, /^Planning, so Opus at extra high effort/)
    assert.equal(pick({ tier: 'quick' }).queue, false)
  }],
  ['PM may ask for high effort on a bigger build, but not an effort the tool lacks', () => {
    assert.equal(pick({ tier: 'build', effort: 'high' }).effort, 'high')
    assert.equal(pick({ tier: 'build', effort: 'ultra' }).effort, 'medium', 'ultra is Codex only')
    assert.equal(pick({ tier: 'build', model: 'gpt-6.1-sol' }).model, 'opus', 'a Codex model never goes to Claude Code')
  }],
  ['the mode decides when to ask', () => {
    assert.equal(pick({ tier: 'plan', settings: settings({ modelMode: 'auto' }) }).needsOk, false)
    assert.equal(pick({ tier: 'quick', settings: settings({ modelMode: 'always-ask' }) }).needsOk, true)
    assert.equal(pick({ tier: 'build', model: 'fable' }).needsOk, true, 'Fable is costly')
  }],
  ['above 70% costly picks always ask, whatever the mode', () => {
    const usage = report('claude-code', 74)
    const build = pick({ tier: 'build', usage, settings: settings({ modelMode: 'auto' }) })
    assert.equal(build.model, 'opus')
    assert.equal(build.needsOk, true)
    assert.equal(build.usage, 'no-opus-without-asking')
    assert.match(build.reason, /74% used/)
    assert.equal(pick({ tier: 'quick', usage, settings: settings({ modelMode: 'auto' }) }).needsOk, false, 'Haiku needs no OK')
  }],
  ['above 90% only Haiku at low effort runs, and new jobs queue', () => {
    const plan = pick({ tier: 'plan', usage: report('claude-code', 93) })
    assert.deepEqual([plan.model, plan.effort, plan.queue, plan.usage], ['haiku', 'low', true, 'haiku-only'])
    assert.match(plan.reason, /new jobs wait/)
  }],
  ['the week above 80% warns', () => {
    const tier = usageTier(report('claude-code', 20, 85), DEFAULT_THRESHOLDS, NOW)
    assert.equal(tier.level, 'ok')
    assert.equal(tier.weeklyWarn, true)
    assert.match(pick({ tier: 'build', usage: report('claude-code', 20, 85) }).reason, /week is 85% used/)
    assert.equal(usageTier(report('claude-code', 20, 80), DEFAULT_THRESHOLDS, NOW).weeklyWarn, false, '80 is not above 80')
  }],
  ['unknown, reset or old figures never hold work back', () => {
    for (const usage of [null, report('claude-code', null, null), report('claude-code', 95, 95, { resetsAt: NOW - 1 }), report('claude-code', 95, 10, { observedAt: NOW - 6 * HOUR }), report('codex', 95)]) {
      const tier = usageTier(usage, DEFAULT_THRESHOLDS, NOW)
      assert.equal(tier.level, 'ok')
      assert.equal(tier.fiveHour, null)
      const build = pick({ tier: 'build', usage })
      assert.equal(build.model, 'opus')
      assert.equal(build.queue, false)
    }
    assert.match(usageTier(null, DEFAULT_THRESHOLDS, NOW).reason, /unknown/)
  }],
  ['your thresholds move the steps', () => {
    const own = settings({ usageThresholds: { noOpusAbove: 50, haikuOnlyAbove: 60, weeklyWarnAbove: 90 } })
    assert.equal(pick({ tier: 'build', usage: report('claude-code', 55), settings: own }).needsOk, true)
    assert.equal(pick({ tier: 'build', usage: report('claude-code', 65), settings: own }).model, 'haiku')
  }],
  ['approved models: a lighter approved one first, then heavier, then Default', () => {
    const onlySonnet = settings({ approvedModels: { 'claude-code': ['sonnet'], codex: [] } })
    assert.equal(pick({ tier: 'build', settings: onlySonnet }).model, 'sonnet')
    assert.equal(pick({ tier: 'quick', settings: onlySonnet }).model, 'sonnet', 'no Haiku, so the next heavier')
    assert.match(pick({ tier: 'build', settings: onlySonnet }).reason, /not on your approved list/)
    const onlyFull = settings({ approvedModels: { 'claude-code': ['claude-opus-5-5'], codex: [] } })
    assert.equal(pick({ tier: 'build', settings: onlyFull }).model, '', 'none of the short names approved: Default')
    assert.equal(pick({ tier: 'quick', usage: report('claude-code', 95), settings: onlySonnet }).needsOk, true, 'Haiku outside the list asks')
  }],
  ['your own choice for a kind of job beats PM’s default', () => {
    const own = settings({ tierModels: { 'claude-code': { plan: { model: '', effort: 'max' }, quick: { model: 'sonnet', effort: '' } }, codex: {} } })
    assert.deepEqual([pick({ tier: 'plan', settings: own }).model, pick({ tier: 'plan', settings: own }).effort], ['opus', 'max'])
    assert.deepEqual([pick({ tier: 'quick', settings: own }).model, pick({ tier: 'quick', settings: own }).effort], ['sonnet', 'low'])
  }],
  ['Codex keeps your Codex model and changes only the effort', () => {
    const codex = (tier: PickInput['tier'], usage: UsageReport | null = null) => pick({ tier, tool: 'codex', usage })
    assert.deepEqual([codex('quick').model, codex('quick').effort], ['', 'low'])
    assert.deepEqual([codex('plan').model, codex('plan').effort, codex('plan').needsOk], ['', 'xhigh', true])
    assert.equal(pick({ tier: 'build', tool: 'codex', model: 'opus' }).model, '', 'a Claude model never goes to Codex')
    assert.equal(pick({ tier: 'build', tool: 'codex', effort: 'ultra' }).effort, 'ultra')
    assert.equal(codex('plan', report('claude-code', 95)).queue, false, 'Claude’s figures do not hold Codex back')
    const busy = codex('plan', report('codex', 95))
    assert.deepEqual([busy.effort, busy.queue], ['low', true])
    assert.match(codex('build').reason, /Codex's default model at medium effort/)
  }],
  ['costly means Opus or Fable, by short name or full id', () => {
    for (const name of ['opus', 'Fable', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5-5[1m]']) assert.ok(isCostlyModel(name), name)
    for (const name of ['', 'sonnet', 'haiku', 'claude-sonnet-5-5', 'gpt-6.1-sol', 'opusculum']) assert.ok(!isCostlyModel(name), name)
  }],
  ['PM’s brief text names the tiers, the user’s say, and the limits', () => {
    const text = modelPolicyText(settings({ approvedModels: { 'claude-code': ['opus', 'haiku'], codex: [] } }))
    for (const part of ['you propose, the person decides', 'Haiku at low effort', 'Opus at extra high effort', 'opus, haiku', '70%', '90%', '80%', 'Unknown usage never blocks']) {
      assert.ok(text.includes(part), part)
    }
    assert.ok(!/[—–]/.test(text), 'no dashes in what PM is told to say')
  }],
  ['settings: defaults, a good hand edit kept, bad entries dropped with a reason', () => {
    const fresh = parseGrove({}).grove.settings
    assert.equal(fresh.modelMode, 'auto-ask-costly')
    assert.deepEqual(fresh.usageThresholds, { noOpusAbove: 70, haikuOnlyAbove: 90, weeklyWarnAbove: 80 })
    const { grove, problems } = parseGrove({
      settings: {
        modelMode: 'auto',
        approvedModels: { 'claude-code': ['opus', 'sonnet', 'opus'], codex: ['gpt-6.1-sol'] },
        tierModels: { 'claude-code': { plan: { model: 'opus', effort: 'max' } }, codex: { build: { effort: 'ultra' } } },
        usageThresholds: { noOpusAbove: 60 },
      },
    })
    assert.deepEqual(problems, [])
    assert.equal(grove.settings.modelMode, 'auto')
    assert.deepEqual(grove.settings.approvedModels['claude-code'], ['opus', 'sonnet'])
    assert.deepEqual(grove.settings.tierModels.codex.build, { model: '', effort: 'ultra' })
    assert.equal(grove.settings.usageThresholds.noOpusAbove, 60)
    assert.equal(grove.settings.usageThresholds.haikuOnlyAbove, 90)

    const bad = parseGrove({
      settings: {
        modelMode: 'yolo',
        approvedModels: { 'claude-code': ['--rm'] },
        tierModels: { 'claude-code': { plan: { effort: 'ultra' } } },
        usageThresholds: { noOpusAbove: 95, haikuOnlyAbove: 90 },
      },
    })
    assert.equal(bad.grove.settings.modelMode, 'auto-ask-costly')
    assert.deepEqual(bad.grove.settings.approvedModels['claude-code'], [])
    assert.equal(bad.grove.settings.tierModels['claude-code'].plan, undefined, 'ultra is not a Claude Code effort')
    assert.deepEqual(bad.grove.settings.usageThresholds, DEFAULT_THRESHOLDS)
    assert.equal(bad.problems.length, 4)
  }],
  ['efforts: Claude Code takes five, Codex also ultra', () => {
    for (const effort of ['', 'low', 'medium', 'high', 'xhigh', 'max']) assert.ok(isEffort('claude-code', effort), effort)
    assert.ok(!isEffort('claude-code', 'ultra'))
    assert.ok(isEffort('codex', 'ultra'))
    assert.ok(!isEffort('codex', '--high'))
  }],
  ['Codex’s own model list: visible ones only, in its order; anything odd gives none', async () => {
    const cache = {
      models: [
        { slug: 'gpt-b', display_name: 'GPT-B', visibility: 'list', priority: 2 },
        { slug: 'hidden-one', display_name: 'Hidden', visibility: 'hide', priority: 0 },
        { slug: 'gpt-a', display_name: 'GPT-A', visibility: 'list', priority: 1 },
        { slug: '--evil', display_name: 'Evil', visibility: 'list', priority: 0 },
      ],
    }
    const models = parseCodexModels(cache)
    assert.deepEqual(models, [{ value: 'gpt-a', label: 'GPT-A' }, { value: 'gpt-b', label: 'GPT-B' }])
    assert.deepEqual(choicesFor('codex', models).map((each) => each.value), ['', 'gpt-a', 'gpt-b'])
    for (const odd of [null, [], { models: 'x' }, { models: [null, 3] }]) assert.deepEqual(parseCodexModels(odd), [])

    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-codex-models-'))
    assert.deepEqual(await readCodexModels(home), [], 'no file')
    await fsp.writeFile(path.join(home, 'models_cache.json'), JSON.stringify(cache))
    assert.equal((await readCodexModels(home)).length, 2)
    await fsp.writeFile(path.join(home, 'models_cache.json'), '{ not json')
    assert.deepEqual(await readCodexModels(home), [], 'a broken file')
    await fsp.rm(home, { recursive: true, force: true })
  }],
]

let failed = 0
for (const [name, run] of cases) {
  try {
    await run()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
console.log(failed ? `\n${failed} of ${cases.length} model policy checks failed.` : `\nAll ${cases.length} model policy checks hold.`)
process.exit(failed ? 1 : 0)
