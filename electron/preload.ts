/**
 * The preload script: the only way the interface can ask the node side for anything.
 *
 * Everything exposed here lands on `window.grove` in the renderer, and nothing else crosses.
 * That is the point — the renderer runs page code, and page code should never be one typo away
 * from the filesystem. The contract, and the reasoning about how wide this surface should get,
 * is in `bridge.ts`.
 *
 * Note what is *not* passed through: the raw `ipcRenderer`. Handing that over would expose every
 * channel in the app, including ones added later by somebody who had not thought about it, which
 * defeats having a bridge at all. Each function below names its own channel.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type GroveApi, type GroveSnapshot } from './bridge.ts'

const api: GroveApi = {
  version: process.versions.electron,

  onSnapshot(listener) {
    // The Electron event object is dropped rather than forwarded: it carries a reference to the
    // sender, and handing the renderer anything that can send on arbitrary channels would undo
    // the isolation this file exists for.
    const handler = (_event: unknown, snapshot: GroveSnapshot) => listener(snapshot)
    ipcRenderer.on(CHANNELS.snapshot, handler)
    // React unmounts and remounts components freely, and in StrictMode it does so twice on
    // purpose. Without this the listener count would climb quietly until the snapshot was being
    // handled a dozen times a tick.
    return () => {
      ipcRenderer.removeListener(CHANNELS.snapshot, handler)
    }
  },

  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  openSession: (harness, ref) => ipcRenderer.invoke(CHANNELS.openSession, harness, ref),
  revealGroveFile: () => ipcRenderer.invoke(CHANNELS.revealGroveFile),
  captureStill: () => ipcRenderer.invoke(CHANNELS.captureStill),
  connectSuggested: (folder) => ipcRenderer.invoke(CHANNELS.connectSuggested, folder),
  browseProject: () => ipcRenderer.invoke(CHANNELS.browseProject),
  createProject: () => ipcRenderer.invoke(CHANNELS.createProject),
  addAgent: (draft) => ipcRenderer.invoke(CHANNELS.addAgent, draft),
  removeProject: (stoneId) => ipcRenderer.invoke(CHANNELS.removeProject, stoneId),
  removeAgent: (id) => ipcRenderer.invoke(CHANNELS.removeAgent, id),
  openAgentLink: (id) => ipcRenderer.invoke(CHANNELS.openAgentLink, id),
  planHooks: (action) => ipcRenderer.invoke(CHANNELS.planHooks, action),
  applyHooks: (action, baseline) => ipcRenderer.invoke(CHANNELS.applyHooks, action, baseline),
}

contextBridge.exposeInMainWorld('grove', api)
