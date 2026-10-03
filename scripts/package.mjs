/**
 * Builds "Agentic Grove.app", then either installs it to ~/Applications (`npm run app`) or wraps it
 * in a disk image for a GitHub release (`npm run dmg`).
 *
 * **Why `@electron/packager` now.** The first version of this script copied Electron.app and
 * renamed the folder. The program inside was still called "Electron", and Electron decides whether
 * it is a packaged app from that name, so `app.isPackaged` was false in the Dock app and Settings →
 * Uninstall could not find the app to move to the Trash. Renaming it properly means renaming the
 * main program and its four helper apps consistently, which is exactly what Electron's own packager
 * does. It is a development dependency only; nothing of it ships.
 *
 * **Not signed with a developer certificate** (Adrian's call, 30 September 2026). The app gets an
 * ad-hoc signature, which Apple Silicon needs to run it at all. A downloaded copy therefore needs a
 * one-time "Open Anyway" in System Settings → Privacy & Security; the README says so. Signing and
 * notarising can be added here later without changing anything else.
 *
 * Everything comes from files already on this Mac apart from Electron itself, which the packager
 * downloads once (the same version as `node_modules/electron`) and caches.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'Agentic Grove'
const mode = process.argv.includes('--dmg') ? 'dmg' : 'install'
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const electronVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-grove-package-'))
try {
  console.log('1/5  Building the app code')
  run('npx', ['vite', 'build', '--logLevel', 'warn'])

  console.log('2/5  Cutting the icon from assets/logo.png')
  const png = path.join(work, 'icon.png')
  run('swift', ['scripts/make-icon.swift', 'assets/logo.png', png])
  const iconset = path.join(work, 'AppIcon.iconset')
  fs.mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const px = String(size * scale)
      execFileSync('sips', ['-z', px, px, png, '--out', path.join(iconset, `icon_${size}x${size}${suffix}.png`)], { stdio: 'ignore' })
    }
  }
  const icns = path.join(work, 'AppIcon.icns')
  run('iconutil', ['-c', 'icns', iconset, '-o', icns])

  console.log('3/5  Gathering what the app needs')
  // Only the built code, the menu-bar icon the main process reads from disk, and a package.json
  // that tells Electron where to start. The main process uses nothing but Electron and Node's
  // own modules, so no node_modules are shipped at all.
  const stage = path.join(work, 'stage')
  fs.mkdirSync(stage)
  fs.cpSync(path.join(ROOT, 'dist'), path.join(stage, 'dist'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'dist-electron'), path.join(stage, 'dist-electron'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'assets/tray'), path.join(stage, 'assets/tray'), { recursive: true })
  fs.writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: 'agentic-grove', productName: NAME, version: pkg.version, type: 'module', main: 'dist-electron/main.js', license: pkg.license }, null, 2)
  )

  console.log(`4/5  Packaging ${NAME}.app (Electron ${electronVersion}, Apple Silicon)`)
  const [out] = await packager({
    dir: stage,
    out: path.join(work, 'out'),
    name: NAME,
    platform: 'darwin',
    arch: 'arm64',
    electronVersion,
    icon: icns,
    appBundleId: 'com.adiezc.agentic-grove',
    appVersion: pkg.version,
    appCopyright: `MIT licence. ${pkg.repository?.url ?? ''}`.trim(),
    // Plain files rather than an archive: the tray icon is read with a normal file path.
    asar: false,
    prune: false,
    overwrite: true,
    quiet: true,
  })
  const app = path.join(out, `${NAME}.app`)
  // Electron's "fuses": switches baked into the program itself, so nothing on the Mac can turn
  // them back on. These three would let another program use the Grove's app to run code of its
  // own: as plain Node (`ELECTRON_RUN_AS_NODE`), with injected options (`NODE_OPTIONS`), or with a
  // debugger attached (`--inspect`). The Grove needs none of them. Left as they are on purpose:
  // the asar fuses (the app ships plain files, see `asar: false`) and the file:// privileges the
  // page needs to read its own tree model. Flipped before signing, since it changes the program.
  await flipFuses(app, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  })
  // Ad-hoc: enough for Apple Silicon to run it; not a developer signature. See the header.
  run('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' })

  if (mode === 'install') {
    console.log('5/5  Installing to ~/Applications')
    const dest = path.join(os.homedir(), 'Applications', `${NAME}.app`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.rmSync(dest, { recursive: true, force: true })
    // `ditto` keeps the signature and extended attributes intact, which a plain copy may not.
    run('ditto', [app, dest])
    fs.utimesSync(dest, new Date(), new Date())
    console.log(`Done. Open it with:  open "${dest}"`)
  } else {
    console.log('5/5  Making the disk image')
    // The usual Mac layout: the app beside a shortcut to Applications, to drag across.
    const volume = path.join(work, 'volume')
    fs.mkdirSync(volume)
    run('ditto', [app, path.join(volume, `${NAME}.app`)])
    fs.symlinkSync('/Applications', path.join(volume, 'Applications'))
    const release = path.join(ROOT, 'release')
    fs.mkdirSync(release, { recursive: true })
    const dmg = path.join(release, `Agentic-Grove-${pkg.version}-arm64.dmg`)
    fs.rmSync(dmg, { force: true })
    run('hdiutil', ['create', '-volname', NAME, '-srcfolder', volume, '-format', 'UDZO', '-ov', dmg], { stdio: 'ignore' })
    const mb = (fs.statSync(dmg).size / 1024 / 1024).toFixed(0)
    console.log(`Done. ${path.relative(ROOT, dmg)} (${mb} MB)`)
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
