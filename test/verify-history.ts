/**
 * The tree answers, checked case by case. Run with `npm run verify:history`.
 *
 * Each case is one sentence of the rules in `core/history.ts`: which typed lines are questions
 * about your own history, which period they mean, and what the answer may and may not claim.
 */
import assert from 'node:assert/strict'
import { answerHistory, describeAnswer, readQuestion, type HistoryStone } from '../core/history.ts'

/** A Friday afternoon, in this Mac's own time zone, so the cases hold wherever they run. */
const NOW = new Date(2026, 9, 2, 15, 30).getTime()
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime()
const read = (text: string) => readQuestion(text, NOW)
const span = (text: string) => {
  const period = read(text)
  return period ? [period.from, period.to, period.label] : null
}

const session = (title: string, createdAt: number, lastActivityAt: number) => ({ title, createdAt, lastActivityAt })
const grove: HistoryStone[] = [
  { id: '/p/shellter', name: 'Shellter', sessions: [session('Fix the login', at(1, 16), at(1, 17)), session('Long refactor', at(-2), at(2, 9))] },
  { id: '/p/grove', name: 'Grove', sessions: [session('Usage probe', at(1, 9), at(1, 11)), session('Untitled session', at(1, 10), at(1, 10))] },
  { id: '/p/notes', name: 'Notes', sessions: [session('Old ideas', at(-9), at(-8))] },
]

const cases: [string, () => void][] = [
  ['an ordinary job is not a history question', () => {
    assert.equal(read('fix the login flow'), null)
    assert.equal(read('why is the scan slow today?'), null)
    assert.equal(read('what did the last deploy change'), null)
    assert.equal(read(''), null)
  }],
  ['"what did I do" with no time means today, up to now', () => {
    assert.deepEqual(span('What did I do?'), [at(2, 0), NOW, 'today'])
    assert.deepEqual(span('what was I working on this morning'), [at(2, 0), NOW, 'today'])
  }],
  ['yesterday is the whole of yesterday', () => {
    assert.deepEqual(span('what did I work on yesterday?'), [at(1, 0), at(2, 0), 'yesterday'])
    assert.deepEqual(span('what happened yesterday'), [at(1, 0), at(2, 0), 'yesterday'])
  }],
  ['"what happened" without a time is left to an agent', () => {
    assert.equal(read('what happened to the build'), null)
  }],
  ['a weekday is the most recent one; said on that day it is today, and "last" goes back a week', () => {
    assert.deepEqual(span('what did I do on Tuesday?'), [new Date(2026, 8, 29).getTime(), new Date(2026, 8, 30).getTime(), 'Tuesday'])
    assert.deepEqual(span('what did I do on friday'), [at(2, 0), NOW, 'Friday'])
    assert.deepEqual(span('what did I do last Friday'), [new Date(2026, 8, 25).getTime(), new Date(2026, 8, 26).getTime(), 'last Friday'])
  }],
  ['this week starts on Monday; last week is the seven days before that', () => {
    assert.deepEqual(span('which projects did I touch this week'), [new Date(2026, 8, 28).getTime(), NOW, 'this week'])
    assert.deepEqual(span('what did we do last week?'), [new Date(2026, 8, 21).getTime(), new Date(2026, 8, 28).getTime(), 'last week'])
  }],
  ['"the last 3 days" counts today as one of them', () => {
    assert.deepEqual(span('what have I been doing in the last 3 days'), [new Date(2026, 8, 30).getTime(), NOW, 'the last 3 days'])
    assert.deepEqual(span('what did I do in the past two hours'), [NOW - 2 * 3600_000, NOW, 'the last 2 hours'])
  }],
  ['stones come back in the order you came to them, with their session titles', () => {
    const answer = answerHistory(read('what did I do yesterday')!, grove)
    assert.deepEqual(answer.stones.map((stone) => [stone.name, stone.sessions, stone.titles]), [
      ['Grove', 2, ['Usage probe']],
      ['Shellter', 1, ['Fix the login']],
    ])
  }],
  ['a session open across the period is counted apart, never as work done then', () => {
    const answer = answerHistory(read('what did I do yesterday')!, grove)
    assert.equal(answer.spanning, 1)
    const { headline, notes } = describeAnswer(answer, grove.length)
    assert.equal(headline, 'Yesterday you worked on 2 projects, across 3 sessions.')
    assert.match(notes[0] ?? '', /1 longer session was open across that time\. The Grove cannot tell/)
  }],
  ['a session last worked on in the period counts, from the moment it was last touched', () => {
    const answer = answerHistory(read('what did I do today')!, grove)
    assert.deepEqual(answer.stones.map((stone) => [stone.name, stone.firstAt]), [['Shellter', at(2, 9)]])
  }],
  ['a quiet period says so plainly', () => {
    const answer = answerHistory(read('what did I do on Wednesday')!, grove)
    assert.equal(answer.stones.length, 0)
    assert.equal(describeAnswer(answer, grove.length).headline, 'No sessions started or ended on the grove on Wednesday.')
  }],
  ['a question that reaches back past the oldest record says where the records start', () => {
    const fresh: HistoryStone[] = [{ id: '/p/new', name: 'New', sessions: [session('First', at(1, 9), at(1, 10))] }]
    const answer = answerHistory(read('what did I do last week')!, fresh)
    assert.equal(answer.recordsStart, at(1, 9))
    assert.match(describeAnswer(answer, 1).notes.at(-1) ?? '', /The grove's records start on Thursday 1 October/)
    assert.equal(answerHistory(read('what did I do today')!, fresh).recordsStart, null)
  }],
  ['an empty grove has nothing to look back on', () => {
    assert.match(describeAnswer(answerHistory(read('what did I do today')!, []), 0).headline, /no projects on the grove yet/)
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
console.log(`\nAll ${cases.length} history rules hold.`)
