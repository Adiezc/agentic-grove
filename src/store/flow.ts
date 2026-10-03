/**
 * Where the viewer is in the grove's one interaction flow, and nothing else.
 *
 * The concept art's four frames are one journey: look at the grove, pick a stone, open the tree's
 * agents, send one to the stone. That journey is small enough to hold in one place, and keeping it
 * here rather than in `App` means the scene and the interface read the same answer without
 * passing it down through every component in between.
 *
 * **Deploying starts real work** (session nine). `deploy` asks the node side to open Terminal in
 * the stone's folder with the agent and the task, and the light flies while it does. Nothing here
 * claims the agent has started: the toast reads the run's state from the snapshot, which only
 * moves when Claude Code itself says a session exists. Demo stones still only animate.
 */
import { create } from 'zustand'
import type { SessionStatus } from '../../core/harnesses/types.ts'
import type { SetupTool } from '../../core/setup.ts'
import { DEMO } from '../demo'

/** The two tools the Grove can send an agent through. */
type Tool = 'claude-code' | 'codex'

/**
 *   home     the grove at rest, frame 1
 *   stone    one stone chosen, its panel open, frame 2
 *   agents   the camera inside the canopy, frame 3
 *   picking  an agent chosen with no stone yet: the next stone clicked receives it
 *   run      one run on the chosen stone: its task, state and live transcript
 */
export type FlowView = 'home' | 'stone' | 'agents' | 'picking' | 'run'

export interface Deployment {
  agentId: string
  stoneId: string
  /** `flight` while the light travels to the stone, `landed` for the moment after it arrives. */
  phase: 'flight' | 'landed'
  /** The run it started, once the node side has recorded one. */
  runId: string | null
  /** Why it could not start. The toast stays until dismissed, since a failure should not slip by. */
  error: string | null
  /** Which tool is not installed, when that is the reason, so the toast can offer its setup. */
  missing: SetupTool | null
}

interface FlowStore {
  view: FlowView
  /** The stone the panel is about, and the one "send to runestone" will target. */
  stoneId: string | null
  /** Which agent the canopy card is showing, by id, so it survives agents being added or removed. */
  agentId: string
  /** True while the grow form is open in place of the agent card. */
  growing: boolean
  /** The agent the form is changing, when it was opened to edit one rather than grow one. */
  editingId: string | null
  /** An agent waiting for a stone to be picked, in `picking` view. */
  pendingAgentId: string | null
  /** The task typed for it, carried until the stone is picked. */
  pendingTask: string
  /** Called once that task has really started, so the console can clear only then. */
  pendingOnSent: (() => void) | null
  /** The tool chosen for it in the console, if any. */
  pendingHarness: Tool | undefined
  /** The run the `run` view is showing. */
  runId: string | null
  deployment: Deployment | null
  /** Status a deployment has put on a stone, laid over the fixtures until real spawning exists. */
  statusOverrides: Record<string, SessionStatus>
  /** The empty circle whose create-or-connect menu is open. */
  placeIndex: number | null
  /**
   * What the arrow keys are resting on: a stone id, or `place-N` for an empty circle. Separate
   * from `stoneId`, because looking at a stone and choosing it are different acts, the same way
   * hovering and clicking are.
   */
  focused: string | null

  selectStone: (id: string) => void
  openAgents: () => void
  showAgent: (id: string) => void
  /** Open the grow form, from the bud in the canopy. */
  grow: () => void
  /** Open the same form on one of your agents, to change it. */
  edit: (id: string) => void
  /** Close the form; with an id, turn to face the agent that just grew. */
  grown: (id?: string) => void
  /**
   * Send an agent with a task to the chosen stone, or wait for one to be picked. `onSent` runs
   * once Terminal has been asked to open without error, which is when the console clears: a task
   * that failed to start stays where you typed it.
   */
  deploy: (agentId: string, task: string, onSent?: () => void, harness?: Tool) => void
  /** Choose the stone, then deploy: the console's way in, which may name a stone you are not looking at. */
  deployTo: (stoneId: string | null, agentId: string, task: string, onSent?: () => void, harness?: Tool) => void
  openRun: (id: string) => void
  land: () => void
  finish: () => void
  openPlace: (index: number) => void
  focus: (id: string | null) => void
  /** One step back: agents → stone → home → nothing focused. What Esc and the close buttons do. */
  back: () => void
}

