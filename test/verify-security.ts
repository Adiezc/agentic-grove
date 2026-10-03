/**
 * The window's walls, checked case by case. Run with `npm run verify:security`.
 *
 * The pure rules in `electron/page-rules.ts`, then a few plain checks on the source and the built
 * files, so a later change cannot quietly take a wall down: a handler registered round the sender
 * check, the sandbox switched off, or an inline script in the page. Run `npm run build` first for
 * the checks on built files; without a build they are skipped and say so.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CONTENT_SECURITY_POLICY, isAppLink, isOwnPage } from '../electron/page-rules.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const PAGE = path.join(ROOT, 'dist', 'index.html')
const built = fs.existsSync(PAGE) && fs.existsSync(path.join(ROOT, 'dist-electron', 'preload.mjs'))

const cases: [string, () => void][] = [
  ['only app links reach the system opener', () => {
    for (const ok of ['claude://resume?session=1', 'claude://claude.ai/epitaxy/x', 'codex://threads/1', 'cursor://file/Users/x']) {
      assert.ok(isAppLink(ok), ok)
    }
    for (const bad of ['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'x-apple.systempreferences:', '', 'not a url', 42, null]) {
      assert.ok(!isAppLink(bad), String(bad))
    }
  }],
  ['the built page, and only it, is the Grove page', () => {
    const own = pathToFileURL(PAGE).href
    assert.ok(isOwnPage(own, undefined, PAGE))
    assert.ok(isOwnPage(`${own}#stone`, undefined, PAGE))
    assert.ok(isOwnPage(`${own}?demo`, undefined, PAGE))
    assert.ok(!isOwnPage(pathToFileURL(path.join(ROOT, 'dist', 'other.html')).href, undefined, PAGE))
    assert.ok(!isOwnPage(pathToFileURL(path.join(ROOT, 'README.md')).href, undefined, PAGE))
    assert.ok(!isOwnPage('https://example.com/', undefined, PAGE))
    assert.ok(!isOwnPage(undefined, undefined, PAGE))
    assert.ok(!isOwnPage('', undefined, PAGE))
  }],
  ['in development, the dev server is the Grove page and nothing else is', () => {
    const dev = 'http://localhost:5173/'
    assert.ok(isOwnPage('http://localhost:5173/?demo', dev, PAGE))
    assert.ok(!isOwnPage('http://localhost:5174/', dev, PAGE))
    assert.ok(!isOwnPage('http://evil.localhost:5173/', dev, PAGE))
    assert.ok(!isOwnPage(pathToFileURL(PAGE).href, dev, PAGE))
  }],
  ['the policy allows no outside scripts, no eval and no network from the page', () => {
    const rules = Object.fromEntries(CONTENT_SECURITY_POLICY.split(';').map((rule) => {
      const [name, ...values] = rule.trim().split(/\s+/)
      return [name, values]
    }))
    assert.deepEqual(rules['script-src'], ["'self'"])
    assert.ok(!CONTENT_SECURITY_POLICY.includes('unsafe-eval'))
    assert.ok(!/https?:|\*/.test(CONTENT_SECURITY_POLICY), 'no web addresses or wildcards')
    for (const name of ['object-src', 'frame-src', 'base-uri', 'form-action']) assert.ok(rules[name]?.[0] === "'none'", name)
  }],
  ['the window is sandboxed, isolated and without node', () => {
    const main = read('electron/main.ts')
    for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true']) assert.ok(main.includes(setting), setting)
    assert.ok(main.includes('lockDownPages('), 'navigation and permissions are locked')
  }],
  ['every message handler goes through the sender check', () => {
    const main = read('electron/main.ts')
    // The one direct call is the wrapper itself.
    assert.equal(main.match(/ipcMain\.handle\(/g)?.length, 1)
    assert.equal(main.match(/ipcMain\.on\(/g)?.length ?? 0, 0)
    assert.ok(main.includes('isOwnPage(event.senderFrame?.url'))
  }],
  ['every link handed to the system opener is checked or fixed', () => {
    const main = read('electron/main.ts')
    // Each call names where its link came from; anything new has to be added here on purpose.
    const calls = [...main.matchAll(/shell\.openExternal\(([^)]*)\)/g)].map((match) => match[1])
    const known = ['result.url', 'link', 'RELEASES_PAGE', 'APP_DOWNLOADS[which]', 'TOOL_PAGES[which]']
    for (const call of calls) assert.ok(known.includes(call!), `unreviewed openExternal(${call})`)
    assert.ok(main.includes('if (!isAppLink(result.url))'))
    assert.ok(main.includes('if (!isHttpsUrl(link))'))
  }],
  ['the built page carries the policy and has no inline script', () => {
    if (!built) return console.log('      (skipped: run npm run build first)')
    const html = fs.readFileSync(PAGE, 'utf8')
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'))
    for (const tag of html.match(/<script[^>]*>/g) ?? []) assert.ok(/\ssrc=/.test(tag), `inline script: ${tag}`)
  }],
  ['the preload is plain CommonJS asking only for electron, as a sandboxed preload must', () => {
    if (!built) return console.log('      (skipped: run npm run build first)')
    const preload = read('dist-electron/preload.mjs')
    const required = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
    assert.deepEqual([...new Set(required)], ['electron'])
    assert.ok(!/^\s*import\s/m.test(preload), 'no ES module imports')
  }],
  ['the packaged app has its fuses flipped', () => {
    const script = read('scripts/package.mjs')
    for (const fuse of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) {
      assert.ok(script.includes(`[FuseV1Options.${fuse}]: false`), fuse)
    }
    assert.ok(script.indexOf('flipFuses(') < script.indexOf("'codesign'"), 'fuses are flipped before signing')
  }],
]

let failed = 0
for (const [name, check] of cases) {
  try {
    check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} security checks hold.`)
