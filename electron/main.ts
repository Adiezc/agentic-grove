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
import { BrowserWindow, app, dialog, net, screen, session, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { startScanLoop, openSession, type ScanResult } from '../core/scan.ts'
import { addAgent, addProject, carveNote, carveRune, declineRune, readNote, removeRune, groveHome, loadGrove, grovePath, removeAgent, removeProject, saveSettings, updateAgent, type AgentDraft } from '../core/state/grove.ts'
import { deriveStones } from '../core/state/stones.ts'
import { readRepos } from '../core/state/repos.ts'
import { noteViews } from '../core/state/notes.ts'
import { BUILT_IN_AGENT_IDS, LINK_HOME, defaultGrove, isHttpsUrl, isLinkOnly } from '../core/state/schema.ts'
import { CHANNELS, type AgentResult, type GroveSnapshot, type HooksStatus, type LimitsCheck, type ProjectResult, type ReadyResult, type RunResult, type UninstallPlan } from './bridge.ts'
import { LiveState } from '../core/hooks/live.ts'
import { startUsageLoop, usage as readUsage } from '../core/usage/index.ts'
import { isProbeFolder, runProbe, type ClaudeReading } from '../core/usage/probe.ts'
import { createShard, type Shard } from './tray.ts'
import type { UsageReport } from '../core/usage/types.ts'
import { startHookServer, type HookServer } from '../core/hooks/server.ts'
import { applyHooks, hookToken, hooksState, planHooks, type HooksAction } from '../core/hooks/install.ts'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isAppLink, isOwnPage, lockDownPages } from './security.ts'
import { CHECK_EVERY_MS, RELEASES_PAGE, checkForUpdate, type UpdateStatus } from '../core/updates.ts'
import { sampleLoad, type SystemLoad } from '../core/system.ts'
import { APP_DOWNLOADS, TOOL_PAGES, cliPath, setupScript, setupStatus, signInScript, type SetupStatus, type SetupTool } from '../core/setup.ts'
import { nextSetupStep } from '../core/readiness.ts'
import { RunBook, type RunHarness } from '../core/spawn/runs.ts'
import { launch } from '../core/spawn/launch.ts'
import { BUILT_IN_BRIEFS, BUILT_IN_NAMES } from '../core/spawn/briefs.ts'
import { readTranscript } from '../core/spawn/transcript.ts'
import { noticeFor } from '../core/attention.ts'
import { headroomFrom, route } from '../core/routing.ts'
import { agentForKind } from '../core/console.ts'
import { notify } from './notify.ts'
import { execFile } from 'node:child_process'

const dirname = path.dirname(fileURLToPath(import.meta.url))
/** The built interface. In development the dev server's page is loaded instead. */
const pageFile = path.join(dirname, '..', 'dist', 'index.html')

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
/** The crystal's figures. Refreshed once a minute on their own timer; see `core/usage/`. */
let usage: UsageReport | null = null
let stopUsage: (() => void) | undefined
/**
 * Claude's official limits from the last press of "Check now". Kept in memory only: after a
 * restart the figure is old news, and the honest state is "not checked" until you press again.
 */
let claudeReading: ClaudeReading | null = null
let checkingLimits: Promise<LimitsCheck> | null = null
let shard: Shard | null = null
/** How busy the Mac is, sampled on its own five-second timer so hook-driven redraws do not skew it. */
let system: SystemLoad = { cpu: 0, memory: 0 }
/** The newest release GitHub knows of. See `core/updates.ts`. */
let update: UpdateStatus = { state: 'unknown', current: app.getVersion() }
/** Which tools are installed. Re-checked every minute, so finishing a setup shows up by itself. */
let setup: SetupStatus = {
  checked: false,
  'claude-code': { cli: false, app: false },
  codex: { cli: false, app: false },
  brew: false,
  npm: false,
}
const timers: ReturnType<typeof setInterval>[] = []
/** Work the Grove started. Loaded before the first scan so runs from before a restart are matched again. */
const runs = new RunBook()
/**
 * A run a clicked notification asked to show, kept until a window has loaded to show it in: the
 * click may have had to open a fresh window, which cannot receive anything until its page is up.
 */
let focusPending: string | null = null

