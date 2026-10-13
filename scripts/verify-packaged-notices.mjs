/** Verify the app we actually distribute, not just the staging directory. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export function verifyPackagedNotices(root, appPath) {
  const output = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'attribution')
  for (const name of ['LICENSE.txt', 'CREDITS.txt', 'THIRD_PARTY_NOTICES.txt', 'inventory.json', 'ELECTRON_LICENSE.txt']) {
    const original = fs.readFileSync(path.join(root, 'dist', 'attribution', name))
    assert.ok(original.length > 0, `Empty attribution file: ${name}`)
    assert.ok(original.equals(fs.readFileSync(path.join(output, name))), `Packaged attribution differs: ${name}`)
  }
  const chromium = fs.readFileSync(path.join(root, 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'))
  assert.ok(chromium.length > 0, 'Empty Chromium notices')
  assert.ok(chromium.equals(fs.readFileSync(path.join(output, 'LICENSES.chromium.html'))), 'Packaged Chromium notices differ')
  return output
}
