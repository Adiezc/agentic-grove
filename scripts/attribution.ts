/**
 * Record the packages whose modules or assets reach each production bundle. A dependency list
 * alone misses bundled development packages and includes libraries which were never shipped.
 * The notice generator reads this inventory after all three builds have finished.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export function attributionInventory(root: string, target: 'renderer' | 'main' | 'preload'): Plugin {
  root = path.resolve(root)
  return {
    name: `grove-attribution-${target}`,
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Map<string, { directory: string; name: string; version: string; modules: string[] }>()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) {
          const file = id.replace(/^\0/, '').split('?')[0]!
          if (!path.isAbsolute(file) || !file.includes(`${path.sep}node_modules${path.sep}`)) continue
          // A package can contain smaller package.json files for ESM/CJS boundaries. Walk until
          // we find the real named package rather than treating that boundary as a dependency.
          let directory = path.dirname(file)
          while (directory !== root && directory !== path.dirname(directory)) {
            const manifest = path.join(directory, 'package.json')
            if (fs.existsSync(manifest)) {
              const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string; version?: string }
              if (pkg.name && pkg.version) {
                const relative = path.relative(root, directory).split(path.sep).join('/')
                if (relative.startsWith('../')) throw new Error(`Bundled package is outside the project: ${pkg.name}`)
                const entry = packages.get(relative) ?? { directory: relative, name: pkg.name, version: pkg.version, modules: [] }
                const source = path.relative(directory, file).split(path.sep).join('/')
                if (!entry.modules.includes(source)) entry.modules.push(source)
                packages.set(relative, entry)
                break
              }
            }
            directory = path.dirname(directory)
          }
        }
      }
      const entries = [...packages.values()].sort((a, b) => a.directory.localeCompare(b.directory, 'en'))
      for (const entry of entries) entry.modules.sort()
      this.emitFile({ type: 'asset', fileName: `attribution-${target}.json`, source: JSON.stringify({ target, packages: entries }, null, 2) + '\n' })
    },
  }
}
