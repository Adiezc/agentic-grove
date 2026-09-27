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
  /** The agents you have connected to the tree, as `grove.json` has them. Researcher is not listed. */
  agents: AgentDefinition[]
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
  connectSuggested(folder: string): Promise<ProjectResult>
  /** Pick an existing folder with the system folder picker. */
  browseProject(): Promise<ProjectResult>
  /** Name a new folder with the system save panel; it is created, then added. */
  createProject(): Promise<ProjectResult>

  /**
   * Grow an agent on the tree. The node side makes the id and checks every field with the same
   * rules as a hand-typed `grove.json` entry, so page code cannot write anything the loader would
   * refuse. Resolves with the new id, so the interface can turn to face it.
   */
  addAgent(draft: AgentDraft): Promise<AgentResult>
  /** Take one of your agents off the tree. Researcher cannot be removed. */
  removeAgent(id: string): Promise<AgentResult>
  /**
   * Open a Grok Bot in the browser. Takes the agent's id, not a URL: the node side looks the link
   * up in `grove.json` itself, so page code never chooses what the system opener is handed.
   */
  openAgentLink(id: string): Promise<AgentResult>
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
  addAgent: 'grove:add-agent',
  removeAgent: 'grove:remove-agent',
  openAgentLink: 'grove:open-agent-link',
} as const
