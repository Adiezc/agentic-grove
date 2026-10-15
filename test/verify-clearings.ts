/**
 * Clearings, checked case by case. Run with `npm run verify:clearings`.
 *
 * The pure rules in `core/state/clearings.ts`, then the real joining, leaving, renaming and undoing
 * in `core/state/grove.ts` against a disposable grove (`AGENTIC_GROVE_HOME`), never yours.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-clearings-'))
process.env.AGENTIC_GROVE_HOME = home
const { addProject, declineClearing, joinClearing, leaveClearing, loadGrove, makeClearing, removeClearing, removeProject, renameClearing } = await import('../core/state/grove.ts')
const { clearingCentre, clearingsOf, coveredPlaces, followersOf, memberSpot, ringRadius, TREE_CLEARANCE, CLEARING_OUTSET, suggestClearings } = await import('../core/state/clearings.ts')
const { parseGrove } = await import('../core/state/schema.ts')
const { placeAt } = await import('../core/state/places.ts')

const folder = async (name: string) => {
  const dir = path.join(home, 'projects', name)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}
const project = (name: string) => path.join(home, 'projects', name)
/** Each stone as `place` or `place/clearing`, by folder name. */
const state = async () =>
  Object.fromEntries(
    (await loadGrove()).grove.stones.map((stone) => [path.basename(stone.path), [stone.place ?? '-', stone.clearing ?? ''].join('/').replace(/\/$/, '')])
  )
const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

