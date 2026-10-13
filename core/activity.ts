/** A bounded projection of recorded tools and reported task/delegation metadata. No raw output. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isRecord, jsonLines, readTail, str } from './harnesses/fsutil.ts'

export interface RecordedTool {
  name: string
  label: string
  at: number
  outcome: 'requested' | 'returned' | 'errored'
  resultAt: number
}
export interface ActivityDetail {
  readAt: number
  fileChangedAt: number
  lastTool: RecordedTool | null
  tasks: { completed: number; total: number; current: string; at: number } | null
  delegations: { name: string; at: number }[]
  /** Older evidence outside this window is deliberately not loaded or claimed. */
  bounded: true
}

const clean = (value: unknown, limit = 100) => str(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
const stamp = (value: unknown, now: number) => {
  const at = Date.parse(str(value))
  return Number.isFinite(at) && at > 0 && at <= now + 60_000 ? at : 0
}
function argsOf(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  try { const parsed: unknown = JSON.parse(str(value)); return isRecord(parsed) ? parsed : {} } catch { return {} }
}

function labelFor(name: string, input: Record<string, unknown>): string {
  name = name.replace(/^functions\./, '')
  const file = clean(path.basename(str(input.file_path) || str(input.path) || str(input.notebook_path)))
  if (['Read', 'read_file', 'view_file'].includes(name)) return file ? `Reading ${file}` : 'Reading a file'
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'].includes(name)) return file ? `Editing ${file}` : 'Editing files'
  if (['Grep', 'Glob', 'search', 'search_query', 'WebSearch'].includes(name)) return 'Searching'
  if (['Task', 'Agent', 'spawn_agent'].includes(name)) return 'Requesting a worker'
  if (['TodoWrite', 'update_plan'].includes(name)) return 'Updating reported tasks'
  if (['Bash', 'exec_command', 'shell_command', 'shell'].includes(name)) {
    // Classify commands, not a model's free-form description. A testing call is never a pass.
    const command = str(input.command) || str(input.cmd)
    return /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?:\b|:)|verify:)|(?:npx\s+)?(?:vitest|jest|pytest)\b|(?:cargo|go)\s+test\b|python(?:3)?\s+-m\s+pytest\b)/.test(command.trimStart())
      ? 'Running a test command' : 'Running a command'
  }
  return name ? `Using ${clean(name, 60)}` : 'Using an unlabelled tool'
}

/** Claude message blocks and Codex function calls use different records, but share this projection. */
export function projectActivity(records: unknown[], provider: 'claude' | 'codex', now = Date.now()): ActivityDetail {
  const detail: ActivityDetail = { readAt: now, fileChangedAt: 0, lastTool: null, tasks: null, delegations: [], bounded: true }
  const calls = new Map<string, RecordedTool>()
  const workers = new Map<string, { name: string; at: number }>()
  let unnamed = 0
  const call = (name: string, raw: unknown, id: string, at: number) => {
    const kind = name.replace(/^functions\./, '')
    const input = argsOf(raw)
    const previous = id ? calls.get(id) : undefined
    const tool: RecordedTool = { name: clean(name, 60), label: labelFor(name, input), at, resultAt: previous?.resultAt ?? 0, outcome: previous?.outcome ?? 'requested' }
    if (id) calls.set(id, tool)
    detail.lastTool = tool
    const todos = kind === 'TodoWrite' ? input.todos : kind === 'update_plan' ? input.plan : undefined
    if (kind === 'TodoWrite' || kind === 'update_plan') detail.tasks = null
    if (Array.isArray(todos) && todos.length <= 100 && todos.every((item) => isRecord(item) && ['pending', 'in_progress', 'completed'].includes(str(item.status)))) {
      const current = todos.find((item) => isRecord(item) && item.status === 'in_progress')
      detail.tasks = { completed: todos.filter((item) => isRecord(item) && item.status === 'completed').length, total: todos.length,
        current: isRecord(current) ? clean(current.activeForm || current.content || current.step) : '', at }
    }
    if (['Task', 'Agent', 'spawn_agent'].includes(kind)) {
      const worker = clean(input.name || input.subagent_type || input.agent_type || input.description, 80)
      workers.set(id || `unnamed-${++unnamed}`, { name: worker || 'Unnamed worker', at })
      detail.delegations = [...workers.values()].slice(-6)
    }
  }
  const result = (id: string, errored: boolean, at: number) => {
    const tool = calls.get(id)
    if (tool) { tool.outcome = errored ? 'errored' : 'returned'; tool.resultAt = at }
  }
  for (const record of records) {
    if (!isRecord(record) || record.isMeta === true || record.isSidechain === true) continue
    const at = stamp(record.timestamp, now)
    if (provider === 'claude') {
      const message = isRecord(record.message) ? record.message : null
      if (!Array.isArray(message?.content)) continue
      for (const part of message.content) {
        if (!isRecord(part)) continue
        if (record.type === 'assistant' && part.type === 'tool_use') call(str(part.name), part.input, str(part.id), at)
        if (record.type === 'user' && part.type === 'tool_result') result(str(part.tool_use_id), part.is_error === true, at)
      }
    } else if (record.type === 'response_item' && isRecord(record.payload)) {
      const payload = record.payload
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') call(str(payload.name), payload.arguments ?? payload.input, str(payload.call_id), at)
      if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        const output = argsOf(payload.output)
        result(str(payload.call_id), typeof output.exit_code === 'number' && output.exit_code !== 0, at)
      }
    }
  }
  return detail
}

export async function readActivityFile(file: string, provider: 'claude' | 'codex'): Promise<ActivityDetail | null> {
  try {
    const [stat, tail] = await Promise.all([fs.stat(file), readTail(file, 256 * 1024)])
    const detail = projectActivity(jsonLines(tail), provider)
    detail.fileChangedAt = stat.mtimeMs
    return detail
  } catch { return null }
}
