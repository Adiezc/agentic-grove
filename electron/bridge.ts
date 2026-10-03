/**
 * What the interface is allowed to know, and the one channel it arrives on.
 *
 * This file is the contract between the two halves of the app: the node side, which can read
 * your disk and will eventually spawn agents, and the renderer, which is page code. Everything
 * that crosses is defined here, both sides import these types, and nothing else gets through.
 *
 * It is a separate file from `preload.ts` because the renderer needs the *types* and must never
 * pull in anything that imports `electron` — doing that is how a bundle ends up trying to
 * `require('electron')` in a browser context. Types only here, no runtime imports at all.
 *
 * The shape is push, not pull. The node side scans on its own timer and sends the result; the
 * renderer subscribes. The alternative — the renderer asking "any news?" on its own interval —
 * means two clocks to keep in step and a window that is always up to half a poll out of date.
 */
import type { HarnessStatus, ScanProblem } from '../core/scan.ts'
import type { DerivedGrove } from '../core/state/stones.ts'
import type { AgentDefinition, GroveProblem, GroveSettings } from '../core/state/schema.ts'
import type { AgentDraft } from '../core/state/grove.ts'
import type { HooksAction, HooksPlan, HooksState } from '../core/hooks/install.ts'
import type { UsageReport } from '../core/usage/types.ts'
import type { UpdateStatus } from '../core/updates.ts'
import type { SystemLoad } from '../core/system.ts'
import type { DesktopApp, SetupStatus, SetupTool } from '../core/setup.ts'
import type { Run } from '../core/spawn/runs.ts'
import type { NotePlace, NoteView } from '../core/state/notes.ts'
import type { TranscriptLine } from '../core/spawn/transcript.ts'

/**
 * One complete picture of the grove, sent after every scan.
 *
 * Deliberately whole rather than a diff. It is a few tens of kilobytes for a machine with
 * thirty-odd sessions, it arrives every few seconds, and sending the lot means the renderer can
 * never drift out of step with the disk — there is no patch to mis-apply and no resync path to
 * get wrong. If this ever becomes a real cost, the honest fix is scanning less often rather than
 * inventing a protocol.
 */
export interface GroveSnapshot {
  /** Epoch ms this snapshot was taken. The renderer uses it for "seen 3m ago" without its own clock. */
  at: number
  grove: DerivedGrove
  settings: GroveSettings
  /** The agents you have connected to the tree, as `grove.json` has them. The built-in three are not listed. */
  agents: AgentDefinition[]
  /** Models chosen for the built-in agents, as `grove.json` has them. See `core/models.ts`. */
  builtInModels: Record<string, string>
  /** Which tools are installed, and anything each wants to say about itself. */
  harnesses: HarnessStatus[]
  /** A harness that failed to scan. Shown, not swallowed. */
  problems: ScanProblem[]
  /** Something wrong with `grove.json`, in terms the person who typed it can act on. */
  groveProblems: GroveProblem[]
  /** Where `grove.json` is, so the interface can offer to open it. */
  grovePath: string
  /** How long the last scan pass took. Worth surfacing: this runs all day. */
  scanMs: number
  /** Claude Code hooks: whether they are installed, and whether the Grove is hearing them. */
  hooks: HooksStatus
  /** What the crystal shows. `null` until the first usage pass, which runs on its own timer. */
  usage: UsageReport | null
  /** How busy the whole Mac is. Steps the graphics down when you need the machine. */
  system: SystemLoad
  /** Whether a newer Grove is out. See `core/updates.ts` for exactly what is asked and why. */
  update: UpdateStatus
  /** Which AI tools are on this Mac, for first-run setup and the provider marks. */
  setup: SetupStatus
  /** This build's version, from package.json. */
  version: string
  /** Work the Grove started, newest first. Separate from the sessions it only watches. See `core/spawn/runs.ts`. */
  runs: Run[]
  /** Notes to your future self, each waiting or showing. See `core/state/notes.ts`. */
  notes: NoteView[]
  /**
   * How many screens are connected. With one, a grove you have not looked at for a while steps its
   * graphics down; with several, it is probably on a screen of its own and stays at full detail.
   */
  displays: number
}

