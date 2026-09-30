/**
 * The one "Get ready" button, checked case by case. Run with `npm run verify:readiness`.
 *
 * The pure rules in `core/readiness.ts`, then the sign-in check and sign-in script in
 * `core/setup.ts` against stand-in `claude` and `codex` programs in a disposable folder. Nothing
 * here runs either real tool or touches your settings.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describeStep, nextSetupStep } from '../core/readiness.ts'
import { askSignedIn, signInScript, type SetupStatus, type ToolPresence } from '../core/setup.ts'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic-grove-verify-ready-it's here-"))

const none: ToolPresence = { cli: false, app: false }
const status = (claude: Partial<ToolPresence>, codex: Partial<ToolPresence> = {}): SetupStatus => ({
  checked: true,
  'claude-code': { ...none, ...claude },
  codex: { ...none, ...codex },
  brew: true,
  npm: true,
})

/** A stand-in program that prints `out` and exits with `code`. */
const standIn = async (name: string, out: string, code = 0) => {
  const file = path.join(dir, name)
  await fsp.writeFile(file, `#!/bin/sh\nprintf '%s\\n' '${out}'\nexit ${code}\n`, { mode: 0o755 })
  return file
}

const cases: [string, () => Promise<void> | void][] = [
  ['nothing on this Mac: install Claude Code, with live updates on the way', () => {
    assert.deepEqual(nextSetupStep(status({}), 'off'), { kind: 'install', tool: 'claude-code', liveUpdates: true })
  }],
  ['installed but signed out: sign in, not install a second copy', () => {
    assert.deepEqual(nextSetupStep(status({ cli: true, signedIn: false }), 'on'), { kind: 'sign-in', tool: 'claude-code', liveUpdates: false })
  }],
  ['signed in with live updates off: one press turns them on', () => {
    assert.equal(nextSetupStep(status({ cli: true, signedIn: true }), 'off').kind, 'live-updates')
    assert.equal(nextSetupStep(status({ cli: true, signedIn: true }), 'outdated').kind, 'live-updates')
  }],
  ['signed in with live updates on: nothing to press', () => {
    assert.equal(nextSetupStep(status({ cli: true, signedIn: true }), 'on').kind, 'ready')
    assert.equal(describeStep({ kind: 'ready' }), null)
  }],
  ['a sign-in that could not be checked counts as fine, so nobody is nagged by a slow answer', () => {
    assert.equal(nextSetupStep(status({ cli: true }), 'on').kind, 'ready')
  }],
  ['Codex alone is enough, and live updates are not asked for (they are Claude Code only)', () => {
    assert.equal(nextSetupStep(status({}, { cli: true, signedIn: true }), 'off').kind, 'ready')
    assert.deepEqual(nextSetupStep(status({}, { cli: true, signedIn: false }), 'off'), { kind: 'sign-in', tool: 'codex', liveUpdates: false })
  }],
  ['an unreadable Claude Code settings file is never offered for writing', () => {
    assert.equal(nextSetupStep(status({ cli: true, signedIn: true }), 'unreadable').kind, 'ready')
    assert.deepEqual(nextSetupStep(status({}), 'unreadable'), { kind: 'install', tool: 'claude-code', liveUpdates: false })
  }],
  ['the line under the button says everything the press will do', () => {
    const line = describeStep({ kind: 'install', tool: 'claude-code', liveUpdates: true })!.line
    assert.match(line, /Installs Claude Code/)
    assert.match(line, /sign in/)
    assert.match(line, /live updates/)
  }],
  ['Claude Code sign-in is read from its JSON answer', async () => {
    assert.equal(await askSignedIn('claude-code', await standIn('claude-in', '{"loggedIn": true, "email": "x"}')), true)
    assert.equal(await askSignedIn('claude-code', await standIn('claude-out', '{"loggedIn": false}', 1)), false)
    assert.equal(await askSignedIn('claude-code', await standIn('claude-odd', 'something else')), undefined)
  }],
  ['Codex sign-in is read from its words', async () => {
    assert.equal(await askSignedIn('codex', await standIn('codex-in', 'Logged in using ChatGPT')), true)
    assert.equal(await askSignedIn('codex', await standIn('codex-out', 'Not logged in', 1)), false)
  }],
  ['the sign-in script runs the found copy by its full path, even with a quote in it', async () => {
    const cli = path.join(dir, 'claude')
    await fsp.writeFile(cli, '#!/bin/sh\necho "signed in: $*"\n', { mode: 0o755 })
    const script = path.join(dir, 'sign-in.command')
    await fsp.writeFile(script, signInScript('claude-code', cli).replace('#!/bin/zsh -l', '#!/bin/zsh').replace('clear', ':'), { mode: 0o700 })
    const out = execFileSync(script, { encoding: 'utf8' })
    assert.match(out, /signed in: auth login/)
    assert.match(out, /Signed in\. You can close this window/)
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    await check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
await fsp.rm(dir, { recursive: true, force: true })
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} readiness rules hold.`)