export const useFlow = create<FlowStore>((set, get) => ({
  view: 'home',
  stoneId: null,
  agentId: 'manager',
  growing: false,
  editingId: null,
  pendingAgentId: null,
  pendingTask: '',
  pendingOnSent: null,
  pendingHarness: undefined,
  runId: null,
  deployment: null,
  statusOverrides: {},
  placeIndex: null,
  focused: null,

  // Choosing an empty circle closes any stone panel: one question on screen at a time.
  openPlace: (index) => {
    if (get().deployment) return
    set({ placeIndex: index, view: 'home', stoneId: null })
  },

  focus: (id) => set({ focused: id }),

  selectStone: (id) => {
    const { view, deployment, pendingAgentId } = get()
    // While a deployment is in flight the grove is showing you something; a stray click on
    // another stone should not yank the camera away from it.
    if (deployment) return
    set({ stoneId: id, placeIndex: null })
    // In picking mode the click *is* the target, so it goes straight to deploying.
    if (view === 'picking' && pendingAgentId) get().deploy(pendingAgentId, get().pendingTask, get().pendingOnSent ?? undefined, get().pendingHarness)
    else set({ view: 'stone' })
  },

  openAgents: () => set({ view: 'agents', growing: false, editingId: null }),

  showAgent: (id) => set({ agentId: id, growing: false, editingId: null }),

  grow: () => set({ view: 'agents', growing: true, editingId: null }),

  edit: (id) => set({ view: 'agents', growing: true, editingId: id }),

  grown: (id) => set((state) => ({ growing: false, editingId: null, agentId: id ?? state.agentId })),

  deploy: (agentId, task, onSent, harness) => {
    const { stoneId } = get()
    // No stone yet means the agents were opened from the rail. Go back out to the grove and let
    // the next stone clicked be the target, rather than guessing one.
    if (!stoneId) {
      set({ view: 'picking', pendingAgentId: agentId, pendingTask: task, pendingOnSent: onSent ?? null, pendingHarness: harness })
      return
    }
    set((state) => ({
      view: 'home',
      pendingAgentId: null,
      pendingTask: '',
      pendingOnSent: null,
      pendingHarness: undefined,
      deployment: { agentId, stoneId, phase: 'flight', runId: null, error: null, missing: null },
      // Demo stones are pretend, so there the deployment may light the stone for good. Real ones
      // light only when the scan or the hooks say work is happening.
      statusOverrides: DEMO ? { ...state.statusOverrides, [stoneId]: 'running' } : state.statusOverrides,
    }))
    if (DEMO || !window.grove) {
      onSent?.()
      return
    }
    const settle = (patch: Partial<Deployment>) => {
      const current = get().deployment
      // Only if this is still the deployment on screen; a dismissed one needs no answer.
      if (current && current.agentId === agentId && current.stoneId === stoneId) set({ deployment: { ...current, ...patch } })
    }
    window.grove
      .launchRun({ stoneId, agentId, task, harness })
      .then((result) => {
        if (result.ok) onSent?.()
        settle({ runId: result.runId ?? null, error: result.ok ? null : (result.error ?? 'It did not start'), missing: result.missing ?? null })
      })
      .catch((reason: unknown) => settle({ error: String(reason) }))
  },

  openRun: (id) => set({ view: 'run', runId: id }),

  deployTo: (stoneId, agentId, task, onSent, harness) => {
    if (get().deployment) return
    set({ stoneId, placeIndex: null })
    get().deploy(agentId, task, onSent, harness)
  },

  land: () => {
    const { deployment } = get()
    if (deployment) set({ deployment: { ...deployment, phase: 'landed' } })
  },

  finish: () => set({ deployment: null, stoneId: null }),

  back: () => {
    const { view, stoneId, placeIndex, growing } = get()
    if (placeIndex !== null) set({ placeIndex: null })
    else if (growing) set({ growing: false, editingId: null })
    else if (view === 'agents') set({ view: stoneId ? 'stone' : 'home' })
    else if (view === 'run') set({ view: stoneId ? 'stone' : 'home', runId: null })
    else if (view === 'home' && !stoneId) set({ focused: null })
    else set({ view: 'home', stoneId: null, pendingAgentId: null, pendingTask: '', pendingOnSent: null, pendingHarness: undefined })
  },
}))
