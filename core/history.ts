/**
 * The tree answers: questions about your own history, answered from what the scan already knows.
 *
 * Type "what did I do on Tuesday?" into the console and, instead of sending an agent, the Grove
 * answers itself and lights the stones involved in the order you worked on them.
 *
 * **Rules, not a model**, for the same reason as `console.ts`: the question is read with a few
 * plain patterns, here, where they can be read and tested. The console shows the reading before
 * Enter ("The tree answers: Tuesday"), and one click sends it to an agent instead, so a wrong
 * reading costs a click.
 *
 * **What counts as evidence.** A session records when it started and when it was last written to,
 * and nothing in between. So the Grove can say a session *started* in a period, or was *last
 * worked on* in it. A session that began before the period and was last touched after it may or
 * may not have been used during it; those are counted apart and said to be unknown, never folded
 * into the answer.
 *
 * **How far back it reaches.** Only as far as the oldest session the scan can see on this Mac, and
 * only for projects on the grove. When a question reaches back past that, the answer says where
 * the records start.
 */

export interface Period {
  /** Epoch ms, inclusive. */
  from: number
  /** Epoch ms, exclusive. Never later than now. */
  to: number
  /** How the period is said back: "today", "Tuesday", "the last 3 days". */
  label: string
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, a: 1, an: 1 }

