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
 * **What is checked, and what is not.** Whether each program or app exists, and whether each tool
 * says it is signed in. That second answer comes from asking the tool itself (`claude auth status`,
 * `codex login status`) and only its yes or no is kept. The Grove never reads either tool's
 * sign-in files, and never keeps the account name the answer includes.
 *
 * **Find first, install last** (Adrian, 30 September 2026). The desktop apps carry their own copy
 * of each tool: Claude.app keeps Claude Code under Application Support, and ChatGPT.app ships Codex
 * inside itself. The first version only looked in the standard install folders, missed those, and
 * offered to install a second copy. Now each tool is looked for in three places, in order, and the
 * install button only appears when all three come up empty:
 *
 *   1. The standard install folders (the official installer, Homebrew, npm).
 *   2. Wherever your own Terminal would find it (`command -v` in a login shell), for installs in
 *      places nobody could list in advance.
 *   3. The copy inside the maker's desktop app.
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type SetupTool = 'claude-code' | 'codex'

/** Where a tool's command was found. See the header for the order they are tried in. */
export type ToolSource = 'installed' | 'shell' | 'app'

export interface ToolPresence {
  /** The command-line program, which is what the Grove can run agents through. */
  cli: boolean
  /** Where it was found, when it was. */
  source?: ToolSource
  /** The maker's desktop app (Claude.app, ChatGPT.app). Watchable and openable, not drivable. */
  app: boolean
  /** Whether the tool says it is signed in. Absent when it is not installed or did not answer. */
  signedIn?: boolean
}

export interface SetupStatus {
  /** False until the first look has finished, so nothing is offered on a guess. */
  checked: boolean
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
/** A file this user may run. */
const runnable = (file: string) =>
  fsp.access(file, fsp.constants.X_OK).then(
    () => true,
    () => false
  )

/** "2.1.284" above "2.1.281" and "2.1.9". Anything unreadable sorts last. */
function newestFirst(a: string, b: string): number {
  const parts = (text: string) => text.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

/**
 * The copy inside the maker's desktop app. Claude.app keeps one folder per Claude Code version and
 * clears out old ones itself, so the newest is taken; ChatGPT.app has one copy inside its bundle.
 */
async function appCopy(tool: SetupTool): Promise<string | null> {
  if (tool === 'claude-code') {
    const root = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code')
    const versions = await fsp.readdir(root).catch(() => [] as string[])
    for (const version of versions.filter((name) => /^\d+(\.\d+)*$/.test(name)).sort(newestFirst)) {
      const file = path.join(root, version, 'claude.app', 'Contents', 'MacOS', 'claude')
      if (await runnable(file)) return file
    }
    return null
  }
  for (const app of APP_PLACES.codex) {
    const file = path.join(app, 'Contents', 'Resources', 'codex-cli', 'bin', 'codex')
    if (await runnable(file)) return file
  }
  return null
}

/**
 * Where your own Terminal would find the tool: `command -v` in a login shell, so your PATH from
 * `.zprofile` and `.zshrc` counts. The name asked about is one of two fixed words, never text from
 * anywhere else. Given a few seconds; a shell that takes longer is skipped, not waited on.
 */
function shellLookup(tool: SetupTool): Promise<string | null> {
  const name = tool === 'claude-code' ? 'claude' : 'codex'
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', `command -v ${name}`], { timeout: 4000 }, async (error, stdout) => {
      const found = String(stdout).trim().split('\n').pop() ?? ''
      resolve(!error && path.isAbsolute(found) && (await runnable(found)) ? found : null)
    })
  })
}

/**
 * Where the tool's command is, and how it was found, or `null` if it is nowhere on this Mac. Always
 * an absolute path, which the Grove's launch scripts run directly.
 */
export async function findCli(tool: SetupTool): Promise<{ path: string; source: ToolSource } | null> {
  for (const file of CLI_PLACES[tool]) if (await runnable(file)) return { path: file, source: 'installed' }
  const fromShell = await shellLookup(tool)
  if (fromShell) return { path: fromShell, source: 'shell' }
  const bundled = await appCopy(tool)
  return bundled ? { path: bundled, source: 'app' } : null
}

