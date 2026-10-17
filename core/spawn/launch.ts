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
import { isEffort } from '../models.ts'
import { cliPath } from '../setup.ts'
import { clearRunProcess, exitFile, pidFile, processFolder } from './process.ts'
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
   * How hard the model thinks: low, medium, high, xhigh, max (Codex also ultra). Empty or missing
   * means the tool's own default. See `core/models.ts` and `core/model-policy.ts`.
   */
  effort?: string
  /**
   * PM's team, as the JSON Claude Code's `--agents` takes (see `briefs.ts`). Only PM runs on
   * Claude Code have one; with it, the workers are also stopped from starting workers of their own.
   */
  agents?: string
  /** Resume the run's existing session rather than start one. Claude Code only. */
  resume?: boolean
  /**
   * PM's channel (`core/pm/`): the MCP config that starts the Grove's channel helper. With it,
   * Claude Code loads the helper as a development channel and may call its tools without asking,
   * since every tool that changes the grove asks you through a card of its own. Claude Code only.
   */
  channel?: { mcpConfig: string }
  /** Claude Code's permission mode for the session, such as `acceptEdits`. Missing keeps your own. */
  permissionMode?: string
  /** Folders the session may read and edit besides its own: PM gets every stone's folder. */
  addDirs?: string[]
}

/** Claude Code's permission modes (`claude --help`, 2.1.301). Only these are passed on. */
export const PERMISSION_MODES = ['acceptEdits', 'auto', 'default', 'manual', 'dontAsk', 'plan'] as const

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
 * Markers a Claude Code session leaves in the environment of everything it starts. If Terminal
 * itself was opened from inside a Claude Code session, a run would inherit them and Claude Code
 * would treat it as a child: it stops saving the transcript, so the run panel and the scan go
 * blind. A run the Grove starts is always a session of its own. Only these identity markers go;
 * settings you chose (`CLAUDE_CODE_USE_BEDROCK` and the like) are left as they are.
 */
const INHERITED_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
]

/**
 * The script Terminal runs. Every line that could carry your words reads them from a file, and the
 * files are removed before the tool starts.
 */
function script(dir: string, cli: string, spec: LaunchSpec, markers: string): string {
  const { run } = spec
  const at = (name: string) => quote(path.join(dir, name))
  const lines = [
    '#!/bin/zsh',
    'clear',
    // Word for `process.ts`: this script's process id now, the tool's exit code at the end.
    `mkdir -p -- ${quote(markers)} && print -r -- $$ > ${quote(pidFile(run.id, markers))}`,
    `unset ${INHERITED_SESSION_MARKERS.join(' ')}`,
    `cd -- "$(cat ${at('folder.txt')})" || exit 1`,
    `TASK="$(cat ${at('task.txt')})"`,
    `NAME="$(cat ${at('name.txt')})"`,
    `MODEL="$(cat ${at('model.txt')})"`,
    `EFFORT="$(cat ${at('effort.txt')})"`,
    // The brief has to outlive the folder for Claude Code, which reads it after starting, so it is
    // copied into a variable too and handed over as text rather than as a file.
    `BRIEF="$(cat ${at('brief.txt')})"`,
    `AGENTS="$(cat ${at('agents.txt')})"`,
    `MCP="$(cat ${at('mcp.txt')})"`,
    `MODE="$(cat ${at('mode.txt')})"`,
    // One folder per line; `(f)` splits on newlines only, so spaces in a path stay inside it.
    `DIRS=("\${(@f)$(cat ${at('dirs.txt')})}")`,
    `rm -rf -- ${quote(dir)}`,
  ]
  // Arguments are gathered in an array, one element each, because zsh keeps "$TASK" as one
  // argument however many spaces or quotes it holds, and optional ones are simply not added.
  if (run.harness === 'claude-code' && spec.resume) {
    lines.push(`ARGS=(--resume ${run.id})`)
    // PM's session is resumed every time the Grove brings PM back. Its brief and model are not
    // kept by Claude Code between starts, so they are handed over again; ordinary runs resume as they were.
    if (spec.channel) {
      lines.push(
        '[[ -n "$BRIEF" ]] && ARGS+=(--append-system-prompt "$BRIEF")',
        '[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")',
        '[[ -n "$EFFORT" ]] && ARGS+=(--effort "$EFFORT")',
        '[[ -n "$AGENTS" ]] && ARGS+=(--agents "$AGENTS") && export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1'
      )
    }
  } else if (run.harness === 'claude-code') {
    lines.push(
      `ARGS=(--session-id ${run.id} --name "$NAME")`,
      '[[ -n "$BRIEF" ]] && ARGS+=(--append-system-prompt "$BRIEF")',
      '[[ -n "$MODEL" ]] && ARGS+=(--model "$MODEL")',
      '[[ -n "$EFFORT" ]] && ARGS+=(--effort "$EFFORT")',
      // One level of delegation: PM may start workers, workers may not start their own.
      '[[ -n "$AGENTS" ]] && ARGS+=(--agents "$AGENTS") && export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1',
      '[[ -n "$TASK" ]] && ARGS+=("$TASK")'
    )
  } else {
    // Codex takes the task as its opening prompt; the brief goes in front, separated by a blank line.
    lines.push(
      'ARGS=()',
      '[[ -n "$MODEL" ]] && ARGS+=(-m "$MODEL")',
      // Codex has no effort option of its own; its setting is overridden for this session only.
      '[[ -n "$EFFORT" ]] && ARGS+=(-c "model_reasoning_effort=\\"$EFFORT\\"")',
      'PROMPT="$TASK"',
      '[[ -n "$BRIEF" ]] && PROMPT="$BRIEF"$\'\\n\\n\'"$TASK"',
      '[[ -n "$PROMPT" ]] && ARGS+=("$PROMPT")'
    )
  }
  if (run.harness === 'claude-code') {
    lines.push(
      '[[ -n "$MODE" ]] && ARGS+=(--permission-mode "$MODE")',
      'for D in "${DIRS[@]}"; do [[ -n "$D" ]] && ARGS+=(--add-dir "$D"); done',
      // `mcp__grove` allows every tool of the Grove's helper and nothing else.
      '[[ -n "$MCP" ]] && ARGS+=(--mcp-config "$MCP" --dangerously-load-development-channels server:grove --allowedTools mcp__grove)'
    )
  }
  // Not `exec`: the script stays to write the exit code once the tool stops. Ctrl-C and a closing
  // window are given a do-nothing handler here so the script outlives the tool by that one line;
  // a handler, unlike ignoring the signal, is reset for the tool, which still gets Ctrl-C as usual.
  lines.push(
    "trap ':' INT HUP TERM",
    `${quote(cli)} "\${ARGS[@]}"`,
    `print -r -- $? > ${quote(exitFile(run.id, markers))}`
  )
  return lines.join('\n') + '\n'
}

