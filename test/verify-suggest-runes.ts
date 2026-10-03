/**
 * Saved tasks (runes) and suggested ones, checked case by case. Run with `npm run verify:suggest-runes`.
 *
 * The suggestion rule in `core/state/suggest-runes.ts`, then saving, removing and declining for
 * real against a disposable grove (`AGENTIC_GROVE_HOME`), never yours.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-runes-'))
process.env.AGENTIC_GROVE_HOME = home
const { addProject, carveRune, declineRune, loadGrove, removeRune } = await import('../core/state/grove.ts')
const { promptKey, runeNameFor, suggestRunes } = await import('../core/state/suggest-runes.ts')

const opened = (...prompts: string[]) => prompts.map((preview, index) => ({ preview, lastActivityAt: index }))

const cases: [string, () => Promise<void> | void][] = [
  ['three sessions opening with the same prompt make a suggestion; two do not', () => {
    assert.deepEqual(suggestRunes(opened('run the tests', 'run the tests'), [], []), [])
    const [one] = suggestRunes(opened('run the tests', 'Run the tests.', 'run  the tests'), [], [])
    assert.equal(one?.count, 3)
    assert.equal(one?.prompt, 'run  the tests'.trim(), 'the newest wording is offered')
  }],
  ['the same words with more in them are a different job', () => {
    assert.deepEqual(suggestRunes(opened('run the tests', 'run the tests in core', 'run the tests'), [], []), [])
  }],
  ['tool wrappers, attachment headers, placeholders and possibly cut prompts are never offered', () => {
    const wrapper = '<command-message>review</command-message>'
    // 240 is where the scan cuts a prompt off, so one that long may be half a job.
    const cut = 'x'.repeat(240)
    const files = '# Files mentioned by the user: ## report.pdf'
    for (const prompt of [wrapper, 'Untitled session', cut, files, '   ']) {
      assert.deepEqual(suggestRunes(opened(prompt, prompt, prompt), [], []), [], prompt.slice(0, 20))
    }
    assert.equal(suggestRunes(opened('/review', '/review', '/review'), [], []).length, 1, 'a slash command is a fine habit')
  }],
  ['already saved, or declined, means never offered', () => {
    const three = opened('run the tests', 'run the tests', 'run the tests')
    assert.deepEqual(suggestRunes(three, [{ prompt: 'Run the tests.' }], []), [])
    assert.deepEqual(suggestRunes(three, [], ['run the tests']), [])
  }],
  ['at most three, busiest first', () => {
    const many = opened(...['a', 'b', 'c', 'd'].flatMap((word, index) => Array(3 + index).fill(`job ${word}`)))
    assert.deepEqual(suggestRunes(many, [], []).map((each) => each.prompt), ['job d', 'job c', 'job b'])
  }],
  ['names come from the first five words', () => {
    assert.equal(runeNameFor('run the tests'), 'run the tests')
    assert.equal(runeNameFor('write the weekly summary for the team please'), 'write the weekly summary for…')
    assert.equal(promptKey('  Run   THE tests!!  '), 'run the tests')
  }],
  ['saving a task: needs a real stone, a real agent if one is named, and some words', async () => {
    const dir = path.join(home, 'site')
    await fsp.mkdir(dir, { recursive: true })
    await addProject(dir)
    assert.equal((await carveRune('/nowhere', 'run the tests')).ok, false)
    assert.equal((await carveRune(dir, '   ')).ok, false)
    assert.equal((await carveRune(dir, 'run the tests', 'nobody')).ok, false)
    assert.ok((await carveRune(dir, 'run the tests')).ok)
    assert.ok((await carveRune(dir, 'Run the tests.')).ok, 'the same job again is already saved')
    assert.ok((await carveRune(dir, 'review the diff', 'builder')).ok)
    const runes = (await loadGrove()).grove.stones[0]!.runes!
    assert.deepEqual(runes.map((rune) => [rune.id, rune.agent, rune.prompt]), [
      ['run-the-tests', '', 'run the tests'],
      ['review-the-diff', 'builder', 'review the diff'],
    ])
  }],
  ['removing and declining', async () => {
    const dir = path.join(home, 'site')
    assert.ok((await removeRune(dir, 'run-the-tests')).ok)
    assert.equal((await removeRune(dir, 'run-the-tests')).ok, false)
    assert.ok((await declineRune(dir, 'Write the summary.')).ok)
    assert.ok((await declineRune(dir, 'write the summary')).ok)
    const stone = (await loadGrove()).grove.stones[0]!
    assert.deepEqual(stone.runes!.map((rune) => rune.id), ['review-the-diff'])
    assert.deepEqual(stone.declinedRunes, ['write the summary'])
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
console.log(`\nAll ${cases.length} saved-task rules hold.`)
