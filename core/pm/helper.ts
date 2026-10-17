/**
 * Which program runs PM's channel helper.
 *
 * The helper is a small JavaScript file, so it needs a JavaScript runtime. The Grove's own
 * Electron binary could be one, but the packaged app switches that off on purpose (the
 * `RunAsNode` fuse in `scripts/package.mjs`, from the 3 October security pass): a copy of the
 * Grove that any program could run as Node is a door worth keeping shut. So the helper runs on
 * your own Node.js, 20 or newer (for its built-in `fetch`), found the way Terminal would find it.
 * Running from source, where no fuse is flipped, Electron itself is used when Node is missing.
 *
 * Without either, PM's chat says what to install rather than failing quietly.
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { HelperCommand } from './session.ts'

const NODE_PLACES = ['/opt/homebrew/bin/node', '/usr/local/bin/node', path.join(os.homedir(), '.local', 'bin', 'node'), path.join(os.homedir(), '.volta', 'bin', 'node')]

const MIN_NODE_MAJOR = 20

function nodeMajor(file: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: 4000 }, (error, stdout) => {
      const match = /^v(\d+)\./.exec(String(stdout).trim())
      resolve(!error && match ? Number(match[1]) : 0)
    })
  })
}

function fromLoginShell(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', 'command -v node'], { timeout: 4000 }, (error, stdout) => {
      const found = String(stdout).trim().split('\n').pop() ?? ''
      resolve(!error && path.isAbsolute(found) ? found : null)
    })
  })
}

/** Your Node.js, if it is new enough. */
export async function findNode(): Promise<string | null> {
  const candidates = [...NODE_PLACES]
  const shell = await fromLoginShell()
  if (shell) candidates.unshift(shell)
  for (const file of candidates) {
    if (!(await fsp.stat(file).catch(() => null))) continue
    if ((await nodeMajor(file)) >= MIN_NODE_MAJOR) return file
  }
  return null
}

/**
 * The command for PM's MCP config. `electronBinary` is offered only when running from source.
 * `null` means there is nothing to run the helper with: the chat asks for Node.js.
 */
export async function helperCommand(script: string, electronBinary: string | null): Promise<HelperCommand | null> {
  const node = await findNode()
  if (node) return { command: node, args: [script] }
  if (electronBinary) return { command: electronBinary, args: [script] }
  return null
}
