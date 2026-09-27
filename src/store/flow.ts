/**
 * Where the viewer is in the grove's one interaction flow, and nothing else.
 *
 * The concept art's four frames are one journey: look at the grove, pick a stone, open the tree's
 * agents, send one to the stone. That journey is small enough to hold in one place, and keeping it
 * here rather than in `App` means the scene and the interface read the same answer without
 * passing it down through every component in between.
 *
 * **Visual only, for now.** Deploying plays the whole animation and marks the stone as running,
 * but spawns nothing. The real spawn path is session nine; when it lands, `deploy` is the one
 * function that changes, and every screen above it stays as it is.
 */
import { create } from 'zustand'
import type { SessionStatus } from '../../core/harnesses/types.ts'

/**
 *   home     the grove at rest, frame 1
 *   stone    one stone chosen, its panel open, frame 2
 *   agents   the camera inside the canopy, frame 3
 *   picking  an agent chosen with no stone yet: the next stone clicked receives it
 */
export type FlowView = 'home' | 'stone' | 'agents' | 'picking'

export interface Deployment {
  agentId: string
  stoneId: string
  /** `flight` while the light travels to the stone, `landed` for the moment after it arrives. */
  phase: 'flight' | 'landed'
}

interface FlowStore {
  view: FlowView
  /** The stone the panel is about, and the one "send to runestone" will target. */
  stoneId: string | null
  /** Which agent the canopy card is showing, by id, so it survives agents being added or removed. */
  agentId: string
  /** True while the grow form is open in place of the agent card. */
  growing: boolean
  /** An agent waiting for a stone to be picked, in `picking` view. */
  pendingAgentId: string | null
  deployment: Deployment | null
  /** Status a deployment has put on a stone, laid over the fixtures until real spawning exists. */
  statusOverrides: Record<string, SessionStatus>
  /** The empty circle whose create-or-connect menu is open. */
  placeIndex: number | null

  selectStone: (id: string) => void
  openAgents: () => void
  showAgent: (id: string) => void
  /** Open the grow form, from the bud in the canopy. */
  grow: () => void
  /** Close the form; with an id, turn to face the agent that just grew. */
  grown: (id?: string) => void
  deploy: (agentId: string) => void
  land: () => void
  finish: () => void
  openPlace: (index: number) => void
  /** One step back: agents → stone → home. What Esc and the close buttons do. */
  back: () => void
}

export const useFlow = create<FlowStore>((set, get) => ({
  view: 'home',
  stoneId: null,
  agentId: 'researcher',
  growing: false,
  pendingAgentId: null,
  deployment: null,
  statusOverrides: {},
  placeIndex: null,

  // Choosing an empty circle closes any stone panel: one question on screen at a time.
  openPlace: (index) => {
    if (get().deployment) return
    set({ placeIndex: index, view: 'home', stoneId: null })
  },

  selectStone: (id) => {
    const { view, deployment, pendingAgentId } = get()
    // While a deployment is in flight the grove is showing you something; a stray click on
    // another stone should not yank the camera away from it.
    if (deployment) return
    set({ stoneId: id, placeIndex: null })
    // In picking mode the click *is* the target, so it goes straight to deploying.
    if (view === 'picking' && pendingAgentId) get().deploy(pendingAgentId)
    else set({ view: 'stone' })
  },

  openAgents: () => set({ view: 'agents', growing: false }),

  showAgent: (id) => set({ agentId: id, growing: false }),

  grow: () => set({ view: 'agents', growing: true }),

  grown: (id) => set((state) => ({ growing: false, agentId: id ?? state.agentId })),

  deploy: (agentId) => {
    const { stoneId } = get()
    // No stone yet means the agents were opened from the rail. Go back out to the grove and let
    // the next stone clicked be the target, rather than guessing one.
    if (!stoneId) {
      set({ view: 'picking', pendingAgentId: agentId })
      return
    }
    set((state) => ({
      view: 'home',
      pendingAgentId: null,
      deployment: { agentId, stoneId, phase: 'flight' },
      statusOverrides: { ...state.statusOverrides, [stoneId]: 'running' },
    }))
  },

  land: () => {
    const { deployment } = get()
    if (deployment) set({ deployment: { ...deployment, phase: 'landed' } })
  },

  finish: () => set({ deployment: null, stoneId: null }),

  back: () => {
    const { view, stoneId, placeIndex, growing } = get()
    if (placeIndex !== null) set({ placeIndex: null })
    else if (growing) set({ growing: false })
    else if (view === 'agents') set({ view: stoneId ? 'stone' : 'home' })
    else set({ view: 'home', stoneId: null, pendingAgentId: null })
  },
}))
