/**
 * The Electron main process: app lifecycle, the window, and the scan loop that feeds it.
 *
 * This is the node half of the app. It is the only place allowed to touch the filesystem or
 * spawn anything, which is why the window is created with `contextIsolation` on and
 * `nodeIntegration` off — the renderer gets no direct access to node, and everything it needs
 * arrives over the narrow bridge in `bridge.ts` and `preload.ts`.
 *
 * The scan loop lives here rather than in the renderer for a reason that will matter later: the
 * Grove is meant to keep watching with its window closed, sitting in the menu bar. A loop owned
 * by the main process survives that; one owned by a React component does not.
 *
 * Windows, the tray and notifications will each get their own file as they arrive. This one
 * stays about lifecycle.
 */
import { BrowserWindow, app, dialog, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { startScanLoop, openSession, type ScanResult } from '../core/scan.ts'
import { addAgent, addProject, loadGrove, grovePath, removeAgent } from '../core/state/grove.ts'
import { deriveStones } from '../core/state/stones.ts'
import { GROK_HOME, defaultGrove, isHttpsUrl } from '../core/state/schema.ts'
import { CHANNELS, type AgentResult, type GroveSnapshot, type HooksStatus, type ProjectResult } from './bridge.ts'
import { LiveState } from '../core/hooks/live.ts'
import { startHookServer, type HookServer } from '../core/hooks/server.ts'
import { applyHooks, hookToken, hooksState, planHooks, type HooksAction } from '../core/hooks/install.ts'
import { ipcMain } from 'electron'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Set by the Vite plugin while developing, absent in a packaged build. It is how we know whether
 * to load from the dev server, with hot reloading, or from the built files on disk.
 */
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/**
 * The most recent snapshot, kept so that a window opening mid-flight has something to draw
 * immediately rather than an empty grove until the next tick.
 */
let latest: GroveSnapshot | null = null
let stopScanning: (() => void) | undefined

/** The last raw scan, kept so a hook call can redraw at once without waiting for the next one. */
let lastScan: ScanResult | null = null
/** What the hooks have said, laid over each scan. See `core/hooks/live.ts`. */
const live = new LiveState()
let hookServer: HookServer | null = null

/** Every open window that wants snapshots. Plural already, because the mini-window is coming. */
const windows = new Set<BrowserWindow>()

function broadcast(snapshot: GroveSnapshot): void {
  const first = latest === null
  latest = snapshot
  for (const window of windows) {
    // A window closing between the scan finishing and this line is entirely normal.
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.snapshot, snapshot)
  }
  // One line on the first scan, so that starting the app in a terminal tells you whether it
  // found your work — and, when it did not, whether the answer was "nothing there" or "nothing
  // read". Deliberately only the first: this runs every few seconds, all day, and a log line per
  // pass would make the terminal useless for anything else.
  if (first) {
    const { grove } = snapshot
    console.log(
      `agentic-grove: ${grove.stones.length} stones, ${grove.totalSessions} sessions, ` +
        `${grove.runningSessions} running, ${grove.attentionSessions} want you ` +
        `(scanned in ${snapshot.scanMs}ms)`
    )
  }
}

/**
 * Fold a raw scan into the picture the interface wants.
 *
 * `grove.json` is re-read on every pass rather than cached. It is one small file, the read is
 * noise next to the transcript scanning that just happened, and it means editing the file by
 * hand shows up in the window within a few seconds without a reload or a file watcher. For a
 * file the brief explicitly wants people to edit by hand, that is worth more than the read costs.
 */
async function toSnapshot(result: ScanResult): Promise<GroveSnapshot> {
  const loaded = await loadGrove().catch(() => null)
  const grove = loaded?.grove ?? defaultGrove()
  const installed = await hooksState().catch((error: unknown) => ({ state: 'unreadable' as const, error: String(error) }))
  const hooks: HooksStatus = {
    ...installed,
    listening: hookServer?.listening ?? false,
    listenError: hookServer?.error,
    lastCallAt: live.lastCallAt,
  }
  return {
    at: Date.now(),
    grove: deriveStones(live.apply(result.sessions), grove),
    settings: grove.settings,
    agents: grove.agents,
    harnesses: result.harnesses,
    problems: result.problems,
    groveProblems: loaded?.problems ?? [],
    grovePath: loaded?.path ?? grovePath(),
    scanMs: result.durationMs,
    hooks,
  }
}

/**
 * Start listening for Claude Code's hooks. Always, whether or not they are installed: an idle
 * listener costs nothing, and it means installing them works at once without a restart.
 */
