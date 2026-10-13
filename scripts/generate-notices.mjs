/**
 * Make readable credits and preserve original licence texts from the actual build inventory.
 * Nothing is fetched from the network. Missing notices stop the build unless an exact-version
 * reviewed record documents the omission; lockfile disagreements always stop the build.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const noticeName = /^(licen[cs]e|copying|notice|ofl)(?:$|[._-])/i

function within(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Attribution paths must be relative')
  const file = path.resolve(root, relative)
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error(`Attribution path escapes its root: ${relative}`)
  return file
}

/** Retain original headers too: some packages vendor other authors' code inside one JS file. */
function sourceNotices(directory, modules) {
  const notices = new Map()
  for (const source of modules) {
    const file = within(directory, source)
    if (!fs.existsSync(file)) throw new Error(`Bundled source disappeared: ${source}`)
    if (!/\.(?:[cm]?[jt]sx?|css|glsl)$/.test(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\/\*[\s\S]*?\*\/|(?:^[\t ]*\/\/[^\n]*(?:\n|$))+/gm)) {
      const header = match[0]
      if (/copyright|@license|SPDX-License-Identifier|licensed under|permission is hereby granted|public domain/i.test(header)) {
        if (!notices.has(header)) notices.set(header, source)
      }
    }
  }
  return [...notices].map(([text, source]) => ({ source, text }))
}

export function generateNotices(root = ROOT) {
  const pkg = readJson(path.join(root, 'package.json'))
  const lock = readJson(path.join(root, 'package-lock.json'))
  const ledger = readJson(path.join(root, 'attribution.json'))
  const packages = new Map()
  for (const target of ['renderer', 'main', 'preload']) {
    const directory = target === 'renderer' ? 'dist' : 'dist-electron'
    const inventory = readJson(path.join(root, directory, `attribution-${target}.json`))
    if (inventory.target !== target || !Array.isArray(inventory.packages)) throw new Error(`Invalid ${target} inventory`)
    for (const entry of inventory.packages) {
      if (!Array.isArray(entry.modules)) throw new Error(`Invalid module inventory for ${entry.name}`)
      const previous = packages.get(entry.directory)
      if (previous && (previous.name !== entry.name || previous.version !== entry.version)) throw new Error(`Conflicting package inventory: ${entry.directory}`)
      packages.set(entry.directory, { ...entry, modules: [...new Set([...(previous?.modules ?? []), ...entry.modules])] })
    }
  }
  const sections = [
    `${pkg.description}\n\nThird-party notices for ${pkg.name} ${pkg.version}\n\nIncludes available original notices and reviewed provenance records for bundled packages,\nthe font and vendored source. Any upstream omissions are documented in their entries.\nElectron's MIT licence and complete Chromium notices accompany this document in the Mac app.\nProjects credited for ideas only are described in CREDITS.txt, not claimed as included code.`,
    `Agentic Grove — ${pkg.license}\n\n${fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')}`,
  ]
  const audit = []
  if (!Array.isArray(ledger.vendored)) throw new Error('The adopted-source ledger is missing')
  for (const entry of ledger.vendored) {
    const text = fs.readFileSync(within(root, entry.notice), 'utf8')
    if (!text.trim()) throw new Error(`Empty upstream notice: ${entry.name}`)
    for (const destination of entry.destinations) {
      if (!fs.existsSync(within(root, destination))) throw new Error(`Missing adapted source: ${destination}`)
    }
    sections.push(`${entry.name} — ${entry.license}\n${entry.url}\n${entry.revisionNote ?? ''}\n\n${text}`)
    audit.push({ name: entry.name, license: entry.license, notices: [entry.notice], kind: 'vendored' })
  }
  for (const entry of [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
    const directory = within(root, entry.directory)
    const manifest = readJson(path.join(directory, 'package.json'))
    const locked = lock.packages?.[entry.directory]
    if (manifest.name !== entry.name || manifest.version !== entry.version || locked?.version !== entry.version) {
      throw new Error(`Bundled package disagrees with package-lock.json: ${entry.name}@${entry.version}`)
    }
    const files = fs.readdirSync(directory).filter((name) => noticeName.test(name) && fs.statSync(path.join(directory, name)).isFile()).sort()
    const reviewed = ledger.packageNotices?.[`${entry.name}@${entry.version}`]
    if (!files.some((name) => /^(licen[cs]e|copying|ofl)(?:$|[._-])/i.test(name)) && !reviewed) throw new Error(`No full licence text found for bundled package ${entry.name}`)
    const texts = files.map((name) => {
      const text = fs.readFileSync(path.join(directory, name), 'utf8')
      if (!text.trim()) throw new Error(`Empty notice in ${entry.name}: ${name}`)
      return `${name}\n\n${text}`
    })
    if (reviewed) {
      const text = fs.readFileSync(within(root, reviewed.notice), 'utf8')
      if (!text.trim()) throw new Error(`Empty reviewed notice: ${entry.name}`)
      texts.push(`${reviewed.note}\n${reviewed.url}\n\n${text}`)
    }
    for (const header of sourceNotices(directory, entry.modules)) texts.push(`Original source notice (${header.source})\n\n${header.text}`)
    const origin = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
    const licenceNote = ledger.packageLicenceNotes?.[`${entry.name}@${entry.version}`]
    sections.push(`${entry.name} ${entry.version} — declared ${manifest.license ?? 'See original text'}\n${origin ?? manifest.homepage ?? ''}\n${licenceNote ?? ''}\n\n${texts.join('\n\n')}`)
    audit.push({ name: entry.name, version: entry.version, license: manifest.license, notices: [...files, ...(reviewed ? [reviewed.notice] : [])], reviewNote: reviewed?.note ?? licenceNote, kind: 'bundled' })
  }
  // Electron is an external built-in import, so it does not appear in Rollup's module list.
  // Its MIT notice is supplied even in CI where the native executable download is skipped.
  const electron = readJson(path.join(root, 'node_modules/electron/package.json'))
  if (electron.version !== lock.packages?.['node_modules/electron']?.version) throw new Error('Electron disagrees with the lockfile')
  const electronLicence = fs.readFileSync(path.join(root, 'node_modules/electron/LICENSE'), 'utf8')
  if (!electronLicence.trim()) throw new Error('Empty Electron licence')
  sections.push(`Electron ${electron.version} — MIT\nhttps://github.com/electron/electron\n\n${electronLicence}`)
  audit.push({ name: 'electron', version: electron.version, license: 'MIT', notices: ['ELECTRON_LICENSE.txt', 'LICENSES.chromium.html (added during Mac packaging)'], kind: 'runtime' })
  const output = path.join(root, 'dist', 'attribution')
  fs.mkdirSync(output, { recursive: true })
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE.txt'))
  fs.copyFileSync(path.join(root, 'CREDITS.md'), path.join(output, 'CREDITS.txt'))
  fs.writeFileSync(path.join(output, 'ELECTRON_LICENSE.txt'), electronLicence)
  fs.writeFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n\n' + '='.repeat(80) + '\n\n') + '\n')
  fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(audit, null, 2) + '\n')
  return audit
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = generateNotices()
  console.log(`Attribution: ${audit.length} source/package entries, original notices and reviewed records written to dist/attribution`)
}
