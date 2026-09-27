/**
 * `npm run verify:tells` — check the tell reader against small hand-written transcripts.
 *
 * The scan check (`verify-scan.ts`) compares the scanner with the real files on this machine.
 * Tells cannot be checked that way, because a quiet day has none to find, and "found nothing"
 * looks the same whether the reader works or not. So each tell gets a made-up transcript that
 * must trigger it, and each thing that must *not* count gets one too.
 *
 * The fixtures are written to a temporary folder and deleted afterwards. Nothing real is read.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readTells } from '../core/harnesses/claude-tells.ts'

let clock = Date.parse('2026-09-27T10:00:00Z')
const stamp = () => new Date((clock += 1000)).toISOString()
let ids = 0

/** An assistant message calling one tool, and the user record carrying its result. */
function call(name: string, input: Record<string, unknown>, result: string, isError = false): object[] {
  const id = `toolu_${++ids}`
  return [
    { type: 'assistant', timestamp: stamp(), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', timestamp: stamp(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result, is_error: isError }] } },
  ]
}
const say = (text: string) => ({ type: 'assistant', timestamp: stamp(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })
const fail = (name: string, message = 'Exit code 1') => call(name, { command: 'make' }, message, true)
const succeed = (name: string) => call(name, { command: 'make' }, 'ok')
const edit = (file: string, before: string, after: string) => call('Edit', { file_path: file, old_string: before, new_string: after }, 'edited')

const CASES: { label: string; records: object[]; expect: string[] }[] = [
  {
    label: 'three failures of one tool in a row is a repeated failure',
    records: [...fail('Bash'), ...fail('Bash'), ...fail('Bash'), ...succeed('Bash')],
    expect: ['repeated-failure'],
  },
  {
    label: 'a success in between resets the count',
    records: [...fail('Bash'), ...fail('Bash'), ...succeed('Bash'), ...fail('Bash'), ...succeed('Bash')],
    expect: [],
  },
  {
    label: 'an edit reversed by a later edit is an undone edit',
    records: [...edit('/p/app.ts', 'let a = 1', 'let a = 2'), ...succeed('Bash'), ...edit('/p/app.ts', 'let a = 2', 'let a = 1')],
    expect: ['undone-edit'],
  },
  {
    label: 'two edits to different text are not an undo',
    records: [...edit('/p/app.ts', 'let a = 1', 'let a = 2'), ...edit('/p/app.ts', 'let b = 1', 'let b = 2')],
    expect: [],
  },
  {
    label: 'a turn ending straight after a failure is ended-on-error',
    records: [...succeed('Bash'), ...fail('Bash'), say('Done, all working.')],
    expect: ['ended-on-error'],
  },
  {
    label: 'a turn ending after a failure that was then fixed is fine',
    records: [...fail('Bash'), ...succeed('Bash'), say('Done.')],
    expect: [],
  },
  {
    label: 'rejections and permission refusals are a person deciding, not a tell',
    records: [
      ...fail('Bash', "The user doesn't want to proceed with this tool use."),
      ...fail('Bash', 'Permission for this action was denied by the Claude Code auto mode classifier.'),
      ...fail('Bash', '[Request interrupted by user for tool use]'),
      say('Understood.'),
    ],
    expect: [],
  },
]

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-tells-'))
let failed = 0
try {
  for (const [index, testCase] of CASES.entries()) {
    const file = path.join(dir, `case-${index}.jsonl`)
    fs.writeFileSync(file, testCase.records.map((record) => JSON.stringify(record)).join('\n') + '\n')
    const found = (await readTells(file)).map((tell) => tell.kind)
    const ok = JSON.stringify(found) === JSON.stringify(testCase.expect)
    if (!ok) failed += 1
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${testCase.label}`)
    if (!ok) console.log(`        expected [${testCase.expect.join(', ')}], found [${found.join(', ')}]`)
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(failed ? `\n  ${failed} of ${CASES.length} checks failed.` : `\n  All ${CASES.length} checks passed.`)
process.exit(failed ? 1 : 0)
