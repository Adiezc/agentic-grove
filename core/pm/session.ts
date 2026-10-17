/**
 * PM's long-lived session: started once, resumed ever after.
 *
 * PM keeps one Claude Code session, with a fixed id kept in `pm.json`, so it remembers the
 * conversation from one day to the next. "Start PM" opens it in a Terminal window (resuming it
 * when Claude Code still has it) with the Grove's channel loaded, PM's chat brief, every stone's
 * folder added, and the `acceptEdits` permission mode Adrian chose on 17 October 2026: PM and its
 * subagents edit freely; anything riskier asks, and the prompt shows in the Grove as well.
 *
 * The window is yours like any run's: minimise it, read it, or close it to stop PM. Its process is
 * followed the same way (`core/spawn/process.ts`), so the Grove knows when PM has gone.
 *
 * PM works from its own folder, `<grove home>/pm`, rather than any one project: it looks after
 * all of them. The folder holds nothing but a short note, so Claude Code has somewhere to start.
 */
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launch, type LaunchResult, type Opener } from '../spawn/launch.ts'
import { readRunProcess } from '../spawn/process.ts'
import type { Run } from '../spawn/runs.ts'
import { pmHome } from './protocol.ts'

export const pmFolder = (): string => path.join(pmHome(), 'pm')
const pmStatePath = (): string => path.join(pmHome(), 'pm.json')
const mcpConfigPath = (): string => path.join(pmHome(), 'pm-mcp.json')

/** How to start the channel helper: Electron's binary in node mode, and the built helper script. */
export interface HelperCommand {
  command: string
  args: string[]
}

export interface PmStart {
  helper: HelperCommand
  brief: string
  agents: string
  model: string
  effort: string
  /** Every stone's folder, so PM can read the projects it looks after. */
  stones: string[]
  /** Start a new conversation instead of resuming the last. */
  fresh?: boolean
}

export type PmWindow = 'open' | 'closed' | 'unknown'

interface PmState {
  sessionId: string
}

async function readState(): Promise<PmState | null> {
  try {
    const raw = JSON.parse(await fsp.readFile(pmStatePath(), 'utf8')) as Partial<PmState>
    return typeof raw.sessionId === 'string' && /^[0-9a-f-]{36}$/.test(raw.sessionId) ? { sessionId: raw.sessionId } : null
  } catch {
    return null
  }
}

/** Does Claude Code still have this session's transcript? Only then can it be resumed. */
async function claudeHasSession(sessionId: string): Promise<boolean> {
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
  const folders = await fsp.readdir(projects).catch(() => [] as string[])
  for (const folder of folders) {
    if (await fsp.stat(path.join(projects, folder, `${sessionId}.jsonl`)).catch(() => null)) return true
  }
  return false
}

/** PM's window, as its process files say. */
export async function pmWindow(): Promise<PmWindow> {
  const state = await readState()
  if (!state) return 'unknown'
  const process = await readRunProcess(state.sessionId)
  return process.state === 'alive' ? 'open' : process.state === 'gone' ? 'closed' : 'unknown'
}

export async function startPm(start: PmStart, open: Opener): Promise<LaunchResult & { resumed?: boolean }> {
  if ((await pmWindow()) === 'open') return { ok: false, error: 'PM is already running in its Terminal window.' }

  await fsp.mkdir(pmFolder(), { recursive: true })
  const note = path.join(pmFolder(), 'README.md')
  if (!(await fsp.stat(note).catch(() => null))) {
    await fsp.writeFile(note, '# PM\n\nAgentic Grove\'s PM works from this folder. It looks after every stone; their folders are added when PM starts.\n')
  }
  const config = { mcpServers: { grove: { command: start.helper.command, args: start.helper.args, env: { ELECTRON_RUN_AS_NODE: '1', AGENTIC_GROVE_HOME: pmHome() } } } }
  await fsp.writeFile(mcpConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 })

  const previous = start.fresh ? null : await readState()
  const resume = previous ? await claudeHasSession(previous.sessionId) : false
  const sessionId = resume && previous ? previous.sessionId : randomUUID()
  if (!resume) await fsp.writeFile(pmStatePath(), JSON.stringify({ sessionId }), { mode: 0o600 })

  const now = Date.now()
  const run: Run = {
    id: sessionId,
    harness: 'claude-code',
    agentId: 'manager',
    agentName: 'PM',
    stoneId: pmFolder(),
    task: '',
    createdAt: now,
    updatedAt: now,
    state: 'starting',
    sessionId: '',
  }
  const result = await launch(
    {
      run,
      folder: pmFolder(),
      brief: start.brief,
      model: start.model,
      effort: start.effort,
      agents: start.agents,
      resume,
      channel: { mcpConfig: mcpConfigPath() },
      permissionMode: 'acceptEdits',
      addDirs: start.stones,
    },
    open
  )
  return result.ok ? { ...result, resumed: resume } : result
}