/** Just the path. What the launcher runs. */
export async function cliPath(tool: SetupTool): Promise<string | null> {
  return (await findCli(tool))?.path ?? null
}

/**
 * Ask the tool whether it is signed in. Claude Code answers in JSON (`loggedIn`); Codex answers in
 * words and with its exit code. Only the yes or no leaves this function; the answer's account
 * details are dropped here. `undefined` when the tool did not answer in time or in a way we know.
 */
export function askSignedIn(tool: SetupTool, cli: string): Promise<boolean | undefined> {
  const args = tool === 'claude-code' ? ['auth', 'status', '--json'] : ['login', 'status']
  return new Promise((resolve) => {
    execFile(cli, args, { timeout: 8000 }, (error, stdout, stderr) => {
      const text = `${String(stdout)}\n${String(stderr)}`
      if (tool === 'claude-code') {
        try {
          const answer = JSON.parse(String(stdout)) as { loggedIn?: unknown }
          resolve(typeof answer.loggedIn === 'boolean' ? answer.loggedIn : undefined)
        } catch {
          resolve(undefined)
        }
        return
      }
      if (/not logged in/i.test(text)) resolve(false)
      else if (!error && /logged in/i.test(text)) resolve(true)
      else resolve(error && typeof error.code === 'number' ? false : undefined)
    })
  })
}

export async function setupStatus(): Promise<SetupStatus> {
  const [claudeCli, claudeApp, codexCli, codexApp, brew, npm] = await Promise.all([
    findCli('claude-code'),
    anyExists(APP_PLACES['claude-code']),
    findCli('codex'),
    anyExists(APP_PLACES.codex),
    anyExists(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']),
    anyExists(['/opt/homebrew/bin/npm', '/usr/local/bin/npm']),
  ])
  const [claudeIn, codexIn] = await Promise.all([
    claudeCli ? askSignedIn('claude-code', claudeCli.path) : undefined,
    codexCli ? askSignedIn('codex', codexCli.path) : undefined,
  ])
  return {
    checked: true,
    'claude-code': { cli: Boolean(claudeCli), source: claudeCli?.source, app: claudeApp, signedIn: claudeIn },
    codex: { cli: Boolean(codexCli), source: codexCli?.source, app: codexApp, signedIn: codexIn },
    brew,
    npm,
  }
}

/** A path as one word for zsh, whatever it contains. */
const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/**
 * The script for signing in to a tool that is already here, wherever it was found (it may be the
 * copy inside a desktop app, which is not on your PATH, hence the full path).
 */
export function signInScript(tool: SetupTool, cli: string): string {
  const name = tool === 'claude-code' ? 'Claude Code' : 'Codex'
  const account = tool === 'claude-code' ? 'Claude' : 'ChatGPT'
  return [
    '#!/bin/zsh -l',
    'clear',
    'echo "Agentic Grove setup"',
    'echo ""',
    `echo "${name} is installed. Sign in with your ${account} account; your browser will open."`,
    'echo ""',
    `${quoted(cli)} ${tool === 'claude-code' ? 'auth login' : 'login'} || exit 1`,
    'echo ""',
    'echo "Signed in. You can close this window and go back to the Grove."',
  ].join('\n') + '\n'
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
  // A login shell, and a last look before installing anything: if the tool turned up since the
  // Grove last checked, say where and stop, rather than install a second copy.
  const name = tool === 'claude-code' ? 'claude' : 'codex'
  const lines = [
    '#!/bin/zsh -l',
    'clear',
    'echo "Agentic Grove setup"',
    'echo ""',
    `if command -v ${name} >/dev/null 2>&1; then`,
    `  echo "${tool === 'claude-code' ? 'Claude Code' : 'Codex'} is already installed at $(command -v ${name}). Nothing to install."`,
    '  echo "You can close this window."',
    '  exit 0',
    'fi',
  ]
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
