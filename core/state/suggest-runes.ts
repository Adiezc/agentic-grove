/**
 * Suggested runes: noticing a job you keep starting by hand, and offering to save it.
 *
 * Roadmap idea 6. If three or more sessions in one project began with the same prompt ("run the
 * tests", "/review", "write the weekly summary"), that is a habit, and a habit is what a rune is
 * for: carved on the stone, it becomes one click. The Grove only ever *offers*. Nothing is carved
 * without a yes, and a "no" is written down (`declinedRunes` on the stone) so it is never asked
 * again.
 *
 * The evidence is each session's first prompt, which the scan already reads. Deliberately not
 * every prompt in every transcript: the opening line is what you came to do, later lines are the
 * conversation, and counting those would suggest "yes" and "continue" as tasks.
 *
 * Two prompts count as the same when they match after `promptKey`: case, spacing and trailing
 * punctuation ignored, nothing cleverer. "Run the tests." and "run the tests" are one habit;
 * "run the tests in core" is another. Fuzzy matching would find more, and be wrong more.
 *
 * Pure. `npm run verify:suggest-runes` checks the rules.
 */

/** Sessions that must have opened with the same prompt before it is offered. */
export const SUGGEST_AFTER = 3
/** At most this many offers per stone at once, busiest first. */
export const MAX_SUGGESTIONS = 3
/**
 * The scan keeps only the first 240 characters of a session's opening prompt (`preview` in the
 * adapters). A prompt that long may have been cut, so it is never offered: carving it would save
 * half a job. Anything near that length is a one-off brief anyway, not a repeatable task.
 */
const MAX_PROMPT_CHARS = 239

export interface RuneSuggestion {
  /** The prompt as you last typed it, which is what would be carved. */
  prompt: string
  /** How many sessions opened with it. */
  count: number
  /** The matching key, used to decline it. */
  key: string
}

/** What makes two prompts "the same". */
export function promptKey(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?…\s]+$/u, '')
}

/**
 * Lines that are not something you asked for: tool-generated wrappers (`<command-message>`,
 * `<local-command-stdout>`), the header the Claude app puts before attached files ("# Files
 * mentioned by the user", found in real sessions: the job itself comes after it and was cut off),
 * and placeholders for no prompt.
 */
function isAPrompt(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<') || trimmed.length > MAX_PROMPT_CHARS) return false
  return !/^(untitled session|no prompt|# files mentioned)/i.test(trimmed)
}

export function suggestRunes(
  sessions: { preview: string; lastActivityAt: number }[],
  carved: { prompt: string }[],
  declined: string[]
): RuneSuggestion[] {
  const skip = new Set([...carved.map((rune) => promptKey(rune.prompt)), ...declined.map(promptKey)])
  const groups = new Map<string, { prompt: string; count: number; latest: number }>()
  for (const session of sessions) {
    if (!isAPrompt(session.preview)) continue
    const key = promptKey(session.preview)
    if (!key || skip.has(key)) continue
    const group = groups.get(key) ?? { prompt: session.preview.trim(), count: 0, latest: 0 }
    group.count += 1
    // The wording kept is the most recent, so a prompt you have tidied up over time is offered tidy.
    if (session.lastActivityAt >= group.latest) {
      group.latest = session.lastActivityAt
      group.prompt = session.preview.trim()
    }
    groups.set(key, group)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count >= SUGGEST_AFTER)
    .sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)
    .slice(0, MAX_SUGGESTIONS)
    .map(([key, group]) => ({ prompt: group.prompt, count: group.count, key }))
}

/** A short name for a rune from its prompt: the first few words, as written. */
export function runeNameFor(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, ' ').split(' ')
  const name = words.slice(0, 5).join(' ')
  return words.length > 5 ? `${name}…` : name
}
