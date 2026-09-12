/**
 * The Electron main process: app lifecycle and windows.
 *
 * This is the node half of the app. It is the only place allowed to touch the filesystem or
 * spawn anything, which is why the window is created with `contextIsolation` on and
 * `nodeIntegration` off — the renderer gets no direct access to node, and everything it needs
 * arrives over the narrow bridge defined in `preload.ts`.
 *
 * Session one: it opens a window and nothing else. The tray, the mini-window and the
 * notification layer get their own files (`tray.ts`, `mini-window.ts`, `notifications.ts`)
 * when they arrive, so this file stays about lifecycle.
 */
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Set by the Vite plugin while developing, absent in a packaged build. It is how we know
 * whether to load from the dev server (with hot reloading) or from the built files on disk.
 */
const devServerUrl = process.env.VITE_DEV_SERVER_URL

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    // The grove is a dark scene. Painting the window dark before the renderer has drawn
    // anything avoids a white flash on launch, which on an app meant to sit open all day is
    // the first thing anyone would notice.
    backgroundColor: '#050806',
    // macOS only, so we can assume this style exists: keeps the traffic lights but loses the
    // title bar, which the concept art has no room for.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(dirname, '..', 'dist', 'index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()

  // macOS convention: clicking the dock icon after closing every window reopens one rather
  // than doing nothing.
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
