/**
 * The preload script: the only way the interface can ask the node side for anything.
 *
 * Everything exposed here lands on `window.grove` in the renderer. Nothing else crosses, and
 * that is the point — the renderer runs page code, page code should never be one typo away from
 * the filesystem. Each addition here is a deliberate widening of that surface, so it is worth
 * being able to read the whole list on one screen.
 *
 * Session one: nothing to expose yet. `version` exists so the bridge itself can be seen working.
 */
import { contextBridge } from 'electron'

const api = {
  version: process.versions.electron,
} as const

contextBridge.exposeInMainWorld('grove', api)

// So the renderer's TypeScript knows `window.grove` exists and what shape it is.
export type GroveApi = typeof api
