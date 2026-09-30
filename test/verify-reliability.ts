/**
 * The two reliability faults the 30 September review reproduced, reproduced again and checked
 * fixed. Run with `npm run verify:reliability`.
 *
 * Works in a disposable folder (`AGENTIC_GROVE_HOME`), never your grove. The scan check reads this
 * Mac's sessions, read-only, like `npm run scan`.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-reliability-'))
process.env.AGENTIC_GROVE_HOME = home
const { addAgent, grovePath, loadGrove, saveSettings, updateGrove } = await import('../core/state/grove.ts')
const { startScanLoop } = await import('../core/scan.ts')

const cases: [string, () => Promise<void>][] = [
  ['two settings saved at the same moment both land', async () => {
    const results = await Promise.all([saveSettings({ showCounts: false }), saveSettings({ graphics: 'performance' })])
    assert.deepEqual(results.map((result) => result.ok), [true, true])
    const { grove } = await loadGrove()
    assert.equal(grove.settings.showCounts, false, 'the first change was lost')
    assert.equal(grove.settings.graphics, 'performance', 'the second change was lost')
  }],
  ['ten agents with one name grown at once get ten different ids', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => addAgent({ name: 'Builder Two', description: '', harness: 'claude-code' })))
    const ids = results.map((result) => result.id)
    assert.equal(new Set(ids).size, 10)
    assert.equal((await loadGrove()).grove.agents.length, 10)
  }],
  ['a hand edit made while a change is in progress is kept, and the change is made on top of it', async () => {
    let first = true
    await updateGrove((grove) => {
      if (first) {
        first = false
        // As if you saved the file in an editor at exactly this moment.
        const edited = { ...grove, settings: { ...grove.settings, alwaysShowNames: true } }
        return fsp.writeFile(grovePath(), JSON.stringify(edited, null, 2)).then(() => {
          grove.settings.showFireflies = false
          return { result: null, write: true }
        })
      }
      grove.settings.showFireflies = false
      return { result: null, write: true }
    }, null)
    const { grove } = await loadGrove()
    assert.equal(grove.settings.alwaysShowNames, true, 'the hand edit was written over')
    assert.equal(grove.settings.showFireflies, false, 'the change was dropped')
  }],
  ['no temporary files are left beside grove.json', async () => {
    const left = (await fsp.readdir(home)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(left, [])
  }],
  ['a scan loop stopped mid-pass never reports that pass', async () => {
    let calls = 0
    const stop = startScanLoop(() => {
      calls += 1
    }, 60_000)
    stop()
    await new Promise((resolve) => setTimeout(resolve, 3000))
    assert.equal(calls, 0)
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
console.log(`\nAll ${cases.length} reliability checks hold.`)
