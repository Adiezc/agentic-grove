/**
 * Carved messages, checked case by case. Run with `npm run verify:notes`.
 *
 * The pure rules in `core/state/notes.ts`, the file format in `schema.ts`, then carving and
 * reading for real against a disposable grove (`AGENTIC_GROVE_HOME`), never yours.
 */
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-verify-notes-'))
process.env.AGENTIC_GROVE_HOME = home
const { addProject, carveNote, loadGrove, readNote, removeProject } = await import('../core/state/grove.ts')
const { hasWokenUp, noteOn, noteViews } = await import('../core/state/notes.ts')
const { parseGrove } = await import('../core/state/schema.ts')

const carved = '2026-10-03T12:00:00.000Z'
const before = Date.parse(carved) - 60_000
const after = Date.parse(carved) + 60_000
const stone = (id: string, ...created: number[]) => ({ id, sessions: created.map((createdAt) => ({ createdAt })) })

const cases: [string, () => Promise<void> | void][] = [
  ['a stone note waits through old sessions and shows once a new one starts there', () => {
    const note = { on: 'stone' as const, id: '/a', text: 'hi', at: carved }
    assert.equal(hasWokenUp(note, [stone('/a', before)], []), false)
    assert.equal(hasWokenUp(note, [stone('/b', after)], []), false, 'work elsewhere does not count')
    assert.equal(hasWokenUp(note, [stone('/a', before, after)], []), true)
  }],
  ['an agent note shows once that agent is sent somewhere', () => {
    const note = { on: 'agent' as const, id: 'builder', text: 'hi', at: carved }
    assert.equal(hasWokenUp(note, [stone('/a', after)], [{ agentId: 'builder', createdAt: before }]), false)
    assert.equal(hasWokenUp(note, [], [{ agentId: 'researcher', createdAt: after }]), false)
    assert.equal(hasWokenUp(note, [], [{ agentId: 'builder', createdAt: after }]), true)
  }],
  ['a tree note shows once work starts anywhere', () => {
    const note = { on: 'tree' as const, id: '', text: 'hi', at: carved }
    assert.equal(hasWokenUp(note, [stone('/a', before)], [{ agentId: 'x', createdAt: before }]), false)
    assert.equal(hasWokenUp(note, [stone('/b', after)], []), true)
    assert.equal(hasWokenUp(note, [], [{ agentId: 'x', createdAt: after }]), true)
  }],
  ['states and lookup', () => {
    const views = noteViews([{ on: 'tree', id: '', text: 't', at: carved }, { on: 'stone', id: '/a', text: 's', at: carved }], [stone('/a', after)], [])
    assert.deepEqual(views.map((view) => view.state), ['showing', 'showing'])
    assert.equal(noteOn(views, 'tree', 'anything')?.text, 't')
    assert.equal(noteOn(views, 'stone', '/b'), undefined)
  }],
  ['hand-written notes are read, and bad ones explained rather than kept', () => {
    const { grove, problems } = parseGrove({
      notes: [
        { on: 'stone', id: '/a', text: '  start with the tests  ', at: '2026-10-03T12:00:00Z' },
        { on: 'stone', id: '/a', text: 'second', at: '2026-10-03T12:00:00Z' },
        { on: 'tree', text: 'for the tree', at: '2026-10-03' },
        { on: 'rock', id: '/a', text: 'x', at: carved },
        { on: 'agent', text: 'no id', at: carved },
        { on: 'stone', id: '/c', text: 'no date', at: 'soon' },
      ],
    })
    assert.deepEqual(grove.notes.map((note) => [note.on, note.id, note.text]), [['stone', '/a', 'start with the tests'], ['tree', '', 'for the tree']])
    assert.equal(problems.length, 4)
    // Each load starts fresh: the same file read twice keeps the same notes.
    assert.equal(parseGrove({ notes: [{ on: 'tree', text: 'x', at: carved }] }).grove.notes.length, 1)
    assert.equal(parseGrove({ notes: [{ on: 'tree', text: 'x', at: carved }] }).grove.notes.length, 1)
  }],
  ['carving needs a real place, replaces the note there, and empty text removes it', async () => {
    const dir = path.join(home, 'project')
    await fsp.mkdir(dir, { recursive: true })
    await addProject(dir)
    assert.equal((await carveNote('stone', '/nowhere', 'x')).ok, false)
    assert.equal((await carveNote('agent', 'nobody', 'x')).ok, false)
    assert.equal((await carveNote('rock', dir, 'x')).ok, false)
    assert.equal((await carveNote('stone', dir, 'x'.repeat(601))).ok, false)
    assert.ok((await carveNote('stone', dir, 'first')).ok)
    assert.ok((await carveNote('stone', dir, 'second')).ok)
    assert.ok((await carveNote('agent', 'researcher', 'for researcher')).ok)
    assert.ok((await carveNote('tree', 'ignored', 'for the tree')).ok)
    const notes = (await loadGrove()).grove.notes
    assert.deepEqual(notes.map((note) => [note.on, note.id, note.text]), [
      ['stone', dir, 'second'],
      ['agent', 'researcher', 'for researcher'],
      ['tree', '', 'for the tree'],
    ])
    assert.ok((await carveNote('agent', 'researcher', '   ')).ok)
    assert.equal((await loadGrove()).grove.notes.length, 2)
  }],
  ['reading a note removes it; reading it again is harmless', async () => {
    assert.ok((await readNote('tree', '')).ok)
    assert.ok((await readNote('tree', '')).ok)
    assert.deepEqual((await loadGrove()).grove.notes.map((note) => note.on), ['stone'])
  }],
  ['taking a stone off the grove takes its note too', async () => {
    await removeProject(path.join(home, 'project'))
    assert.equal((await loadGrove()).grove.notes.length, 0)
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
console.log(`\nAll ${cases.length} note rules hold.`)