export interface HooksStatus {
  state: HooksState
  /** Why the settings file could not be read, when `state` is `unreadable`. */
  error?: string
  /** False when the listener could not start, usually because another Grove holds the port. */
  listening: boolean
  listenError?: string
  /** Epoch ms of the last hook call heard, or 0. Proof the connection actually works. */
  lastCallAt: number
}

/**
 * Everything on `window.grove`.
 *
 * Kept short on purpose. Each entry here is a deliberate widening of the surface between page
 * code and the filesystem, so the whole list should stay readable on one screen — when it stops
 * being, that is the signal to ask what the renderer is doing that the node side should.
 */
export interface GroveApi {
  /** Electron version. Exists so the bridge itself can be seen working. */
  version: string

  /**
   * Subscribe to snapshots. Called immediately with the latest one if a scan has already
   * finished, then after every scan. Returns an unsubscribe function.
   */
  onSnapshot(listener: (snapshot: GroveSnapshot) => void): () => void

  /** Ask for a scan right now rather than waiting for the timer. */
  refresh(): Promise<void>

  /**
   * Hand a session back to the tool it came from.
   *
   * The node side re-checks the ids in the ref before anything reaches the OS opener — by the
   * time it arrives here it has been through page code, and the adapter treats it as untrusted.
   */
  openSession(harness: string, ref: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>

  /** Reveal `grove.json` in Finder, for editing by hand. */
  revealGroveFile(): Promise<void>

  /**
   * Save a PNG of the window, for comparing the scene against the concept art.
   *
   * Development only: the handler is not registered in a packaged build. It exists because
   * judging a look means putting a still next to the reference, and the alternative is asking a
   * person to take a screenshot every time a number changes.
   */
  captureStill(): Promise<{ ok: boolean; path?: string; error?: string }>

  /**
   * The three ways a stone is made. Each ends with the folder added to `grove.json` and a fresh
   * scan, so the new stone arrives on the next snapshot like any other change.
   *
   * `connectSuggested` takes a path from page code, so the node side accepts it only if it is
   * one of the suggestions it sent in the latest snapshot. The other two ask macOS for the
   * folder, so the path never passes through the page at all.
   */
  connectSuggested(folder: string, place?: number): Promise<ProjectResult>
  /**
   * Pick an existing folder with the system folder picker. `place` is the empty circle it was
   * chosen from, so the stone stands where you clicked; left out, it takes the lowest free circle.
   */
  browseProject(place?: number): Promise<ProjectResult>
  /** Name a new folder with the system save panel; it is created, then added. */
  createProject(place?: number): Promise<ProjectResult>
  /** Pick a folder inside a stone's folder to stand as its own sub-stone. Takes the parent's id. */
  browseSubProject(stoneId: string): Promise<ProjectResult>
  /**
   * Take a stone off the grove, by its id (the project path). The node side accepts only the path
   * of a stone that is in `grove.json`, and removes that entry and nothing else: the folder and
   * its sessions are never touched.
   */
  removeProject(stoneId: string): Promise<ProjectResult>

  /**
   * Grow an agent on the tree. The node side makes the id and checks every field with the same
   * rules as a hand-typed `grove.json` entry, so page code cannot write anything the loader would
   * refuse. Resolves with the new id, so the interface can turn to face it.
   */
  addAgent(draft: AgentDraft): Promise<AgentResult>
  /** Change one of your agents. Same checks as `addAgent`; its id and tool do not change. */
  updateAgent(id: string, draft: AgentDraft): Promise<AgentResult>
  /** Take one of your agents off the tree. The built-in three cannot be removed. */
  removeAgent(id: string): Promise<AgentResult>
  /** Choose the model an agent runs on, built-in or yours. Empty is Default. See `core/models.ts`. */
  setAgentModel(id: string, model: string): Promise<AgentResult>
  /** Carve a note on a stone (its path), an agent (its id) or the tree (id ignored). Empty text removes it. */
  carveNote(on: NotePlace, id: string, text: string): Promise<{ ok: boolean; error?: string }>
  /** A showing note has been read: it fades and goes. */
  readNote(on: NotePlace, id: string): Promise<{ ok: boolean; error?: string }>
  /** Save a job on a stone as a rune. `agent` empty sends it to PM each time. */
  carveRune(stoneId: string, prompt: string, agent?: string): Promise<{ ok: boolean; error?: string }>
  removeRune(stoneId: string, runeId: string): Promise<{ ok: boolean; error?: string }>
  /** Say no to a suggested rune, by its key, so it is not offered again. */
  declineRune(stoneId: string, key: string): Promise<{ ok: boolean; error?: string }>
  /** Run a saved rune. The node side reads its prompt and agent from grove.json, never from the page. */
  runRune(stoneId: string, runeId: string): Promise<RunResult>
  /**
   * Open a link-only agent (a ChatGPT Dot, Claude Cowork) in the browser. Takes the agent's id, not a URL: the node side looks the link
   * up in `grove.json` itself, so page code never chooses what the system opener is handed.
   */
  openAgentLink(id: string): Promise<AgentResult>

  /**
   * Work out what installing or removing the Claude Code hooks would change in its settings, line
   * by line, without changing anything. The plan carries a fingerprint of the file it was made
   * from; `applyHooks` refuses unless the file still matches it, so what you approved is what is
   * written.
   */
  planHooks(action: HooksAction): Promise<HooksPlan>
  applyHooks(action: HooksAction, baseline: string): Promise<{ ok: boolean; error?: string }>

  /** Show a stone's folder in Finder. Takes the stone id; only a stone in `grove.json` is opened. */
  openProjectFolder(stoneId: string): Promise<ProjectResult>
  /** Change settings. Checked with the same rules as a hand edit of `grove.json`. */
  saveSettings(patch: Partial<GroveSettings>): Promise<{ ok: boolean; error?: string }>
  /**
   * Read Claude's official limits now, by running your own Claude Code once (`core/usage/probe.ts`).
   * Takes nothing from the page, and does nothing unless the setting is on. The figures arrive on
   * the next snapshot; this resolves with whether the check worked and what it used.
   */
  checkClaudeLimits(): Promise<LimitsCheck>
  /** Ask GitHub now rather than waiting for the daily check. */
  checkForUpdates(): Promise<UpdateStatus>
  /** Open the latest release's page in the browser. The address is fixed on the node side. */
  openRelease(): Promise<void>
  /**
   * One-button setup for a missing tool: opens Terminal running the maker's official installer,
   * then its sign-in. With no way to install, opens the tool's own page instead.
   */
  setUpTool(tool: SetupTool): Promise<{ ok: boolean; opened?: 'terminal' | 'page'; error?: string }>
  /**
   * The first-launch "Get ready" button. Takes nothing from the page: the node side works out the
   * next missing step itself (`core/readiness.ts`) and does it. Installs or signs in through
   * Terminal, and turns on live updates on the way when they are off.
   */
  getReady(): Promise<ReadyResult>
  /** Open the Claude or ChatGPT desktop app's official download page. The address is fixed here. */
  getApp(app: DesktopApp): Promise<void>
  /**
   * Send an agent to a stone with a task: Terminal opens in the project folder running Claude Code
   * or Codex. Takes ids only. The node side looks up the folder and the agent itself, so page code
   * never names a folder to run in or a command to run. Resolves once Terminal has been asked to
   * open, with the run's id; whether a session really started arrives later, on the run.
   * `harness` picks the tool for a built-in agent (the console's override); left out, PM's
   * rules in `core/routing.ts` pick it. Your own agents always use their own tool. `model` is a
   * model for this one job (the console's model chip); left out, the agent's own model is used.
   */
  launchRun(request: { stoneId: string; agentId: string; task: string; harness?: 'claude-code' | 'codex'; model?: string }): Promise<RunResult>
  /** Reopen a Claude Code run's session in Terminal (`claude --resume`). */
  resumeRun(runId: string): Promise<RunResult>
  /** The last lines of a run's transcript, for the live view. Claude Code runs only. */
  readTranscript(runId: string): Promise<{ ok: boolean; lines?: TranscriptLine[]; error?: string }>
  /**
   * Where a file you dropped on or picked for the console lives, so an agent can be told to read
   * it. Only works on a `File` the page got from a drop or the file picker, which is a file you
   * chose; it cannot name any other file. Empty when there is no path (a file made in the page).
   */
  pathForFile(file: File): string
  /**
   * Called when a notification about a run is clicked: the interface opens that run. Returns an
   * unsubscribe function, like `onSnapshot`.
   */
  onFocusRun(listener: (runId: string) => void): () => void
  /**
   * Bring Terminal to the front, where an agent that needs you is waiting. The Grove never answers
   * for it; this only takes you to where you can.
   */
  focusTerminal(): Promise<void>
  /** What uninstalling would do on this Mac, so the confirmation can list it before anything happens. */
  planUninstall(): Promise<UninstallPlan>
  /**
   * Uninstall the Grove, then quit. Everything goes to the Trash rather than being deleted, so any
   * of it can be put back. Your project folders, and Claude Code and Codex themselves, are never touched.
   */
  uninstall(options: { removeGrove: boolean }): Promise<{ ok: boolean; error?: string }>
}

export interface UninstallPlan {
  /** The Grove's lines are in Claude Code's settings and will be taken out. */
  hooks: boolean
  /** The app bundle that will go to the Trash, or `null` when running from source. */
  appPath: string | null
  /** Your grove: projects list, agents, settings and backups. Kept unless you choose otherwise. */
  grovePath: string
}

/** What pressing "Check now" for Claude's limits did. */
export interface LimitsCheck {
  ok: boolean
  /** Tokens the check itself used, as Claude Code reported them. */
  tokens?: number
  error?: string
}

/** What the "Get ready" button did. */
export interface ReadyResult {
  ok: boolean
  /** Terminal opened to install or sign in, or the tool's page when it cannot be installed here. */
  opened?: 'terminal' | 'page'
  /** Live updates were turned on on the way. */
  liveUpdates?: boolean
  error?: string
}

export interface RunResult {
  ok: boolean
  runId?: string
  error?: string
  /** Set when the tool's command is not installed, so the interface can offer its one-button setup. */
  missing?: SetupTool
}

export interface AgentResult {
  ok: boolean
  id?: string
  error?: string
}

/** `cancelled` when the person closed the picker, which is a choice, not a failure. */
export interface ProjectResult {
  ok: boolean
  cancelled?: boolean
  error?: string
}

/** The IPC channel names, in one place so the two sides cannot disagree about a string. */
export const CHANNELS = {
  snapshot: 'grove:snapshot',
  refresh: 'grove:refresh',
  openSession: 'grove:open-session',
  revealGroveFile: 'grove:reveal-grove-file',
  captureStill: 'grove:capture-still',
  connectSuggested: 'grove:connect-suggested',
  browseProject: 'grove:browse-project',
  createProject: 'grove:create-project',
  removeProject: 'grove:remove-project',
  addAgent: 'grove:add-agent',
  updateAgent: 'grove:update-agent',
  removeAgent: 'grove:remove-agent',
  setAgentModel: 'grove:set-agent-model',
  carveNote: 'grove:carve-note',
  readNote: 'grove:read-note',
  carveRune: 'grove:carve-rune',
  removeRune: 'grove:remove-rune',
  declineRune: 'grove:decline-rune',
  runRune: 'grove:run-rune',
  openAgentLink: 'grove:open-agent-link',
  planHooks: 'grove:plan-hooks',
  applyHooks: 'grove:apply-hooks',
  openProjectFolder: 'grove:open-project-folder',
  saveSettings: 'grove:save-settings',
  checkForUpdates: 'grove:check-for-updates',
  checkClaudeLimits: 'grove:check-claude-limits',
  openRelease: 'grove:open-release',
  setUpTool: 'grove:set-up-tool',
  getReady: 'grove:get-ready',
  browseSubProject: 'grove:browse-sub-project',
  getApp: 'grove:get-app',
  planUninstall: 'grove:plan-uninstall',
  uninstall: 'grove:uninstall',
  launchRun: 'grove:launch-run',
  resumeRun: 'grove:resume-run',
  readTranscript: 'grove:read-transcript',
  focusRun: 'grove:focus-run',
  focusTerminal: 'grove:focus-terminal',
} as const
