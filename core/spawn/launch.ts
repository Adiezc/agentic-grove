/**
 * Starting an agent on a stone: open Terminal in the project's folder, running your own copy of
 * Claude Code (or Codex) with the task.
 *
 * **Why Terminal, and not the Agent SDK inside the Grove.** Anthropic does not allow apps like
 * this one to run agents on your Claude subscription through the Agent SDK; that route needs an
 * API key billed per token. Launching the official `claude` command in a window you can see keeps
 * the work on your own plan, inside the tools' own rules, and in front of you: you can watch it,
 * answer its questions, and stop it with Ctrl-C like any session you started yourself. The Grove
 * follows along through the hooks and the scan. Decided 30 September 2026; see DECISIONS.md.
 *
 * **Nothing you type becomes shell code.** The task, the folder, the agent's brief and the
 * session's name are written to files beside the script, and the script reads each one inside
 * double quotes (`"$(cat task.txt)"`), which the shell never re-reads as commands. The script's
 * own text is fixed apart from paths this file chose. Everything is deleted by the script before
 * the agent starts, so no task is left lying in a temporary folder.
 *
 * `core/` stays free of Electron: the caller passes in how to open a file (in the app, that is
 * `shell.openPath`, which hands a `.command` file to Terminal).
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cliPath } from '../setup.ts'
import type { Run } from './runs.ts'

export interface LaunchSpec {
  run: Run
  /** The project folder. Checked by the caller to be one of your stones. */
  folder: string
  /** Appended to Claude Code's system prompt; put before the task for Codex, which has no such option. */
  brief: string
  /** Empty means the tool's own default. */
  model: string
  /**
   * PM's team, as the JSON Claude Code's `--agents` takes (see `briefs.ts`). Only PM runs on
   * Claude Code have one; with it, the workers are also stopped from starting workers of their own.
   */
  agents?: string
  /** Resume the run's existing session rather than start one. Claude Code only. */
  resume?: boolean
}

/** Resolves with an error message, or an empty string when the file opened. Electron's `shell.openPath` has this shape. */
export type Opener = (file: string) => Promise<string>

export type LaunchResult = { ok: true } | { ok: false; error: string; missing?: 'claude-code' | 'codex' }

/** Quote a path for zsh. Only ever used on paths this file made, but quoted properly regardless. */
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/**
 * Text that starts with a dash could be read as an option: "--dangerously-skip-permissions" typed
 * as a task must stay a task. A leading space stops that and changes nothing else.
 */
const notAnOption = (text: string) => (text.startsWith('-') ? ` ${text}` : text)

/** What Claude Code calls the session in `/resume` and the Terminal title: agent, then the start of the task. */
function sessionName(run: Run): string {
  const task = run.task.replace(/\s+/g, ' ').trim()
  const short = task.length > 48 ? `${task.slice(0, 47)}…` : task
  return short ? `${run.agentName}: ${short}` : run.agentName
}

/**
 * The script Terminal runs. Every line that could carry your words reads them from a file, and the
 * files are removed before the tool starts.
 */
function script(dir: string, cli: string, spec: LaunchSpec): string {
  const { run } = spec
  const at = (name: string) => quote(path.join(dir, name))
  const lines = [
    '#!/bin/zsh',
    'clear',
    `cd -- "$(cat ${at('folder.txt')})" || exit 1`,
    `TASK="$(cat ${at('task.txt')})"`,
    `NAME="$(cat ${at('name.txt')})"`,
    `MODEL="$(cat ${at('model.txt')})"`,
    // The brief has to outlive the folder for Claude Code, which reads it after starting, so it is
    // copied into a variable too and handed over as text rather than as a file.
    `BRIEF="$(cat ${at('brief.txt')})"`,
    `AGENTS="$(cat ${at('agents.txt')})"`,
    `rm -rf -- ${quote(dir)}`,
  ]
  // Arguments are gathered in an array, one element each, because zsh keeps "$TASK" as one
  // argument however many spaces or quotes it holds, and optional ones are simply not added.
  if (run.harness === 'claude-code' && spec.resume) {
    lines.push(`ARGS=(--resume ${run.id})`)
  } else if (run.harness === 'claude-code') {
    lines.push(
      `ARGS=(--session-id ${run.id} --name "$NAME")`,
      '[[ -n "$BRIEF" ]] && ARGS+=(--append-system-prompt "$BRIEF")',
      '[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")',
      // One level of delegation: PM may start workers, workers may not start their own.
      '[[ -n "$AGENTS" ]] && ARGS+=(--agents "$AGENTS") && export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1',
      '[[ -n "$TASK" ]] && ARGS+=("$TASK")'
    )
  } else {
    // Codex takes the task as its opening prompt; the brief goes in front, separated by a blank line.
    lines.push(
      'ARGS=()',
      '[[ -n "$MODEL" ]] && ARGS+=(-m "$MODEL")',
      'PROMPT="$TASK"',
      '[[ -n "$BRIEF" ]] && PROMPT="$BRIEF"$\'\\n\\n\'"$TASK"',
      '[[ -n "$PROMPT" ]] && ARGS+=("$PROMPT")'
    )
  }
  lines.push(`exec ${quote(cli)} "\${ARGS[@]}"`)
  return lines.join('\n') + '\n'
}

/**
 * Write the script and hand it to Terminal. `findCli` is only ever replaced by the checks in
 * `test/verify-spawn.ts`, which point it at a stand-in that records the arguments it was given.
 */
export async function launch(spec: LaunchSpec, open: Opener, findCli = cliPath): Promise<LaunchResult> {
  const { run } = spec
  if (spec.resume && run.harness !== 'claude-code') {
    return { ok: false, error: 'Resuming from the Grove works for Claude Code only. Open Codex to carry on.' }
  }
  const cli = await findCli(run.harness)
  if (!cli) {
    const tool = run.harness === 'claude-code' ? 'Claude Code' : 'Codex'
    return { ok: false, error: `${tool}'s command is not installed on this Mac yet.`, missing: run.harness }
  }

  let dir = ''
  try {
    // A private folder per launch, readable by you only, so no two launches can see each other's files.
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-run-'))
    const files: Record<string, string> = {
      'folder.txt': spec.folder,
      'task.txt': notAnOption(run.task),
      'name.txt': notAnOption(sessionName(run)),
      'model.txt': notAnOption(spec.model),
      'brief.txt': notAnOption(spec.brief),
      // JSON always starts with a brace, never a dash, so it cannot be read as an option.
      'agents.txt': spec.run.harness === 'claude-code' ? (spec.agents ?? '') : '',
    }
    for (const [name, text] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), text, { mode: 0o600 })
    const file = path.join(dir, `${run.agentId}.command`)
    await fsp.writeFile(file, script(dir, cli, spec), { mode: 0o700 })
    const failure = await open(file)
    if (failure) throw new Error(failure)
    return { ok: true }
  } catch (error) {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `Terminal did not open: ${error instanceof Error ? error.message : String(error)}` }
  }
}
