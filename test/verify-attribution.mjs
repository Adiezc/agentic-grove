/** Licence loss and version drift must stop a distribution, using temporary fixtures only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateNotices } from '../scripts/generate-notices.mjs'
import { verifyPackagedNotices } from '../scripts/verify-packaged-notices.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-attribution-test-'))
let passed = 0
const write = (root, name, value) => {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
}
function fixture(name) {
  const root = path.join(work, name)
  write(root, 'package.json', { name: 'fixture', version: '1.0.0', license: 'MIT', description: 'Fixture Grove' })
  write(root, 'package-lock.json', { packages: { 'node_modules/example': { version: '1.2.3' }, 'node_modules/electron': { version: '44.3.0' } } })
  write(root, 'LICENSE', 'Grove original licence\n')
  write(root, 'CREDITS.md', 'Human credits: original authors.\n')
  write(root, 'attribution.json', { vendored: [{ name: 'upstream/source', url: 'https://example.org/source', license: 'MIT', notice: 'licenses/upstream.txt', destinations: ['core/adapted.ts'] }] })
  write(root, 'licenses/upstream.txt', 'Original upstream copyright and grant\n')
  write(root, 'core/adapted.ts', '// adapted source\n')
  write(root, 'node_modules/example/package.json', { name: 'example', version: '1.2.3', license: 'MIT' })
  write(root, 'node_modules/example/LICENSE', 'Original package copyright and grant\n')
  write(root, 'node_modules/example/NOTICE', 'Original NOTICE acknowledgement\n')
  write(root, 'node_modules/example/index.js', '/* Copyright nested author. Permission is hereby granted, preserving this header. */\n/* This code was placed in the public domain by its original author, Named Author. */\nexport const x = 1;\n')
  write(root, 'node_modules/electron/package.json', { name: 'electron', version: '44.3.0' })
  write(root, 'node_modules/electron/LICENSE', 'Electron original licence\n')
  write(root, 'node_modules/electron/dist/LICENSES.chromium.html', '<html>Chromium original notices</html>')
  for (const target of ['renderer', 'main', 'preload']) {
    write(root, `${target === 'renderer' ? 'dist' : 'dist-electron'}/attribution-${target}.json`, {
      target, packages: target === 'renderer' ? [{ name: 'example', version: '1.2.3', directory: 'node_modules/example', modules: ['index.js'] }] : [],
    })
  }
  return root
}
function check(name, test) {
  test()
  passed++
  console.log(`✓ ${name}`)
}
try {
  check('preserves human credits, full upstream grants, NOTICE and embedded authors', () => {
    const root = fixture('complete')
    const audit = generateNotices(root)
    const text = fs.readFileSync(path.join(root, 'dist/attribution/THIRD_PARTY_NOTICES.txt'), 'utf8')
    for (const expected of ['Original upstream copyright and grant', 'Original package copyright and grant', 'Original NOTICE acknowledgement', 'Copyright nested author', 'public domain by its original author, Named Author', 'Electron original licence']) assert.ok(text.includes(expected), expected)
    assert.equal(audit.length, 3)
    assert.equal(fs.readFileSync(path.join(root, 'dist/attribution/CREDITS.txt'), 'utf8'), fs.readFileSync(path.join(root, 'CREDITS.md'), 'utf8'))
  })
  check('missing package licence stops generation even if NOTICE exists', () => {
    const root = fixture('missing-licence')
    fs.unlinkSync(path.join(root, 'node_modules/example/LICENSE'))
    assert.throws(() => generateNotices(root), /No full licence text/)
  })
  check('empty licence cannot silently pass', () => {
    const root = fixture('empty-licence')
    write(root, 'node_modules/example/LICENSE', ' \n')
    assert.throws(() => generateNotices(root), /Empty notice/)
  })
  check('a stale build or installation cannot borrow another lockfile version', () => {
    const root = fixture('stale-version')
    write(root, 'node_modules/example/package.json', { name: 'example', version: '2.0.0', license: 'MIT' })
    assert.throws(() => generateNotices(root), /disagrees with package-lock/)
  })
  check('reviewed omitted notice is version-specific and original text is retained', () => {
    const root = fixture('reviewed')
    fs.unlinkSync(path.join(root, 'node_modules/example/LICENSE'))
    const ledger = JSON.parse(fs.readFileSync(path.join(root, 'attribution.json')))
    ledger.packageNotices = { 'example@1.2.3': { notice: 'licenses/exact-release.txt', url: 'https://example.org/exact-release/LICENSE', note: 'Recovered from exact release.' } }
    write(root, 'licenses/exact-release.txt', 'Exact release original licence\n')
    write(root, 'attribution.json', ledger)
    generateNotices(root)
    assert.ok(fs.readFileSync(path.join(root, 'dist/attribution/THIRD_PARTY_NOTICES.txt'), 'utf8').includes('Exact release original licence'))
    ledger.packageNotices = { 'example@1.2.2': ledger.packageNotices['example@1.2.3'] }
    write(root, 'attribution.json', ledger)
    assert.throws(() => generateNotices(root), /No full licence text/)
  })
  check('missing vendored source and licence stop the distribution', () => {
    const root = fixture('missing-vendored')
    fs.unlinkSync(path.join(root, 'core/adapted.ts'))
    assert.throws(() => generateNotices(root), /Missing adapted source/)
    write(root, 'core/adapted.ts', '// source')
    fs.unlinkSync(path.join(root, 'licenses/upstream.txt'))
    assert.throws(() => generateNotices(root), /ENOENT/)
  })
  check('module paths cannot read outside their package', () => {
    const root = fixture('escaping-module')
    write(root, 'dist/attribution-renderer.json', { target: 'renderer', packages: [{ name: 'example', version: '1.2.3', directory: 'node_modules/example', modules: ['../../LICENSE'] }] })
    assert.throws(() => generateNotices(root), /escapes its root/)
  })
  check('the final app check catches lost or altered notices, including Chromium', () => {
    const root = fixture('packaged')
    generateNotices(root)
    const app = path.join(root, 'Review.app')
    const output = path.join(app, 'Contents/Resources/app/dist/attribution')
    fs.cpSync(path.join(root, 'dist/attribution'), output, { recursive: true })
    fs.copyFileSync(path.join(root, 'node_modules/electron/dist/LICENSES.chromium.html'), path.join(output, 'LICENSES.chromium.html'))
    assert.equal(verifyPackagedNotices(root, app), output)
    fs.unlinkSync(path.join(output, 'CREDITS.txt'))
    assert.throws(() => verifyPackagedNotices(root, app), /ENOENT/)
    fs.copyFileSync(path.join(root, 'dist/attribution/CREDITS.txt'), path.join(output, 'CREDITS.txt'))
    fs.appendFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), 'changed')
    assert.throws(() => verifyPackagedNotices(root, app), /Packaged attribution differs/)
    fs.copyFileSync(path.join(root, 'dist/attribution/THIRD_PARTY_NOTICES.txt'), path.join(output, 'THIRD_PARTY_NOTICES.txt'))
    fs.writeFileSync(path.join(output, 'LICENSES.chromium.html'), '<html>incomplete</html>')
    assert.throws(() => verifyPackagedNotices(root, app), /Packaged Chromium notices differ/)
  })
  check('current production bundle carries the adopted source, font and nested notices', () => {
    const audit = generateNotices(ROOT)
    for (const name of ['Station-Sciences/bot-crossing', '@fontsource-variable/geist', '@phosphor-icons/react', '@react-three/fiber', 'three', 'electron']) assert.ok(audit.some((entry) => entry.name === name), name)
    const text = fs.readFileSync(path.join(ROOT, 'dist/attribution/THIRD_PARTY_NOTICES.txt'), 'utf8')
    for (const expected of ['Jarren Rocks', 'SIL OPEN FONT LICENSE', 'Max Kaufmann', 'Stefan Gustavson', 'CC0 1.0 Universal', 'metadata']) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes(os.homedir()), 'Do not ship local user paths')
  })
  console.log(`\n${passed} attribution checks passed.`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