/**
 * Write the script and hand it to Terminal. `findCli` is only ever replaced by the checks in
 * `test/verify-spawn.ts`, which point it at a stand-in that records the arguments it was given.
 */
export async function launch(spec: LaunchSpec, open: Opener, findCli = cliPath, markers = processFolder()): Promise<LaunchResult> {
  const { run } = spec
  if (spec.resume && run.harness !== 'claude-code') {
    return { ok: false, error: 'Resuming from the Grove works for Claude Code only. Open Codex to carry on.' }
  }
  // Only a word the tool knows is handed over, the same care `isModelName` takes with models.
  if (spec.effort && !isEffort(run.harness === 'codex' ? 'codex' : 'claude-code', spec.effort)) {
    return { ok: false, error: `"${spec.effort.slice(0, 20)}" is not an effort ${run.harness === 'codex' ? 'Codex' : 'Claude Code'} accepts.` }
  }
  if (spec.permissionMode && !(PERMISSION_MODES as readonly string[]).includes(spec.permissionMode)) {
    return { ok: false, error: `"${spec.permissionMode.slice(0, 20)}" is not a permission mode Claude Code accepts.` }
  }
  if ((spec.channel || spec.addDirs?.length) && run.harness !== 'claude-code') {
    return { ok: false, error: 'PM\'s channel works with Claude Code only.' }
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
      'effort.txt': spec.effort ?? '',
      'brief.txt': notAnOption(spec.brief),
      // JSON always starts with a brace, never a dash, so it cannot be read as an option.
      'agents.txt': spec.run.harness === 'claude-code' ? (spec.agents ?? '') : '',
      // Paths this side chose (the helper's config) or stones from grove.json; a newline inside a
      // folder name would split it, so such a folder is left out rather than half-passed.
      'mcp.txt': spec.channel?.mcpConfig ?? '',
      'mode.txt': spec.permissionMode ?? '',
      'dirs.txt': (spec.addDirs ?? []).filter((d) => d && !d.includes('\n')).map(notAnOption).join('\n'),
    }
    for (const [name, text] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), text, { mode: 0o600 })
    const file = path.join(dir, `${run.agentId}.command`)
    await fsp.writeFile(file, script(dir, cli, spec, markers), { mode: 0o700 })
    // A resumed run reuses its id, so the last attempt's exit must not be read as this one's.
    await clearRunProcess(run.id, markers)
    const failure = await open(file)
    if (failure) throw new Error(failure)
    return { ok: true }
  } catch (error) {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `Terminal did not open: ${error instanceof Error ? error.message : String(error)}` }
  }
}