async function startListening(): Promise<void> {
  hookServer = await startHookServer(await hookToken(), (call) => {
    const changed = live.record(call)
    const known = lastScan?.sessions.some((session) => session.id === `claude-code:${call.sessionId}`)
    // A session the scan has never seen needs a scan to learn which folder it is in. Anything
    // else redraws straight from the last scan: that is the sub-second path this all exists for.
    if (!known) scheduleRescan()
    else if (changed && lastScan) void toSnapshot(lastScan).then(broadcast)
  })
  if (!hookServer.listening) {
    console.warn(`agentic-grove: hooks listener not started: ${hookServer.error}`)
    // Usually another copy of the Grove holding the port. Try again later rather than stay deaf
    // until a restart: when that copy quits, this one should pick the hooks up by itself.
    setTimeout(() => void startListening(), 30_000)
  }
}

/** Several hook calls from a brand-new session arrive together; they only need one scan. */
let rescanTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRescan(): void {
  if (rescanTimer) return
  rescanTimer = setTimeout(() => {
    rescanTimer = undefined
    void restartScanning()
  }, 250)
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    // The grove is a dark scene. Painting the window dark before the renderer has drawn anything
    // avoids a white flash on launch, which on an app meant to sit open all day is the first
    // thing anyone would notice.
    backgroundColor: '#050806',
    // macOS only, so this style can be assumed: keeps the traffic lights but loses the title
    // bar, which the concept art has no room for.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  windows.add(window)
  window.on('closed', () => windows.delete(window))

  /* Forward what the page logs to the terminal, in development only.
   *
   * Without this, a renderer error is invisible unless somebody has the devtools open, which on
   * an app whose whole front end is a 3D scene means a shader that fails to compile looks
   * identical to a scene that is simply dark. It also makes the frame-rate readout checkable
   * from a terminal rather than only by eye. */
  if (devServerUrl) {
    window.webContents.on('console-message', (event) => {
      const level = event.level === 'error' ? 'error' : event.level === 'warning' ? 'warn' : 'log'
      console.log(`renderer:${level}: ${event.message}`)
    })
  }

  // Send whatever is already known as soon as the page can receive it. Without this, opening a
  // window just after a scan means up to a full interval of blank grove for no reason.
  window.webContents.on('did-finish-load', () => {
    if (latest && !window.isDestroyed()) window.webContents.send(CHANNELS.snapshot, latest)
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(dirname, '..', 'dist', 'index.html'))
  }
}

/** Add a folder, then rescan so its stone appears straight away rather than on the next tick. */
async function addAndRescan(folder: string): Promise<ProjectResult> {
  const result = await addProject(folder)
  if (result.ok) await restartScanning()
  return result
}

/**
 * The handlers the renderer can call, each deliberately small.
 *
 * Only `connectSuggested` takes a path from the renderer, and only one it was just offered. `revealGroveFile` resolves the path on
 * this side; `openSession` hands its `ref` to the adapter, which pattern-checks the ids before
 * anything reaches the opener. Page code never gets to name a file for the node side to act on.
 */
