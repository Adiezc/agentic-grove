/**
 * Tells: signs in a Claude Code transcript that the work may be worth a second look.
 *
 * Three patterns, each one a thing a person watching over the agent's shoulder would notice:
 *
 * - **repeated-failure**  the same tool failed three times in a row. The agent is retrying
 *                         rather than changing approach.
 * - **undone-edit**       an edit put a file back exactly as it was before an earlier edit.
 *                         The agent changed its mind, possibly more than once.
 * - **ended-on-error**    the turn ended straight after a failed tool call. The agent may have
 *                         given up, or reported success without noticing.
 *
 * A tell is a flag, never a verdict. It says what triggered it in plain words, so it can be
 * judged rather than trusted. That is also why failures a *person* caused are left out: a
 * rejected or interrupted tool call, or one refused by a permission rule, is your decision, not
 * the agent being unsure.
 *
 * **Why transcripts, not hooks.** Claude Code reports a failed tool call only through a hook
 * event the Grove does not install (`PostToolUseFailure`), so hooks would mean asking to edit
 * your settings again. The transcript already records every failure (`is_error`) and every edit,
 * for desktop and terminal sessions alike, and it survives a restart of the Grove.
 */
import path from 'node:path'
import { isRecord, jsonLines, readTail, str } from './fsutil.ts'
import type { Tell } from './types.ts'

/** Deep enough to hold a run of retries, small enough to read every scan for a busy session. */
const TAIL_BYTES = 256 * 1024
const STREAK = 3

/** Failures that are a person's decision rather than the agent's trouble. */
const DECIDED_BY_A_PERSON = [
  "doesn't want to proceed",
  'was rejected',
  'Request interrupted',
  'interrupted by user',
  'Permission for this action was denied',
]

interface ToolUse {
  name: string
  input: Record<string, unknown>
}

interface Edit {
  file: string
  before: string
  after: string
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => (isRecord(part) ? str(part.text) : '')).join(' ')
  return ''
}

const decidedByAPerson = (text: string) => DECIDED_BY_A_PERSON.some((phrase) => text.includes(phrase))

/** Tells found in one transcript's tail, oldest first. */
export async function readTells(file: string): Promise<Tell[]> {
  let records: unknown[]
  try {
    records = jsonLines(await readTail(file, TAIL_BYTES))
  } catch {
    return []
  }

  const tells: Tell[] = []
  const uses = new Map<string, ToolUse>()
  const edits: Edit[] = []
  const streaks = new Map<string, number>()
  /** The last tool result seen, so a turn that ends right after it can be judged. */
  let lastResult: { tool: string; failed: boolean; at: number } | null = null

  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.message)) continue
    const at = Date.parse(str(record.timestamp))
    if (!Number.isFinite(at)) continue
    const content = record.message.content
    if (!Array.isArray(content)) continue

    if (record.type === 'assistant') {
      let calledATool = false
      for (const part of content) {
        if (!isRecord(part) || part.type !== 'tool_use') continue
        calledATool = true
        if (typeof part.id === 'string' && isRecord(part.input)) uses.set(part.id, { name: str(part.name), input: part.input })
      }
      // Text with no tool call is the turn handing back to you. Straight after a failure, that
      // is the "ended on an error" tell.
      if (!calledATool && lastResult?.failed && record.message.stop_reason !== 'tool_use') {
        tells.push({ kind: 'ended-on-error', at, detail: `Stopped straight after ${lastResult.tool} failed` })
        lastResult = null
      }
      continue
    }

    if (record.type !== 'user') continue
    for (const part of content) {
      if (!isRecord(part) || part.type !== 'tool_result' || typeof part.tool_use_id !== 'string') continue
      const use = uses.get(part.tool_use_id)
      if (!use) continue
      const failed = part.is_error === true
      if (failed && decidedByAPerson(resultText(part.content))) {
        lastResult = null
        continue
      }
      lastResult = { tool: use.name, failed, at }

      if (failed) {
        const streak = (streaks.get(use.name) ?? 0) + 1
        streaks.set(use.name, streak)
        if (streak === STREAK) tells.push({ kind: 'repeated-failure', at, detail: `${use.name} failed ${STREAK} times in a row` })
        continue
      }
      streaks.set(use.name, 0)

      if (use.name === 'Edit') {
        const edit = {
          file: str(use.input.file_path),
          before: str(use.input.old_string),
          after: str(use.input.new_string),
        }
        if (!edit.file || !edit.before || !edit.after) continue
        const undone = edits.find((e) => e.file === edit.file && e.before === edit.after && e.after === edit.before)
        if (undone) tells.push({ kind: 'undone-edit', at, detail: `An edit to ${path.basename(edit.file)} was undone` })
        edits.push(edit)
      }
    }
  }
  return tells
}
