/**
 * First-run setup: which AI tools are on this Mac, and a one-button way to add the missing ones.
 *
 * **Who this is for.** Most people who download the Grove from GitHub already have Claude Code or
 * Codex. The few who do not should not need to know what a terminal is to get going, so each tool
 * gets one button that does the whole job.
 *
 * **Why the button opens Terminal rather than installing silently.** Both tools install with their
 * makers' own official commands, and both finish by asking you to sign in, which happens in your
 * browser and needs you. Running that inside a visible Terminal window means you see exactly what
 * runs, you can stop it, and the sign-in prompt has somewhere to appear. Installing behind your back
 * would be quicker to click and worse in every way that matters.
 *
 * **What is checked, and what is not.** Only whether each program or app exists at its usual
 * places. The Grove never reads either tool's sign-in details.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type SetupTool = 'claude-code' | 'codex'

export interface ToolPresence {
  /** The command-line program, which is what the Grove can run agents through. */
  cli: boolean
  /** The maker's desktop app (Claude.app, ChatGPT.app). Watchable and openable, not drivable. */
  app: boolean
}

export interface SetupStatus {
  'claude-code': ToolPresence
  codex: ToolPresence
  /** Package managers the Codex install can use, best first. */
  brew: boolean
  npm: boolean
}

const home = os.homedir()

/** Where each program usually lands, by installer. The first that exists wins. */
const CLI_PLACES: Record<SetupTool, string[]> = {
  'claude-code': [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ],
  codex: [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(home, '.npm-global', 'bin', 'codex'),
    path.join(home, '.local', 'bin', 'codex'),
  ],
}

const APP_PLACES: Record<SetupTool, string[]> = {
  'claude-code': ['/Applications/Claude.app', path.join(home, 'Applications', 'Claude.app')],
  codex: ['/Applications/ChatGPT.app', path.join(home, 'Applications', 'ChatGPT.app'), '/Applications/Codex.app'],
}

const exists = (file: string) =>
  fsp.access(file).then(
    () => true,
    () => false
  )
const anyExists = async (files: string[]) => (await Promise.all(files.map(exists))).some(Boolean)

/**
 * Where the tool's command is, or `null` if it is not installed. An absolute path from the list
 * above, never a name looked up on `PATH`: the Grove's launch scripts run it directly, and a path
 * it found itself cannot be swapped for something else by whatever happens to be first on `PATH`.
 */
export async function cliPath(tool: SetupTool): Promise<string | null> {
  for (const file of CLI_PLACES[tool]) if (await exists(file)) return file
  return null
}

export async function setupStatus(): Promise<SetupStatus> {
  const [claudeCli, claudeApp, codexCli, codexApp, brew, npm] = await Promise.all([
    anyExists(CLI_PLACES['claude-code']),
    anyExists(APP_PLACES['claude-code']),
    anyExists(CLI_PLACES.codex),
    anyExists(APP_PLACES.codex),
    anyExists(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']),
    anyExists(['/opt/homebrew/bin/npm', '/usr/local/bin/npm']),
  ])
  return {
    'claude-code': { cli: claudeCli, app: claudeApp },
    codex: { cli: codexCli, app: codexApp },
    brew,
    npm,
  }
}

/**
 * The script the one button runs in Terminal. Each line says what it is about to do, in words, so
 * the window reads as instructions rather than noise. Returns `null` when there is no way to install
 * on this Mac without a package manager, in which case the interface opens the tool's own page.
 *
 * The install commands are each maker's published ones (checked 30 September 2026). If a maker
 * changes theirs, this is the one place to update.
 */
export function setupScript(tool: SetupTool, status: SetupStatus): string | null {
  const lines = ['#!/bin/zsh', 'clear', 'echo "Agentic Grove setup"', 'echo ""']
  if (tool === 'claude-code') {
    lines.push(
      'echo "Installing Claude Code with Anthropic\'s official installer..."',
      'curl -fsSL https://claude.ai/install.sh | bash || exit 1',
      'export PATH="$HOME/.local/bin:$PATH"',
      'echo ""',
      'echo "Done. Claude Code will now ask you to sign in with your Claude account in the browser."',
      'echo "When it has, you can close this window and go back to the Grove."',
      'echo ""',
      'claude'
    )
    return lines.join('\n') + '\n'
  }
  if (status.brew) {
    lines.push('echo "Installing Codex with Homebrew..."', 'brew install codex || exit 1')
  } else if (status.npm) {
    lines.push('echo "Installing Codex with npm..."', 'npm install -g @openai/codex || exit 1')
  } else {
    return null
  }
  lines.push(
    'echo ""',
    'echo "Done. Codex will now ask you to sign in with your ChatGPT account in the browser."',
    'echo "When it has, you can close this window and go back to the Grove."',
    'echo ""',
    'codex login'
  )
  return lines.join('\n') + '\n'
}

/** Where to send someone who has no package manager, or wants to read first. */
export const TOOL_PAGES: Record<SetupTool, string> = {
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code/overview',
  codex: 'https://github.com/openai/codex',
}

/**
 * The makers' desktop apps. Most people run Claude Code and Codex from these rather than a terminal,
 * and the everyday coworkers (Cowork, Dots) live in them. There is no official one-line installer
 * for either, so the button opens each maker's own download page.
 */
export type DesktopApp = 'claude' | 'chatgpt'
export const APP_DOWNLOADS: Record<DesktopApp, string> = {
  claude: 'https://claude.ai/download',
  chatgpt: 'https://openai.com/chatgpt/download/',
}
