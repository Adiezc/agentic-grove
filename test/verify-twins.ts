/**
 * Twin stones, checked case by case. Run with `npm run verify:twins`.
 *
 * Builds real git repositories and worktrees in a temporary folder, so what is tested is what git
 * actually writes, not a guess at it. The grove is a disposable one (`AGENTIC_GROVE_HOME`), never
 * yours. Needs `git` on the PATH.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-twins-')))
process.env.AGENTIC_GROVE_HOME = path.join(home, 'grove')
const { addProject, grovePath, loadGrove, removeProject } = await import('../core/state/grove.ts')
const { readRepo, readRepos, twinsOf } = await import('../core/state/repos.ts')
const { deriveStones } = await import('../core/state/stones.ts')
const { defaultGrove } = await import('../core/state/schema.ts')
const { TWIN_GAP, layoutStones, placeAt, twinPlace } = await import('../src/scene/layout.ts')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' })

/** A repository with one commit, a worktree beside it, and one where Claude Code puts its own. */
const repo = path.join(home, 'site')
const beside = path.join(home, 'site-feature')
const claudeTree = path.join(repo, '.claude', 'worktrees', 'quiet-fox')
const plain = path.join(home, 'notes')
await fsp.mkdir(repo, { recursive: true })
await fsp.mkdir(plain, { recursive: true })
git(repo, 'init', '-q')
await fsp.writeFile(path.join(repo, 'README'), 'hi\n')
git(repo, 'add', '.')
git(repo, 'commit', '-qm', 'first')
git(repo, 'worktree', 'add', '-q', '-b', 'feature', beside)
git(repo, 'worktree', 'add', '-q', '-b', 'claude/quiet-fox', claudeTree)

const cases: [string, () => Promise<void> | void][] = [
  ['git tells a main checkout, a worktree beside it, and one inside it apart', async () => {
    const main = await readRepo(repo)
    const side = await readRepo(beside)
    const inner = await readRepo(claudeTree)
    assert.deepEqual(main, { common: path.join(repo, '.git'), worktree: false, branch: 'main' })
    assert.deepEqual(side, { common: path.join(repo, '.git'), worktree: true, branch: 'feature' })
    assert.deepEqual(inner, { common: path.join(repo, '.git'), worktree: true, branch: 'claude/quiet-fox' })
  }],
  ['a plain folder, a subfolder of a repo and a missing folder are not checkouts', async () => {
    await fsp.mkdir(path.join(repo, 'docs'), { recursive: true })
    assert.equal(await readRepo(plain), null)
    assert.equal(await readRepo(path.join(repo, 'docs')), null)
    assert.equal(await readRepo(path.join(home, 'gone')), null)
  }],
  ['the main checkout anchors; without it, the first connected does; hidden stones are left out', async () => {
    const repos = await readRepos([repo, beside, claudeTree, plain])
    assert.deepEqual([...twinsOf([{ path: repo }, { path: beside }, { path: plain }], repos)], [[beside, repo]])
    assert.deepEqual([...twinsOf([{ path: beside }, { path: repo }], repos)], [[beside, repo]])
    assert.deepEqual([...twinsOf([{ path: claudeTree }, { path: beside }], repos)], [[beside, claudeTree]])
    assert.deepEqual([...twinsOf([{ path: repo, hidden: true }, { path: beside }], repos)], [])
  }],
  ['a twin is derived beside its anchor, named by its branch, with no place of its own', async () => {
    const repos = await readRepos([repo, beside])
    const grove = { ...defaultGrove(), stones: [{ path: repo, place: 0 }, { path: beside, place: 1 }] }
    const { stones } = deriveStones([], grove, Date.now(), repos)
    const [main, twin] = stones
    assert.equal(main!.twin, undefined)
    assert.equal(main!.name, 'site')
    assert.equal(main!.place, 0)
    assert.equal(twin!.twin, true)
    assert.equal(twin!.parent, repo)
    assert.equal(twin!.name, 'feature')
    assert.equal(twin!.place, undefined)
  }],
  ['without git information nothing is a twin, as before', () => {
    const grove = { ...defaultGrove(), stones: [{ path: repo }, { path: beside }] }
    const { stones } = deriveStones([], grove)
    assert.ok(stones.every((stone) => !stone.twin && !stone.parent))
  }],
  ['a twin stands beside its anchor, further from the centre line, and the scene agrees', async () => {
    const anchor = placeAt(2) // front left: the side that matters, nearest the console
    const at = twinPlace(anchor, 0)
    assert.ok(Math.abs(Math.hypot(at[0] - anchor[0], at[1] - anchor[1]) - TWIN_GAP) < 0.25)
    assert.ok(Math.abs(at[0]) > Math.abs(anchor[0]), 'first twin should move away from x = 0')
    const repos = await readRepos([repo, beside])
    const grove = { ...defaultGrove(), stones: [{ path: repo, place: 2 }, { path: beside }] }
    const specs = layoutStones(deriveStones([], grove, Date.now(), repos).stones)
    assert.deepEqual(specs[1]!.at, at)
    assert.equal(specs[1]!.twin, true)
  }],
  ['connecting a worktree, beside or inside, takes no circle', async () => {
    await addProject(repo)
    await addProject(beside)
    await addProject(claudeTree)
    await addProject(plain)
    const places = Object.fromEntries((await loadGrove()).grove.stones.map((stone) => [path.basename(stone.path), stone.place]))
    assert.deepEqual(places, { site: 0, 'site-feature': undefined, 'quiet-fox': undefined, notes: 1 })
  }],
  ['removing the anchor hands its place to its twin', async () => {
    await removeProject(repo)
    const stones = (await loadGrove()).grove.stones
    const placeOf = (folder: string) => stones.find((stone) => stone.path === folder)?.place
    // `beside` was connected first, so it anchors now, on the place the main checkout left.
    assert.equal(placeOf(beside), 0)
    assert.equal(placeOf(claudeTree), undefined)
    assert.equal(placeOf(plain), 1)
  }],
  ['a twin connected before twins existed loses its old number on the next change', async () => {
    const grove = (await loadGrove()).grove
    grove.stones = [{ path: repo, place: 0 }, { path: beside, place: 1 }]
    await fsp.writeFile(grovePath(), JSON.stringify(grove, null, 2))
    await addProject(plain)
    const stones = (await loadGrove()).grove.stones
    assert.equal(stones.find((stone) => stone.path === beside)?.place, undefined)
    assert.equal(stones.find((stone) => stone.path === plain)?.place, 1)
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
console.log(`\nAll ${cases.length} twin rules hold.`)
