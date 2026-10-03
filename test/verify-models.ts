/**
 * Choosing models, checked case by case. Run with `npm run verify:models`.
 *
 * The rules in `core/models.ts`, then saving a choice for real against a disposable grove
 * (`AGENTIC_GROVE_HOME`), never yours, and what PM's team is given.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-models-'))
process.env.AGENTIC_GROVE_HOME = home
const { addAgent, loadGrove, setAgentModel } = await import('../core/state/grove.ts')
const { builtInModel, choicesFor, isModelName, modelForJob, modelLabel, toolOf } = await import('../core/models.ts')
const { parseGrove } = await import('../core/state/schema.ts')
const { claudeAgentsJson, teamFor } = await import('../core/spawn/briefs.ts')

const cases: [string, () => Promise<void> | void][] = [
  ['Default comes first; Claude Code offers its short names, Codex only Default', () => {
    assert.deepEqual(choicesFor('claude-code').map((choice) => choice.value), ['', 'fable', 'opus', 'sonnet', 'haiku'])
    assert.deepEqual(choicesFor('codex').map((choice) => choice.value), [''])
    assert.equal(modelLabel(''), 'Default')
    assert.equal(modelLabel('opus'), 'Opus')
    assert.equal(modelLabel('claude-opus-5-5'), 'claude-opus-5-5')
  }],
  ['real model names pass; a leading dash, spaces or quotes never do', () => {
    for (const ok of ['', 'opus', 'claude-sonnet-5-5[1m]', 'gpt-6.1-sol']) assert.ok(isModelName(ok), ok)
    for (const bad of ['--dangerously-skip-permissions', 'opus now', '"opus"', 'x'.repeat(81), '$(id)']) assert.ok(!isModelName(bad), bad)
  }],
  ['a model only goes to the tool it belongs to', () => {
    assert.equal(toolOf('sonnet'), 'claude-code')
    assert.equal(toolOf('claude-haiku-4-5'), 'claude-code')
    assert.equal(toolOf('gpt-6.1-sol'), 'codex')
    assert.equal(modelForJob('codex', 'opus'), '', 'Codex was handed a Claude model')
    assert.equal(modelForJob('claude-code', 'gpt-6.1-sol'), '', 'Claude Code was handed a Codex model')
    assert.equal(modelForJob('claude-code', 'opus'), 'opus')
  }],
  ['a model chosen for one job wins over the agent\'s, even Default', () => {
    assert.equal(modelForJob('claude-code', 'haiku', 'opus'), 'opus')
    assert.equal(modelForJob('claude-code', 'haiku', ''), '')
    assert.equal(modelForJob('claude-code', 'haiku', undefined), 'haiku')
  }],
  ['the Researcher defaults to Haiku; a choice of Default is kept as a real choice', () => {
    assert.equal(builtInModel('researcher', undefined), 'haiku')
    assert.equal(builtInModel('researcher', { researcher: '' }), '')
    assert.equal(builtInModel('builder', undefined), '')
    assert.equal(builtInModel('manager', { manager: 'opus' }), 'opus')
  }],
  ['PM\'s workers run on their chosen models; a Codex name falls back for Claude Code', () => {
    const json = (chosen?: Record<string, string>, yours = [] as Parameters<typeof teamFor>[0]) =>
      JSON.parse(claudeAgentsJson(teamFor(yours, chosen))) as Record<string, { model?: string }>
    assert.equal(json().researcher!.model, 'haiku')
    assert.equal(json().builder!.model, undefined)
    assert.equal(json({ researcher: '', builder: 'opus' }).researcher!.model, undefined)
    assert.equal(json({ builder: 'opus' }).builder!.model, 'opus')
    assert.equal(json(undefined, [{ id: 'x', name: 'Odd', description: '', model: 'gpt-6.1-sol' }]).odd!.model, undefined)
  }],
  ['a hand-edited grove.json: built-in models checked, nonsense reported rather than used', () => {
    const { grove, problems } = parseGrove({ version: 1, builtInModels: { builder: 'opus', researcher: '', wizard: 'opus', manager: '--yolo' } })
    assert.deepEqual(grove.builtInModels, { builder: 'opus', researcher: '' })
    assert.deepEqual(problems.map((problem) => problem.where).sort(), ['builtInModels.manager', 'builtInModels.wizard'])
  }],
  ['saving: built-ins to builtInModels, yours on the agent, Default removes it, bad names refused', async () => {
    assert.ok((await setAgentModel('builder', 'opus')).ok)
    assert.ok((await setAgentModel('researcher', '')).ok)
    const made = await addAgent({ name: 'Reviewer', description: 'Reads diffs', harness: 'claude-code', brief: '', model: '' })
    assert.ok((await setAgentModel(made.id!, 'sonnet')).ok)
    assert.equal((await setAgentModel(made.id!, '--yolo')).ok, false)
    assert.equal((await setAgentModel('nobody', 'opus')).ok, false)
    let { grove } = await loadGrove()
    assert.deepEqual(grove.builtInModels, { builder: 'opus', researcher: '' })
    assert.equal(grove.agents[0]!.model, 'sonnet')
    assert.ok((await setAgentModel(made.id!, '')).ok)
    ;({ grove } = await loadGrove())
    assert.equal(grove.agents[0]!.model, undefined)
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
await fsp.rm(home, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} model rules hold.`)
