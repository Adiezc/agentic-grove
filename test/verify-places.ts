/**
 * Stones keep their places, checked case by case. Run with `npm run verify:places`.
 *
 * The pure rules in `core/state/places.ts`, then the real add and remove in `core/state/grove.ts`
 * against a disposable grove (`AGENTIC_GROVE_HOME`), never yours.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-places-'))
process.env.AGENTIC_GROVE_HOME = home
const { addProject, grovePath, loadGrove, removeProject } = await import('../core/state/grove.ts')
const { assignPlaces, freePlaces } = await import('../core/state/places.ts')

const folder = async (name: string) => {
  const dir = path.join(home, 'projects', name)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}
const placesNow = async () => Object.fromEntries((await loadGrove()).grove.stones.map((stone) => [path.basename(stone.path), stone.place]))

const cases: [string, () => Promise<void> | void][] = [
  ['written places are kept; unnumbered stones fill the lowest free ones in order', () => {
    const at = assignPlaces([{ id: 'a', place: 2 }, { id: 'b' }, { id: 'c', place: 2 }, { id: 'd' }])
    assert.deepEqual([...at.entries()], [['a', 2], ['b', 0], ['c', 1], ['d', 3]])
  }],
  ['three circles to start, then always two spare, gaps first', () => {
    assert.deepEqual(freePlaces([]), [0, 1, 2])
    assert.deepEqual(freePlaces([0]), [1, 2])
    assert.deepEqual(freePlaces([0, 2, 3]), [1, 4])
  }],
  ['removing a stone leaves its place empty and moves nobody', async () => {
    const [a, b, c] = [await folder('a'), await folder('b'), await folder('c')]
    for (const dir of [a, b, c]) await addProject(dir)
    assert.deepEqual(await placesNow(), { a: 0, b: 1, c: 2 })
    await removeProject(a)
    assert.deepEqual(await placesNow(), { b: 1, c: 2 })
  }],
  ['a new stone takes the circle chosen, or the lowest free one', async () => {
    await addProject(await folder('d'), 4)
    await addProject(await folder('e'))
    assert.deepEqual(await placesNow(), { b: 1, c: 2, d: 4, e: 0 })
  }],
  ['a circle already taken is not given twice', async () => {
    await addProject(await folder('f'), 1)
    assert.equal((await placesNow()).f, 3)
  }],
  ['a sub-stone takes no numbered place', async () => {
    const part = path.join(await folder('b'), 'web')
    await fsp.mkdir(part, { recursive: true })
    await addProject(part)
    const entry = (await loadGrove()).grove.stones.find((stone) => stone.path === part)
    assert.equal(entry?.place, undefined)
  }],
  ['an older grove without numbers keeps its layout when one is removed', async () => {
    const [x, y, z] = [await folder('x'), await folder('y'), await folder('z')]
    const grove = (await loadGrove()).grove
    grove.stones = [{ path: x }, { path: y }, { path: z }]
    await fsp.writeFile(grovePath(), JSON.stringify(grove, null, 2))
    await removeProject(x)
    assert.deepEqual(await placesNow(), { y: 1, z: 2 })
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
console.log(`\nAll ${cases.length} place rules hold.`)