/** Open the Grove on one run. */
function focusRun(runId: string): void {
  focusPending = runId
  showWindow()
  for (const window of windows) {
    if (!window.isDestroyed() && !window.webContents.isLoading()) {
      window.webContents.send(CHANNELS.focusRun, runId)
      focusPending = null
    }
  }
}

// Every run state change is offered to the attention rules; most are not worth a notification.
runs.onStateChange = (run, from, since) => {
  const settings = latest?.settings ?? defaultGrove().settings
  const name = latest?.grove.stones.find((stone) => stone.id === run.stoneId)?.name
  const notice = noticeFor(run, from, since, Date.now(), settings, name)
  if (notice) notify(notice, () => focusRun(run.id))
}

/** How many runs each snapshot carries. The file keeps more; the interface only ever shows recent ones. */
const RUNS_IN_SNAPSHOT = 50

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
  // Two or three tiny reads per stone (`.git`, `HEAD`), cheap beside the scan, and read fresh so a
  // worktree removed or a branch switched shows on the next pass.
  const repos = await readRepos(grove.stones.map((stone) => stone.path)).catch(() => undefined)
  const installed = await hooksState().catch((error: unknown) => ({ state: 'unreadable' as const, error: String(error) }))
  const hooks: HooksStatus = {
    ...installed,
    listening: hookServer?.listening ?? false,
    listenError: hookServer?.error,
    lastCallAt: live.lastCallAt,
  }
  const derived = deriveStones(live.apply(result.sessions), grove, Date.now(), repos)
  return {
    at: Date.now(),
    grove: derived,
    settings: grove.settings,
    agents: grove.agents,
    harnesses: result.harnesses,
    problems: result.problems,
    groveProblems: loaded?.problems ?? [],
    grovePath: loaded?.path ?? grovePath(),
    scanMs: result.durationMs,
    hooks,
    usage,
    system,
    update: grove.settings.checkForUpdates ? update : { state: 'off', current: update.current },
    setup,
    version: app.getVersion(),
    displays: screen.getAllDisplays().length,
    runs: runs.list().slice(0, RUNS_IN_SNAPSHOT),
    notes: noteViews(grove.notes, derived.stones, runs.list()),
  }
}

/**
 * Build a snapshot and send it, never letting an older one overwrite a newer one.
 *
 * Building a snapshot waits on disk (`grove.json`, the hooks' state), so two started close
 * together can finish in either order. Each gets a number when it starts, and one that finishes
 * after a later-numbered one has already gone out is dropped.
 */
let snapshotsStarted = 0
let snapshotsSent = 0
function publish(result: ScanResult): void {
  const number = ++snapshotsStarted
  void toSnapshot(result).then((snapshot) => {
    if (number < snapshotsSent) return
    snapshotsSent = number
    broadcast(snapshot)
  })
}

/**
 * The daily update check. Runs hourly but only asks GitHub when a day has passed since the last
 * answer, the setting is on, and the Mac is online. An offline Mac is not asked and not counted as a
 * check, so the question goes out soon after the connection returns.
 */
async function maybeCheckForUpdate(force = false): Promise<UpdateStatus> {
  const { grove } = await loadGrove()
  if (!grove.settings.checkForUpdates && !force) return update
  const due = !update.checkedAt || Date.now() - update.checkedAt >= CHECK_EVERY_MS || update.state === 'error'
  if (!due && !force) return update
  if (!net.isOnline()) {
    update = { ...update, state: update.state === 'available' ? 'available' : 'offline' }
    return update
  }
  update = await checkForUpdate(app.getVersion())
  if (lastScan) publish(lastScan)
  return update
}

/**
 * Start listening for Claude Code's hooks. Always, whether or not they are installed: an idle
 * listener costs nothing, and it means installing them works at once without a restart.
 */
async function startListening(): Promise<void> {
  hookServer = await startHookServer(await hookToken(), (call) => {
    // A limits check is the Grove's own housekeeping, not work to show. See `core/usage/probe.ts`.
    if (isProbeFolder(call.cwd)) return
    // Both always run: `||` would skip the run book whenever the stone's status changed.
    const stoneChanged = live.record(call)
    const runChanged = runs.onHook(call)
    const changed = stoneChanged || runChanged
    const known = lastScan?.sessions.some((session) => session.id === `claude-code:${call.sessionId}`)
    // A session the scan has never seen needs a scan to learn which folder it is in. Anything
    // else redraws straight from the last scan: that is the sub-second path this all exists for.
    if (!known) scheduleRescan()
    else if (changed && lastScan) publish(lastScan)
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
      // Chromium's own sandbox round the page as well. The preload is built as plain CommonJS
      // that only asks for `electron`, which is what a sandboxed preload is allowed.
      sandbox: true,
    },
  })

  windows.add(window)
  window.on('closed', () => windows.delete(window))
  // Back from Terminal after installing or signing in: show it straight away.
  window.on('focus', () => void refreshSetup())

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
    if (focusPending && !window.isDestroyed()) {
      window.webContents.send(CHANNELS.focusRun, focusPending)
      focusPending = null
    }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(pageFile)
  }
}

