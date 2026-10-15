import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
if (result.status !== 0) process.exit(result.status ?? 1)

// Blender's exporter writes every vertex value as a 32-bit float; this halves most of them.
// TREE_EXPORT_DIR is the Blender script's own override for where the model goes.
const exportDir = process.env.TREE_EXPORT_DIR || fileURLToPath(new URL('../assets/models/', import.meta.url))
const model = join(exportDir, 'world-tree-blender.glb')
const shrink = spawnSync(process.execPath, [fileURLToPath(new URL('./quantize-tree-model.mjs', import.meta.url)), model], { stdio: 'inherit' })
process.exit(shrink.status ?? 1)
