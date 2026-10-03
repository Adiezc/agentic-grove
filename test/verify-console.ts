/**
 * The rune console's reading, checked case by case. Run with `npm run verify:console`.
 *
 * Each case is one sentence of the rules in `core/console.ts`. Change the case in the same commit
 * as the rule, so the two never disagree about who gets a job.
 */
import assert from 'node:assert/strict'
import { readCommand } from '../core/console.ts'

const agents = [
  { id: 'researcher', name: 'Researcher' },
  { id: 'builder', name: 'Builder' },
  { id: 'manager', name: 'PM' },
  { id: 'builder-two', name: 'Builder Two' },
]
const stones = [
  { id: '/p/grove', name: 'Grove' },
  { id: '/p/grove-studio', name: 'Grove Studio' },
  { id: '/p/shellter', name: 'Shellter' },
]
const read = (text: string, selectedStoneId: string | null = null, list = stones) => readCommand(text, { stones: list, agents, selectedStoneId })

const cases: [string, () => void][] = [
  ['a named agent wins, in every form, and its name comes off the task', () => {
    assert.deepEqual([read('@builder why is it slow').agentId, read('@builder why is it slow').task], ['builder', 'why is it slow'])
    assert.equal(read('Researcher: fix the login').agentId, 'researcher')
    assert.equal(read('ask the PM to fix it').agentId, 'manager')
    assert.equal(read('ask the pm to fix it').task, 'fix it')
  }],
  ['the longest agent name is matched first', () => {
    assert.equal(read('@builder two add tests').agentId, 'builder-two')
  }],
  ['anything not naming an agent goes to PM, whatever kind of job it is', () => {
    for (const job of ['plan the release', 'why does the scan take 600ms', 'review the diff', 'fix the failing test', 'can you add dark mode', 'the tests pass on CI but not here?']) {
      assert.equal(read(job).agentId, 'manager', job)
      assert.equal(read(job).agentBy, 'kind', job)
    }
  }],
  ['the selected stone wins over one named in the text', () => {
    const reading = read('fix Shellter', '/p/grove')
    assert.deepEqual([reading.stoneId, reading.stoneBy], ['/p/grove', 'selected'])
  }],
  ['a stone named as a whole word is found, the longest name first', () => {
    assert.equal(read('fix the header in Grove Studio').stoneId, '/p/grove-studio')
    assert.equal(read('fix the header in grove').stoneId, '/p/grove')
    assert.equal(read('fix all the Groves').stoneId, null)
  }],
  ['with one stone it is the one; with several and none named, nobody guesses', () => {
    assert.equal(read('fix it', null, [stones[2]!]).stoneBy, 'only')
    assert.equal(read('fix it').stoneId, null)
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} console rules hold.`)