/** A place number from page code, or nothing: anything but a small whole number is ignored. */
const asPlace = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1000 ? value : undefined

/** Add a folder, then rescan so its stone appears straight away rather than on the next tick. */
async function addAndRescan(folder: string, place?: number): Promise<ProjectResult> {
  const result = await addProject(folder, place)
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
  /* Every handler below is registered through this, which drops any message that does not come
   * from the Grove's own page (see `electron/security.ts`, rule 4). Navigation is already locked,
   * so this should never trigger; it is the second wall, not the first. */
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isOwnPage(event.senderFrame?.url, devServerUrl, pageFile)) throw new Error('Refused: not the Grove page')
      return handler(event, ...args)
    })

  handle(CHANNELS.refresh, async () => {
    // Deliberately does not run a scan of its own: it restarts the loop, so an impatient click
    // cannot stack passes on top of the scheduled one.
    restartScanning()
  })

  handle(CHANNELS.openSession, async (_event, harness: unknown, ref: unknown) => {
    if (typeof harness !== 'string' || typeof ref !== 'object' || ref === null) return { ok: false, error: 'Not a session' }
    try {
      const result = await openSession(harness, ref as Record<string, unknown>)
      if (!result.ok) return { ok: false, error: result.error }
      // The adapters build these links from checked ids; this is the last look before the system
      // opener, and it should not depend on every adapter staying correct.
      if (!isAppLink(result.url)) return { ok: false, error: 'Not a link to an app' }
      await shell.openExternal(result.url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /* Development only. A packaged build has no reason to be able to write PNGs of itself, and
   * registering it there would be a write surface with no caller. */
  if (devServerUrl) {
    handle(CHANNELS.captureStill, async () => {
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

  handle(CHANNELS.connectSuggested, async (_event, folder: unknown, place: unknown): Promise<ProjectResult> => {
    // Page code is untrusted: accept only a path the node side itself offered, as a project or as
    // a part of one worth its own sub-stone.
    const offered =
      latest?.grove.suggestions.some((suggestion) => suggestion.path === folder) ||
      latest?.grove.stones.some((stone) => stone.splits.some((split) => split.path === folder))
    if (typeof folder !== 'string' || !offered) return { ok: false, error: 'Not one of the suggested folders' }
    return addAndRescan(folder, asPlace(place))
  })

  handle(CHANNELS.browseProject, async (event, place: unknown): Promise<ProjectResult> => {
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
    return addAndRescan(folder, asPlace(place))
  })

  handle(CHANNELS.browseSubProject, async (event, stoneId: unknown): Promise<ProjectResult> => {
    const { grove } = await loadGrove()
    const parent = grove.stones.find((stone) => stone.path === stoneId)
    if (!parent) return { ok: false, error: 'Not one of your stones' }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: `A part of ${path.basename(parent.path)} to give its own stone`,
      buttonLabel: 'Make sub-stone',
      defaultPath: parent.path,
      properties: ['openDirectory'],
    }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const folder = picked.filePaths[0]
    if (picked.canceled || !folder) return { ok: false, cancelled: true }
    if (!folder.startsWith(parent.path + path.sep)) return { ok: false, error: 'Choose a folder inside the project' }
    return addAndRescan(folder)
  })

  handle(CHANNELS.createProject, async (event, place: unknown): Promise<ProjectResult> => {
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
    return addAndRescan(picked.filePath, asPlace(place))
  })

  // Only plain text fields are read off a draft; the grove then checks each one like a hand edit.
  const asDraft = (draft: unknown): AgentDraft | null => {
    if (typeof draft !== 'object' || draft === null) return null
    const fields = draft as Record<string, unknown>
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
    return {
      name: text(fields.name) ?? '',
      description: text(fields.description) ?? '',
      harness: text(fields.harness) ?? '',
      glyph: text(fields.glyph),
      link: text(fields.link),
      brief: text(fields.brief),
      model: text(fields.model),
    }
  }

  handle(CHANNELS.addAgent, async (_event, draft: unknown): Promise<AgentResult> => {
    const fields = asDraft(draft)
    if (!fields) return { ok: false, error: 'Not an agent' }
    const result = await addAgent(fields).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  handle(CHANNELS.updateAgent, async (_event, id: unknown, draft: unknown): Promise<AgentResult> => {
    const fields = asDraft(draft)
    if (typeof id !== 'string' || !fields) return { ok: false, error: 'Not an agent' }
    const result = await updateAgent(id, fields).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  handle(CHANNELS.removeProject, async (_event, stoneId: unknown): Promise<ProjectResult> => {
    if (typeof stoneId !== 'string') return { ok: false, error: 'Not a stone' }
    const result = await removeProject(stoneId).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  // Both check the place against grove.json themselves; a changed note shows on the next snapshot.
  handle(CHANNELS.carveNote, async (_event, on: unknown, id: unknown, text: unknown) => {
    const result = await carveNote(on, id, text)
    if (result.ok) await restartScanning()
    return result
  })
  handle(CHANNELS.readNote, async (_event, on: unknown, id: unknown) => {
    const result = await readNote(on, id)
    if (result.ok) await restartScanning()
    return result
  })

  /* Runes. Each change rescans so the stone and its suggestions update at once. */
  const andRescan = async (result: { ok: boolean; error?: string }) => {
    if (result.ok) await restartScanning()
    return result
  }
  handle(CHANNELS.carveRune, async (_event, stoneId: unknown, prompt: unknown, agent: unknown) => andRescan(await carveRune(stoneId, prompt, agent ?? '')))
  handle(CHANNELS.removeRune, async (_event, stoneId: unknown, runeId: unknown) => andRescan(await removeRune(stoneId, runeId)))
  handle(CHANNELS.declineRune, async (_event, stoneId: unknown, key: unknown) => andRescan(await declineRune(stoneId, key)))
  handle(CHANNELS.runRune, async (_event, stoneId: unknown, runeId: unknown): Promise<RunResult> => {
    const { grove } = await loadGrove()
    const rune = grove.stones.find((stone) => stone.path === stoneId)?.runes?.find((each) => each.id === runeId)
    if (!rune) return { ok: false, error: 'No such saved task' }
    // A rune without an agent, or naming one since removed, goes to whoever the console would pick.
    const known = BUILT_IN_AGENT_IDS.includes(rune.agent as never) || grove.agents.some((agent) => agent.id === rune.agent)
    return launchRun({ stoneId, agentId: known ? rune.agent : agentForKind(rune.prompt), task: rune.prompt })
  })

  handle(CHANNELS.removeAgent, async (_event, id: unknown): Promise<AgentResult> => {
    if (typeof id !== 'string') return { ok: false, error: 'Not an agent id' }
    const result = await removeAgent(id).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  handle(CHANNELS.openAgentLink, async (_event, id: unknown): Promise<AgentResult> => {
    const { grove } = await loadGrove()
    const agent = grove.agents.find((each) => each.id === id)
    if (!agent || !isLinkOnly(agent.harness)) return { ok: false, error: 'That agent runs in the Grove, not in a browser' }
    const link = agent.link ?? LINK_HOME[agent.harness] ?? ''

    // Checked again here even though the loader already did: this is the line that hands a string
    // to the system opener, and it should not depend on some other file staying correct.
    if (!isHttpsUrl(link)) return { ok: false, error: 'Link is not https' }
    await shell.openExternal(link)
    return { ok: true }
  })

  // Both take only a word from the page: which action. The file and the change are worked out here.
  const asAction = (value: unknown): HooksAction | null => (value === 'install' || value === 'remove' ? value : null)
  handle(CHANNELS.planHooks, async (_event, action: unknown) => {
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
  handle(CHANNELS.applyHooks, async (_event, action: unknown, baseline: unknown) => {
    const which = asAction(action)
    if (!which || typeof baseline !== 'string') return { ok: false, error: 'Unknown action' }
    const result = await applyHooks(which, baseline).catch((error: unknown) => ({ ok: false, error: String(error) }))
    if (result.ok) await restartScanning()
    return result
  })

  handle(CHANNELS.openProjectFolder, async (_event, stoneId: unknown): Promise<ProjectResult> => {
    // Only a folder that is a stone in grove.json, never a path chosen by page code.
    const { grove } = await loadGrove()
    const stone = grove.stones.find((each) => each.path === stoneId)
    if (!stone) return { ok: false, error: 'Not one of your stones' }
    const failure = await shell.openPath(stone.path)
    return failure ? { ok: false, error: failure } : { ok: true }
  })

  handle(CHANNELS.saveSettings, async (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return { ok: false, error: 'Not settings' }
    const result = await saveSettings(patch as Record<string, unknown>).catch((error: unknown) => ({
      ok: false,
      error: String(error),
    }))
    if (result.ok) {
      await restartScanning()
      // Turning the check on should check, not wait up to an hour to find out.
      if ((patch as Record<string, unknown>).checkForUpdates === true) void maybeCheckForUpdate()
      // Switching official limits off forgets the last reading, so the crystal goes back to counting.
      if ((patch as Record<string, unknown>).officialClaudeLimits === false && claudeReading) {
        claudeReading = null
        void readUsage().then(showUsage, () => {})
      }
    }
    return result
  })

  handle(CHANNELS.checkForUpdates, async () => maybeCheckForUpdate(true))

  handle(CHANNELS.checkClaudeLimits, async (): Promise<LimitsCheck> => checkClaudeLimits())

  handle(CHANNELS.openRelease, async () => {
    await shell.openExternal(RELEASES_PAGE)
  })

  handle(CHANNELS.setUpTool, async (_event, tool: unknown) => {
    if (tool !== 'claude-code' && tool !== 'codex') return { ok: false, error: 'Unknown tool' }
    setup = await setupStatus()
    return openSetup(tool)
  })

  handle(CHANNELS.getReady, async (): Promise<ReadyResult> => {
    // Worked out again here from fresh facts, never taken from the page: the page only says "go".
    setup = await setupStatus()
    const hooks = await hooksState().catch(() => ({ state: 'unreadable' as const }))
    const step = nextSetupStep(setup, hooks.state)
    if (step.kind === 'ready') {
      redraw()
      return { ok: true }
    }
    let liveUpdates = false
    if (step.kind === 'live-updates' || step.liveUpdates) {
      const plan = await planHooks('install').catch(() => null)
      const applied = plan?.ok && plan.changes ? await applyHooks('install', plan.baseline).catch(() => null) : null
      liveUpdates = Boolean(applied?.ok || (plan?.ok && !plan.changes))
      if (liveUpdates) await restartScanning()
      else if (step.kind === 'live-updates') return { ok: false, error: applied?.error ?? plan?.error ?? 'Could not change Claude Code’s settings.' }
    }
    if (step.kind === 'live-updates') return { ok: true, liveUpdates }
    const opened = await openSetup(step.tool)
    redraw()
    return { ...opened, liveUpdates }
  })

  handle(CHANNELS.getApp, async (_event, which: unknown) => {
    if (which === 'claude' || which === 'chatgpt') await shell.openExternal(APP_DOWNLOADS[which])
  })

  handle(CHANNELS.launchRun, async (_event, request: unknown): Promise<RunResult> => launchRun(request))

  handle(CHANNELS.resumeRun, async (_event, runId: unknown): Promise<RunResult> => {
    const run = typeof runId === 'string' ? runs.get(runId) : undefined
    if (!run) return { ok: false, error: 'No such run' }
    // The folder must still be one of your stones: a run's folder came from the Grove, but a stone
    // taken off the grove since should not keep a way to start work in it.
    const { grove } = await loadGrove()
    if (!grove.stones.some((stone) => stone.path === run.stoneId)) return { ok: false, error: 'That project is no longer on the grove' }
    const result = await launch({ run, folder: run.stoneId, brief: '', model: '', resume: true }, shell.openPath)
    if (!result.ok) return { ok: false, runId: run.id, error: result.error, missing: result.missing }
    runs.resumed(run.id)
    redraw()
    return { ok: true, runId: run.id }
  })

  handle(CHANNELS.readTranscript, async (_event, runId: unknown) => {
    const run = typeof runId === 'string' ? runs.get(runId) : undefined
    if (!run) return { ok: false, error: 'No such run' }
    if (run.harness !== 'claude-code') return { ok: false, error: 'Codex runs show their work in their Terminal window.' }
    const lines = await readTranscript(run.id, run.stoneId).catch(() => null)
    return lines ? { ok: true, lines } : { ok: true, lines: [] }
  })

  handle(CHANNELS.focusTerminal, async () => {
    // By bundle id, so it finds Terminal wherever macOS keeps it. macOS only; the Windows port
    // needs its own answer here (see the Windows-before-release note).
    await new Promise<void>((resolve) => execFile('open', ['-b', 'com.apple.Terminal'], () => resolve()))
  })

  handle(CHANNELS.planUninstall, async (): Promise<UninstallPlan> => planUninstall())

  handle(CHANNELS.uninstall, async (_event, options: unknown) => {
    const removeGrove = typeof options === 'object' && options !== null && (options as { removeGrove?: unknown }).removeGrove === true
    return uninstall(removeGrove)
  })

  handle(CHANNELS.revealGroveFile, async () => {
    const file = grovePath()
    // `showItemInFolder` on a file that does not exist yet opens nothing at all, which reads as
    // a broken button. Falling back to the containing folder is the honest behaviour, and the
    // folder is created on the first save rather than here — this handler writes nothing.
    shell.showItemInFolder(file)
  })
}

/**
 * Open Terminal to install or sign in to a tool: signing in when it is already here, installing
 * when it is not. With no way to install, opens the tool's own page instead.
 */
async function openSetup(which: SetupTool): Promise<{ ok: boolean; opened?: 'terminal' | 'page'; error?: string }> {
  const cli = setup[which].cli ? await cliPath(which) : null
  const script = cli ? signInScript(which, cli) : setupScript(which, setup)
  if (!script) {
    await shell.openExternal(TOOL_PAGES[which])
    return { ok: true, opened: 'page' }
  }
  try {
    // A `.command` file is what macOS opens in Terminal on its own. Written to a private temp
    // folder, readable and runnable by this user only.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentic-grove-setup-'))
    const file = path.join(dir, `set-up-${which}.command`)
    await fsp.writeFile(file, script, { mode: 0o700 })
    const failure = await shell.openPath(file)
    return failure ? { ok: false, error: failure } : { ok: true, opened: 'terminal' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Look again at which tools are here and signed in, then redraw. Run every minute, and whenever a
 * Grove window comes forward, which is the moment someone returns from signing in in Terminal;
 * at most once every few seconds, since each look asks both tools.
 */
let setupLookedAt = 0
async function refreshSetup(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - setupLookedAt < 4000) return
  setupLookedAt = now
  setup = await setupStatus()
  redraw()
}

/** A new usage report redraws from the last scan rather than waiting up to a scan interval. */
function showUsage(report: UsageReport): void {
  usage = report
  shard?.update(report)
  redraw()
}

/**
 * Press "Check now": run your own Claude Code once and read the limits it prints. Only with the
 * setting on, only one at a time (a second press joins the first), and never on a timer.
 */
function checkClaudeLimits(): Promise<LimitsCheck> {
  checkingLimits ??= (async (): Promise<LimitsCheck> => {
    const { grove } = await loadGrove()
    if (!grove.settings.officialClaudeLimits) return { ok: false, error: 'Switch on official Claude limits first.' }
    const cli = await cliPath('claude-code')
    if (!cli) return { ok: false, error: 'Claude Code is not set up on this Mac.' }
    const result = await runProbe(cli)
    if (result.reading) {
      claudeReading = result.reading
      await readUsage(Date.now(), claudeReading).then(showUsage, () => {})
    }
    return { ok: result.ok, tokens: result.tokens, error: result.error }
  })().finally(() => {
    checkingLimits = null
  })
  return checkingLimits
}

/** Redraw from the last scan, for changes that do not need a new one. */
function redraw(): void {
  if (lastScan) publish(lastScan)
}

/** Most a task may be. Far past anything typed; a limit so a pasted file cannot fill the disk with runs. */
const MAX_TASK_CHARS = 20_000

/**
 * Send an agent to a stone. Everything the page sends is checked against `grove.json`: the stone
 * must be one of yours, the agent must be built in or on your tree, and link-only agents cannot be
 * sent anywhere. The run is recorded *before* Terminal is asked to open, so a launch that fails is
 * still in the history, as failed, rather than vanishing.
 */
async function launchRun(request: unknown): Promise<RunResult> {
  if (typeof request !== 'object' || request === null) return { ok: false, error: 'Not a request' }
  const { stoneId, agentId, task, harness: asked } = request as Record<string, unknown>
  if (typeof stoneId !== 'string' || typeof agentId !== 'string' || typeof task !== 'string') return { ok: false, error: 'Not a request' }
  if (task.length > MAX_TASK_CHARS) return { ok: false, error: 'That task is too long to send' }

  const { grove } = await loadGrove()
  if (!grove.stones.some((stone) => stone.path === stoneId)) return { ok: false, error: 'Not one of your stones' }

  const own = grove.agents.find((agent) => agent.id === agentId)
  const builtIn = agentId in BUILT_IN_BRIEFS
  if (!own && !builtIn) return { ok: false, error: 'No such agent' }
  if (own && isLinkOnly(own.harness)) return { ok: false, error: `${own.name} lives in its own app and cannot be sent to a stone` }

  // Your own agents use their own tool. Built-ins use the one you picked in the console if its
  // command is here, otherwise the Manager's rules: installed tools, and allowances not used up.
  // With neither installed, Claude Code is tried so the failure names the tool most people want.
  let harness: RunHarness
  if (own) harness = own.harness === 'codex' ? 'codex' : 'claude-code'
  else {
    const installed = { claudeCode: Boolean(await cliPath('claude-code')), codex: Boolean(await cliPath('codex')) }
    const picked = asked === 'codex' ? installed.codex : asked === 'claude-code' ? installed.claudeCode : false
    const routed = route(
      'project',
      { ...installed, claudeApp: false, chatgptApp: false, dots: false },
      headroomFrom(usage, Date.now())
    ).harness
    harness = picked ? (asked as RunHarness) : routed === 'codex' ? 'codex' : 'claude-code'
  }

  const run = runs.create({
    harness,
    agentId,
    agentName: own?.name ?? BUILT_IN_NAMES[agentId] ?? agentId,
    stoneId,
    task: task.trim(),
  })
  const brief = own ? (own.systemPrompt ?? '') : (BUILT_IN_BRIEFS[agentId] ?? '')
  const result = await launch({ run, folder: stoneId, brief, model: own?.model ?? '' }, shell.openPath)
  if (!result.ok) runs.fail(run.id, result.error)
  redraw()
  return result.ok ? { ok: true, runId: run.id } : { ok: false, runId: run.id, error: result.error, missing: result.missing }
}

/**
 * The app bundle this copy is running from, or `null` when running from source, where there is no
 * app to remove. The binary sits at `<bundle>.app/Contents/MacOS/<name>`.
 */
function appBundle(): string | null {
  if (devServerUrl || !app.isPackaged) return null
  const bundle = path.resolve(process.execPath, '..', '..', '..')
  return bundle.endsWith('.app') ? bundle : null
}

async function planUninstall(): Promise<UninstallPlan> {
  const installed = await hooksState().catch(() => ({ state: 'off' as const }))
  return {
    hooks: installed.state === 'on' || installed.state === 'outdated',
    appPath: appBundle(),
    grovePath: groveHome(),
  }
}

/**
 * Uninstall, in the order that leaves nothing half-done:
 *
 *   1. Take the Grove's lines out of Claude Code's settings. First, because it is the one change
 *      the Grove made to another tool, and leaving it would have Claude Code calling a Grove that
 *      is no longer there. A backup of the file is kept, as with every hooks change.
 *   2. If asked, move `~/.agentic-grove` and the window's own storage to the Trash.
 *   3. Move the app to the Trash, and quit.
 *
 * The Trash rather than deleting, throughout: an uninstall you regret should be one drag to undo.
 * Stops at the first failure and says which step, so nothing is removed after something went wrong.
 */
async function uninstall(removeGrove: boolean): Promise<{ ok: boolean; error?: string }> {
  const plan = await planUninstall()
  if (plan.hooks) {
    const hooks = await planHooks('remove')
    const applied = hooks.ok ? await applyHooks('remove', hooks.baseline) : { ok: false, error: hooks.error }
    if (!applied.ok) return { ok: false, error: `Could not take the hooks out of Claude Code's settings: ${applied.error ?? 'unknown'}` }
  }
  stopScanning?.()
  stopUsage?.()
  hookServer?.close()
  try {
    if (removeGrove) {
      // Nothing there yet is not a failure: there was simply nothing to remove.
      const exists = await fsp.access(groveHome()).then(() => true, () => false)
      if (exists) await shell.trashItem(groveHome())
    }
    if (plan.appPath) await shell.trashItem(plan.appPath)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  setTimeout(() => void finishUninstall(removeGrove), 400)
  return { ok: true }
}

/**
 * The window's own storage goes last, after the window itself. Trashed while the window was still
 * open, Chromium wrote a few session files back on the way out and the folder came straight back
 * (found testing uninstall, 3 October 2026). So: close the windows, let Chromium write what it
 * wants, trash the folder, and leave without the usual shutdown that would write it again.
 */
async function finishUninstall(removeGrove: boolean): Promise<void> {
  if (!removeGrove) return app.quit()
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await session.defaultSession.flushStorageData()
  await new Promise((resolve) => setTimeout(resolve, 300))
  await shell.trashItem(app.getPath('userData')).catch(() => {})
  app.exit(0)
}

/**
 * Which restart is the latest. Restarts can overlap (a hook, a saved setting and a click all at
 * once), and each waits on reading `grove.json` before starting its loop; only the newest may
 * start one, so there is never more than one loop running.
 */
let scanGeneration = 0

async function restartScanning(): Promise<void> {
  const generation = ++scanGeneration
  stopScanning?.()
  stopScanning = undefined
  const { grove } = await loadGrove()
  if (generation !== scanGeneration) return
  stopScanning = startScanLoop((scanned) => {
    // Limits checks leave sessions behind in their own folder; they are counted as usage, never drawn.
    const result = { ...scanned, sessions: scanned.sessions.filter((session) => !isProbeFolder(session.cwd)) }
    lastScan = result
    runs.onScan(live.apply(result.sessions))
    publish(result)
  }, grove.settings.scanIntervalMs)
}

/* A grove started from another folder (`AGENTIC_GROVE_HOME`, which the checks use) keeps the
 * window's own storage beside that folder, in `<folder>-window`. Otherwise a test run shares, and
 * Settings → Uninstall with "remove my grove" would put in the Trash, the storage of the Grove you
 * actually use. Beside rather than inside, so the two stay separate folders as they are normally.
 * Set before the app is ready, as Electron requires. */
if (process.env.AGENTIC_GROVE_HOME) app.setPath('userData', `${groveHome()}-window`)

void app.whenReady().then(async () => {
  lockDownPages(devServerUrl, pageFile)
  await runs.load()
  registerHandlers()
  await startListening()
  await restartScanning()
  shard = createShard(path.join(dirname, '..', 'assets', 'tray', 'crystalTemplate.png'), {
    open: showWindow,
    quit: () => app.quit(),
  })
  stopUsage = startUsageLoop(showUsage, undefined, () => claudeReading)
  setup = await setupStatus()
  timers.push(
    setInterval(() => {
      system = sampleLoad()
    }, 5000),
    setInterval(() => {
      void refreshSetup(true)
    }, 60_000),
    setInterval(() => void maybeCheckForUpdate(), 60 * 60_000)
  )
  // The first check waits a minute, so launching the app is never slowed by a network call.
  setTimeout(() => void maybeCheckForUpdate(), 60_000)
  createWindow()

  // macOS convention: clicking the dock icon after closing every window reopens one rather than
  // doing nothing.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Closing the window leaves the Grove running, as macOS apps normally do: it keeps listening for
// hooks and keeps the menu-bar shard current. The shard's "Open the Grove", or the Dock icon,
// brings the window back; Quit in either place stops it.
app.on('window-all-closed', () => {
  /* stay running in the menu bar */
})

/** Bring the window forward, or open a new one if it was closed. */
function showWindow(): void {
  const open = BrowserWindow.getAllWindows()[0]
  if (!open) return createWindow()
  if (open.isMinimized()) open.restore()
  open.show()
  open.focus()
}

app.on('before-quit', () => {
  void runs.flushed()
  stopScanning?.()
  stopUsage?.()
  shard?.destroy()
  hookServer?.close()
  for (const timer of timers) clearInterval(timer)
})
