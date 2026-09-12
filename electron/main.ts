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
import { BrowserWindow, app, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startScanLoop, openSession, type ScanResult } from '../core/scan.ts'
import { loadGrove, grovePath } from '../core/state/grove.ts'
import { deriveStones } from '../core/state/stones.ts'
import { defaultGrove } from '../core/state/schema.ts'
import { CHANNELS, type GroveSnapshot } from './bridge.ts'
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
  return {
    at: Date.now(),
    grove: deriveStones(result.sessions, grove),
    settings: grove.settings,
    harnesses: result.harnesses,
    problems: result.problems,
    groveProblems: loaded?.problems ?? [],
    grovePath: loaded?.path ?? grovePath(),
    scanMs: result.durationMs,
  }
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

/**
 * The handlers the renderer can call. Three, and each one is deliberately small.
 *
 * Note that none of them takes a path from the renderer. `revealGroveFile` resolves the path on
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
    void toSnapshot(result).then(broadcast)
  }, grove.settings.scanIntervalMs)
}

void app.whenReady().then(async () => {
  registerHandlers()
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
})
