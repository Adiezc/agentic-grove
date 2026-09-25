import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Blender authors, bakes, renders and exports the same asset that Grove loads.
// Keep the previous procedural generator in build-world-tree-legacy.mjs for comparison.
const installedMacBlender = '/Applications/Blender.app/Contents/MacOS/Blender'
const blender = process.env.BLENDER_BIN || (existsSync(installedMacBlender) ? installedMacBlender : 'blender')
const source = fileURLToPath(new URL('./build-world-tree-blender.py', import.meta.url))
const result = spawnSync(blender, ['--background', '--python-exit-code', '1', '--python', source], {
  stdio: 'inherit',
  env: process.env,
})
if (result.error) {
  console.error(`Could not run Blender. Install it or set BLENDER_BIN. ${result.error.message}`)
}
process.exit(result.status ?? 1)