function registerHandlers(): void {
  ipcMain.handle(CHANNELS.refresh, async () => {
    // Deliberately does not run a scan of its own: it restarts the loop, so an impatient click
    // cannot stack passes on top of the scheduled one.
    restartScanning()
  })

  ipcMain.handle(CHANNELS.openSession, async (_event, harness: string, ref: Record<string, unknown>) => {
    try {
      const result = await openSession(harness, ref)
      if (!result.ok) return { ok: false, error: result.error }
      await shell.openExternal(result.url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /* Development only. A packaged build has no reason to be able to write PNGs of itself, and
   * registering it there would be a write surface with no caller. */
  if (devServerUrl) {
    ipcMain.handle(CHANNELS.captureStill, async () => {
      const [window] = [...windows]
      if (!window || window.isDestroyed()) return { ok: false, error: 'No window to capture' }
      try {
        const image = await window.webContents.capturePage()
        const dir = path.join(os.tmpdir(), 'agentic-grove-stills')
        await fsp.mkdir(dir, { recursive: true })
        const file = path.join(dir, `grove-${Date.now()}.png`)
        await fsp.writeFile(file, image.toPNG())
        console.log(`grove-still: ${file}`)
        return { ok: true, path: file }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  ipcMain.handle(CHANNELS.connectSuggested, async (_event, folder: unknown): Promise<ProjectResult> => {
    // Page code is untrusted: accept only a path the node side itself offered.
    const offered = latest?.grove.suggestions.some((suggestion) => suggestion.path === folder)
    if (typeof folder !== 'string' || !offered) return { ok: false, error: 'Not one of the suggested folders' }
    return addAndRescan(folder)
  })

  ipcMain.handle(CHANNELS.browseProject, async (event): Promise<ProjectResult> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Connect a project',
      buttonLabel: 'Connect',
      defaultPath: path.join(os.homedir(), 'Documents'),
      properties: ['openDirectory', 'createDirectory'],
    }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const folder = picked.filePaths[0]
    if (picked.canceled || !folder) return { ok: false, cancelled: true }
    return addAndRescan(folder)
  })

  ipcMain.handle(CHANNELS.createProject, async (event): Promise<ProjectResult> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'New project',
      buttonLabel: 'Create',
      nameFieldLabel: 'Project',
      defaultPath: path.join(os.homedir(), 'Documents', 'New project'),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true }
    try {
      // `recursive` so that choosing a name that already exists as a folder simply connects it.
      await fsp.mkdir(picked.filePath, { recursive: true })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return addAndRescan(picked.filePath)
  })

  ipcMain.handle(CHANNELS.addAgent, async (_event, draft: unknown): Promise<AgentResult> => {
    // Only plain fields are read off the draft; `addAgent` then checks each one like a hand edit.
    if (typeof draft !== 'object' || draft === null) return { ok: false, error: 'Not an agent' }
    const fields = draft as Record<string, unknown>
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
    const result = await addAgent({
      name: text(fields.name) ?? '',
      description: text(fields.description) ?? '',
      harness: text(fields.harness) ?? '',
      glyph: text(fields.glyph),
      link: text(fields.link),
    }).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  ipcMain.handle(CHANNELS.removeAgent, async (_event, id: unknown): Promise<AgentResult> => {
    if (typeof id !== 'string') return { ok: false, error: 'Not an agent id' }
    const result = await removeAgent(id).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  ipcMain.handle(CHANNELS.openAgentLink, async (_event, id: unknown): Promise<AgentResult> => {
    const { grove } = await loadGrove()
    const agent = grove.agents.find((each) => each.id === id)
    if (!agent || agent.harness !== 'grok-bot') return { ok: false, error: 'Not a Grok Bot' }
    const link = agent.link ?? GROK_HOME
    // Checked again here even though the loader already did: this is the line that hands a string
    // to the system opener, and it should not depend on some other file staying correct.
    if (!isHttpsUrl(link)) return { ok: false, error: 'Link is not https' }
    await shell.openExternal(link)
    return { ok: true }
  })

  // Both take only a word from the page: which action. The file and the change are worked out here.
  const asAction = (value: unknown): HooksAction | null => (value === 'install' || value === 'remove' ? value : null)
  ipcMain.handle(CHANNELS.planHooks, async (_event, action: unknown) => {
    const which = asAction(action)
    if (!which) return { ok: false, error: 'Unknown action', action: 'install', lines: [], baseline: '', changes: false }
    return planHooks(which).catch((error: unknown) => ({
      ok: false,
      error: String(error),
      action: which,
      lines: [],
      baseline: '',
      changes: false,
    }))
  })
  ipcMain.handle(CHANNELS.applyHooks, async (_event, action: unknown, baseline: unknown) => {
    const which = asAction(action)
    if (!which || typeof baseline !== 'string') return { ok: false, error: 'Unknown action' }
    const result = await applyHooks(which, baseline).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  ipcMain.handle(CHANNELS.revealGroveFile, async () => {
    const file = grovePath()
    // `showItemInFolder` on a file that does not exist yet opens nothing at all, which reads as
    // a broken button. Falling back to the containing folder is the honest behaviour, and the
    // folder is created on the first save rather than here — this handler writes nothing.
    shell.showItemInFolder(file)
  })
}

async function restartScanning(): Promise<void> {
  stopScanning?.()
  const { grove } = await loadGrove()
  stopScanning = startScanLoop((result) => {
    lastScan = result
    void toSnapshot(result).then(broadcast)
  }, grove.settings.scanIntervalMs)
}

void app.whenReady().then(async () => {
  registerHandlers()
  await startListening()
  await restartScanning()
  createWindow()

  // macOS convention: clicking the dock icon after closing every window reopens one rather than
  // doing nothing.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// On macOS, closing the last window normally leaves the app running in the dock. The Grove will
// eventually want exactly that — it lives in the menu bar and watches in the background — but
// until there is a tray icon to get back in through, quitting is the honest behaviour.
app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  stopScanning?.()
  hookServer?.close()
})
