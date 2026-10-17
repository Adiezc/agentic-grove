/**
 * What a worker is started with to join the team: an MCP config for its team tools and a settings
 * file with its two hooks. Both are for that one run only (`--mcp-config`, `--settings`), so your
 * own Claude Code settings are never changed. Written under the Grove's home, readable by you only.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { TEAM_RUN_ENV, pmHome } from '../pm/protocol.ts'
import type { HelperCommand } from '../pm/session.ts'

const teamFolder = (): string => path.join(pmHome(), 'team')

/** Quote for the shell Claude Code runs hook commands in. Only ever paths this side chose. */
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export interface TeamFiles {
  mcpConfig: string
  settings: string
}

export async function writeTeamFiles(runId: string, helper: HelperCommand): Promise<TeamFiles> {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error('Not a run id')
  await fsp.mkdir(teamFolder(), { recursive: true, mode: 0o700 })
  const home = pmHome()
  const mcp = {
    mcpServers: { grove: { command: helper.command, args: helper.args, env: { ELECTRON_RUN_AS_NODE: '1', AGENTIC_GROVE_HOME: home, [TEAM_RUN_ENV]: runId } } },
  }
  const hook = (kind: 'post' | 'stop') =>
    `AGENTIC_GROVE_HOME=${quote(home)} ELECTRON_RUN_AS_NODE=1 ${[helper.command, ...helper.args].map(quote).join(' ')} --hook ${kind}`
  const settings = {
    hooks: {
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: hook('post'), timeout: 5 }] }],
      Stop: [{ hooks: [{ type: 'command', command: hook('stop'), timeout: 5 }] }],
    },
  }
  const files = { mcpConfig: path.join(teamFolder(), `${runId}-mcp.json`), settings: path.join(teamFolder(), `${runId}-settings.json`) }
  await fsp.writeFile(files.mcpConfig, JSON.stringify(mcp, null, 2), { mode: 0o600 })
  await fsp.writeFile(files.settings, JSON.stringify(settings, null, 2), { mode: 0o600 })
  return files
}

/** Told to every worker on the team, after its own brief. */
export const TEAM_BRIEF =
  'You are on an Agentic Grove team with PM and other agents. If you are blocked on something only PM or a teammate knows or can decide, ask with the grove ask_agent tool and wait for the answer; tell them findings they need with tell_agent. Messages from teammates reach you as "Message from your Agentic Grove team": answer a question with answer_agent, passing its id. Keep it short, and do not ask what you can find out yourself.'