const cases: [string, () => Promise<void> | void][] = [
  ['a clearing stands on its first numbered stone, and names match ignoring case', () => {
    const clearings = clearingsOf([
      { id: 'a', clearing: 'Work' },
      { id: 'b', clearing: 'work ', place: 3 },
      { id: 'c' },
      { id: 'd', clearing: 'WORK' },
    ])
    assert.deepEqual(clearings, [{ name: 'Work', anchor: 'b', members: ['b', 'a', 'd'] }])
    assert.deepEqual([...followersOf([{ id: 'a', clearing: 'Work' }, { id: 'b', clearing: 'Work', place: 1 }])], ['a'])
  }],
  ['its stones stand round the centre, apart, and two stand side by side', () => {
    const centre: [number, number] = [4, -3]
    const spots = [0, 1, 2].map((index) => memberSpot(centre, index, 3))
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(near(spots[i]!, spots[j]!) > 1.5, 'stones too close')
    const pair = [0, 1].map((index) => memberSpot(centre, index, 2))
    assert.ok(Math.abs(pair[0]![1] - pair[1]![1]) < 1e-9, 'a pair should stand side by side, not one behind the other')
    assert.deepEqual(memberSpot(centre, 0, 1), centre)
  }],
  ['a clearing stands further out than its place, clear of the roots, and never towards the camera', () => {
    for (const count of [1, 2, 3, 5]) {
      for (const index of [0, 1, 2, 3, 6, 10]) {
        const place = placeAt(index)
        const centre = clearingCentre(place, count)
        assert.ok(Math.hypot(...centre) >= TREE_CLEARANCE + ringRadius(count) - 1e-9, `place ${index}, ${count} stones: inside the roots`)
        assert.ok(Math.hypot(...centre) > Math.hypot(...place), `place ${index}: not further out`)
        assert.ok(centre[1] <= place[1], `place ${index}: moved towards the camera`)
        assert.ok(Math.abs(centre[0]) - Math.abs(place[0]) <= CLEARING_OUTSET, `place ${index}: moved too far sideways`)
      }
    }
  }],
  ['the places a clearing covers are its neighbours, never itself', () => {
    const covered = coveredPlaces([{ place: 0, size: 3 }])
    assert.ok(!covered.has(0))
    for (const index of covered) assert.ok(near(placeAt(index), clearingCentre(placeAt(0), 3)) < ringRadius(3) + 0.9)
    assert.equal(coveredPlaces([]).size, 0)
  }],
  ['a group is suggested from shared hours, and never again once declined', () => {
    const stones = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd', clearing: 'Work' }, { id: 'e', parent: 'a' }]
    const pairs = [
      { a: 'a', b: 'b', hours: 4, freshness: 1 },
      { a: 'b', b: 'c', hours: 3, freshness: 1 },
      { a: 'a', b: 'd', hours: 9, freshness: 1 },
      { a: 'a', b: 'e', hours: 9, freshness: 1 },
      { a: 'c', b: 'x', hours: 1, freshness: 1 },
    ]
    const offers = suggestClearings(stones, pairs)
    assert.equal(offers.length, 1)
    assert.deepEqual([...offers[0]!.stones].sort(), ['a', 'b', 'c'])
    assert.deepEqual(suggestClearings(stones, pairs, [['c', 'b', 'a']]), [])
    assert.deepEqual(suggestClearings(stones, [{ a: 'a', b: 'b', hours: 2, freshness: 1 }]), [], 'two hours is a coincidence, not a habit')
  }],
  ['grove.json keeps a clearing name and reports a bad one', () => {
    const { grove, problems } = parseGrove({ stones: [{ path: '/a', clearing: '  Side   projects ' }, { path: '/b', clearing: 7 }], declinedClearings: [['/a', '/b'], ['/c']] })
    assert.equal(grove.stones[0]!.clearing, 'Side projects')
    assert.equal(grove.stones[1]!.clearing, undefined)
    assert.deepEqual(problems.map((problem) => problem.where), ['stones[1].clearing'])
    assert.deepEqual(grove.declinedClearings, [['/a', '/b']])
  }],
  ['joining walks a stone over: it gives up its own place', async () => {
    for (const name of ['a', 'b', 'c', 'd']) await addProject(await folder(name))
    assert.deepEqual(await state(), { a: '0', b: '1', c: '2', d: '3' })
    assert.deepEqual(await joinClearing(project('a'), 'Work'), { ok: true })
    assert.deepEqual(await joinClearing(project('c'), 'work'), { ok: true })
    assert.deepEqual(await state(), { a: '0/Work', b: '1', c: '-/Work', d: '3' })
  }],
  ['a new stone does not land inside a clearing', async () => {
    await addProject(await folder('e'))
    const place = (await loadGrove()).grove.stones.find((stone) => stone.path === project('e'))!.place!
    assert.ok(!coveredPlaces([{ place: 0, size: 2 }]).has(place), `landed on ${place}, inside the clearing`)
  }],
  ['the first stone leaving hands its place on, so the clearing stays put', async () => {
    await joinClearing(project('d'), 'Work')
    assert.deepEqual(await leaveClearing(project('a')), { ok: true })
    const now = await state()
    assert.equal(now.c, '0/Work')
    assert.equal(now.d, '-/Work')
    assert.match(now.a!, /^\d+$/, 'a stands on a place of its own again')
  }],
  ['renaming changes every stone, and two clearings cannot share a name', async () => {
    assert.deepEqual(await renameClearing('work', 'Day job'), { ok: true })
    assert.deepEqual(Object.values(await state()).filter((each) => each.endsWith('/Day job')).length, 2)
    await joinClearing(project('b'), 'Play')
    assert.equal((await renameClearing('Play', 'day JOB')).ok, false)
  }],
  ['removing the stone a clearing stands on passes the place to the next', async () => {
    await removeProject(project('c'))
    assert.equal((await state()).d, '0/Day job')
  }],
  ['undoing a clearing puts every stone back on a place of its own', async () => {
    await joinClearing(project('a'), 'Day job')
    assert.deepEqual(await removeClearing('Day job'), { ok: true })
    const now = await state()
    for (const name of ['a', 'd']) assert.match(now[name]!, /^\d+$/, `${name} should stand alone`)
    assert.equal(now.d, '0', 'the stone it stood on keeps that place')
    assert.equal(new Set(Object.values(now).map((each) => each.split('/')[0])).size, Object.keys(now).length, 'no two stones on one place')
  }],
  ['a suggestion accepted makes the clearing; declined, it is remembered', async () => {
    await removeClearing('Play')
    assert.deepEqual(await makeClearing([project('a'), project('d')], 'Studies'), { ok: true })
    const now = await state()
    assert.equal(now.d, '-/Studies')
    assert.match(now.a!, /^\d+\/Studies$/)
    assert.equal((await makeClearing([project('a'), project('e')], 'Other')).ok, false, 'a stone already in a clearing is not taken')
    await declineClearing([project('e'), project('b')])
    await declineClearing([project('b'), project('e')])
    assert.deepEqual((await loadGrove()).grove.declinedClearings, [[project('b'), project('e')].sort()])
  }],
  ['a sub-stone cannot join a clearing', async () => {
    const part = path.join(project('b'), 'web')
    await fsp.mkdir(part, { recursive: true })
    await addProject(part)
    assert.equal((await joinClearing(part, 'Studies')).ok, false)
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
console.log(`\nAll ${cases.length} clearing rules hold.`)