/** Midnight at the start of the day `at` falls in, in this Mac's own time zone. */
function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Midnight `days` days before the start of `at`'s day. By the calendar, so a clock change does not shift it. */
function daysBefore(at: number, days: number): number {
  const date = new Date(startOfDay(at))
  date.setDate(date.getDate() - days)
  return date.getTime()
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** The period a phrase names, or `null` when the text names none. */
function periodIn(text: string, now: number): Period | null {
  const today = startOfDay(now)
  if (/\byesterday\b/.test(text)) return { from: daysBefore(now, 1), to: today, label: 'yesterday' }
  if (/\b(?:today|this (?:morning|afternoon|evening)|tonight|so far)\b/.test(text)) return { from: today, to: now, label: 'today' }

  const span = text.match(/\b(?:last|past)\s+(\d+|[a-z]+)?\s*(hours?|days?|weeks?)\b/)
  if (span && !(span[1] === undefined && /week/.test(span[2]!))) {
    const count = span[1] === undefined ? 1 : (Number(span[1]) || NUMBER_WORDS[span[1]] || 0)
    if (count > 0 && count <= 366) {
      const unit = span[2]!.replace(/s$/, '')
      const plural = count === 1 ? unit : `${unit}s`
      const from = unit === 'hour' ? now - count * 60 * 60 * 1000 : daysBefore(now, unit === 'week' ? count * 7 - 1 : count - 1)
      return { from, to: now, label: `the last ${count === 1 ? '' : `${count} `}${plural}`.replace('the last day', 'today') }
    }
  }

  // Weeks start on Monday.
  const sinceMonday = (new Date(now).getDay() + 6) % 7
  if (/\bthis week\b/.test(text)) return { from: daysBefore(now, sinceMonday), to: now, label: 'this week' }
  if (/\blast week\b/.test(text)) return { from: daysBefore(now, sinceMonday + 7), to: daysBefore(now, sinceMonday), label: 'last week' }

  for (const [index, name] of WEEKDAYS.entries()) {
    const found = text.match(new RegExp(`\\b(last\\s+)?${name}\\b`))
    if (!found) continue
    // The most recent such day. Said on a Tuesday, "Tuesday" is today and "last Tuesday" a week ago.
    let back = (new Date(now).getDay() - index + 7) % 7
    if (back === 0 && found[1]) back = 7
    const from = daysBefore(now, back)
    return { from, to: back === 0 ? now : daysBefore(now, back - 1), label: `${found[1] && back === 7 ? 'last ' : ''}${capital(name)}` }
  }
  return null
}

/** "What did I do", "what was I working on", "which projects did I touch", "what have I been doing". */
const ABOUT_ME =
  /\b(?:what|which (?:projects?|stones?))\b.*\b(?:did|have|was|were)\s+(?:i|we)\s+(?:do|doing|work|working|touch|get done|been (?:doing|working|up to)|up to)\b/
/** "What happened yesterday" is about you only when it names a time. */
const WHAT_HAPPENED = /^what(?:'s| has)? happened\b/

/**
 * Is this a question about your own history, and about when? `null` means it is an ordinary job
 * for an agent. A history question with no time in it means today.
 */
export function readQuestion(text: string, now: number): Period | null {
  const typed = text.trim().toLowerCase()
  if (!typed) return null
  const period = periodIn(typed, now)
  if (ABOUT_ME.test(typed)) return period ?? { from: startOfDay(now), to: now, label: 'today' }
  if (WHAT_HAPPENED.test(typed) && period) return period
  return null
}

/** The little the answer needs to know about a session. A scan `Session` fits as it is. */
export interface HistorySession {
  title: string
  createdAt: number
  lastActivityAt: number
}

export interface HistoryStone {
  id: string
  name: string
  sessions: HistorySession[]
}

export interface AnswerStone {
  id: string
  name: string
  /** Sessions that started, or were last worked on, inside the period. */
  sessions: number
  /** Up to three of their titles, earliest first. */
  titles: string[]
  /** The earliest moment inside the period with evidence of work here. Sets the lighting order. */
  firstAt: number
}

export interface Answer {
  period: Period
  /** Stones with evidence of work in the period, in the order you came to them. */
  stones: AnswerStone[]
  /** Sessions that began before the period and were last touched after it: use during it unknown. */
  spanning: number
  /** When the oldest record on the grove starts, if the question reaches back past it. */
  recordsStart: number | null
}

const inside = (at: number, period: Period) => at >= period.from && at < period.to
const UNTITLED = 'Untitled session'

export function answerHistory(period: Period, stones: HistoryStone[]): Answer {
  const found: AnswerStone[] = []
  let spanning = 0
  let oldest = Number.POSITIVE_INFINITY
  for (const stone of stones) {
    const touched: { title: string; at: number }[] = []
    for (const session of stone.sessions) {
      if (session.createdAt > 0) oldest = Math.min(oldest, session.createdAt)
      const started = inside(session.createdAt, period)
      const lastWorked = inside(session.lastActivityAt, period)
      if (started || lastWorked) touched.push({ title: session.title, at: started ? session.createdAt : session.lastActivityAt })
      else if (session.createdAt < period.from && session.lastActivityAt >= period.to) spanning += 1
    }
    if (!touched.length) continue
    touched.sort((a, b) => a.at - b.at)
    const titles = [...new Set(touched.map((each) => each.title).filter((title) => title && title !== UNTITLED))].slice(0, 3)
    found.push({ id: stone.id, name: stone.name, sessions: touched.length, titles, firstAt: touched[0]!.at })
  }
  found.sort((a, b) => a.firstAt - b.firstAt)
  const known = Number.isFinite(oldest)
  return {
    period,
    stones: found,
    spanning,
    recordsStart: known && period.from < startOfDay(oldest) ? oldest : null,
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "today", "yesterday" and "last Friday" stand alone; a bare weekday takes "on", a span takes "in". */
function when(label: string): string {
  if (/^[A-Z]/.test(label)) return `on ${label}`
  return label.startsWith('the ') ? `in ${label}` : label
}

const dayName = (at: number) => new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * The answer in words: one headline, and the notes that keep it honest. The stones themselves are
 * listed by the interface, which lights each one as it names it.
 */
export function describeAnswer(answer: Answer, stonesOnGrove: number): { headline: string; notes: string[] } {
  const said = when(answer.period.label)
  const sessions = answer.stones.reduce((sum, stone) => sum + stone.sessions, 0)
  const headline = !stonesOnGrove
    ? 'There are no projects on the grove yet, so there is nothing to look back on.'
    : answer.stones.length
      ? `${capital(said)} you worked on ${plural(answer.stones.length, 'project')}, across ${plural(sessions, 'session')}.`
      : `No sessions started or ended on the grove ${said}.`
  const notes: string[] = []
  if (answer.spanning) {
    notes.push(
      `${plural(answer.spanning, 'longer session')} ${answer.spanning === 1 ? 'was' : 'were'} open across that time. The Grove cannot tell whether ${answer.spanning === 1 ? 'it was' : 'they were'} used then.`
    )
  }
  if (answer.recordsStart !== null) notes.push(`The grove's records start on ${dayName(answer.recordsStart)}.`)
  return { headline, notes }
}
