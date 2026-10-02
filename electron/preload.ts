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
import { contextBridge, ipcRenderer, webUtils } from 'electron'
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

  onFocusRun(listener) {
    // As with snapshots, the event object is dropped: only the run id crosses.
    const handler = (_event: unknown, runId: string) => listener(runId)
    ipcRenderer.on(CHANNELS.focusRun, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.focusRun, handler)
    }
  },

  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  openSession: (harness, ref) => ipcRenderer.invoke(CHANNELS.openSession, harness, ref),
  revealGroveFile: () => ipcRenderer.invoke(CHANNELS.revealGroveFile),
  captureStill: () => ipcRenderer.invoke(CHANNELS.captureStill),
  connectSuggested: (folder, place) => ipcRenderer.invoke(CHANNELS.connectSuggested, folder, place),
  browseProject: (place) => ipcRenderer.invoke(CHANNELS.browseProject, place),
  createProject: (place) => ipcRenderer.invoke(CHANNELS.createProject, place),
  addAgent: (draft) => ipcRenderer.invoke(CHANNELS.addAgent, draft),
  removeProject: (stoneId) => ipcRenderer.invoke(CHANNELS.removeProject, stoneId),
  removeAgent: (id) => ipcRenderer.invoke(CHANNELS.removeAgent, id),
  openAgentLink: (id) => ipcRenderer.invoke(CHANNELS.openAgentLink, id),
  planHooks: (action) => ipcRenderer.invoke(CHANNELS.planHooks, action),
  applyHooks: (action, baseline) => ipcRenderer.invoke(CHANNELS.applyHooks, action, baseline),
  openProjectFolder: (stoneId) => ipcRenderer.invoke(CHANNELS.openProjectFolder, stoneId),
  saveSettings: (patch) => ipcRenderer.invoke(CHANNELS.saveSettings, patch),
  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
  checkClaudeLimits: () => ipcRenderer.invoke(CHANNELS.checkClaudeLimits),
  openRelease: () => ipcRenderer.invoke(CHANNELS.openRelease),
  setUpTool: (tool) => ipcRenderer.invoke(CHANNELS.setUpTool, tool),
  getReady: () => ipcRenderer.invoke(CHANNELS.getReady),
  browseSubProject: (stoneId) => ipcRenderer.invoke(CHANNELS.browseSubProject, stoneId),
  getApp: (app) => ipcRenderer.invoke(CHANNELS.getApp, app),
  planUninstall: () => ipcRenderer.invoke(CHANNELS.planUninstall),
  uninstall: (options) => ipcRenderer.invoke(CHANNELS.uninstall, options),
  launchRun: (request) => ipcRenderer.invoke(CHANNELS.launchRun, request),
  resumeRun: (runId) => ipcRenderer.invoke(CHANNELS.resumeRun, runId),
  readTranscript: (runId) => ipcRenderer.invoke(CHANNELS.readTranscript, runId),
  focusTerminal: () => ipcRenderer.invoke(CHANNELS.focusTerminal),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

contextBridge.exposeInMainWorld('grove', api)
