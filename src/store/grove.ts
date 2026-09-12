/**
 * The renderer's single source of truth: whatever the node side last told us.
 *
 * Zustand rather than React context or a pile of `useState`, per the brief, and it earns its
 * place here for a specific reason: the grove scene will eventually read this from inside a
 * `requestAnimationFrame` loop, where a context re-render on every snapshot would be felt. A
 * store lets the scene subscribe to the one field it cares about.
 *
 * There is deliberately no fetching, merging or deriving in here. Every stone was worked out on
 * the node side by `core/state/stones.ts`, which can be tested without a browser. This file is a
 * mailbox, and keeping it that dull is what stops the same rule existing in two places with two
 * answers.
 */
import { create } from 'zustand'
import type { GroveApi, GroveSnapshot } from '../../electron/bridge.ts'

declare global {
  interface Window {
    /**
     * Absent when the page is opened in a plain browser rather than through Electron — which
     * happens every time someone visits the Vite dev server directly. Typed as possibly
     * undefined so that case has to be handled rather than crashing on load.
     */
    grove?: GroveApi
  }
}

interface GroveStore {
  snapshot: GroveSnapshot | null
  /** True until the first snapshot arrives. Distinguishes "still looking" from "nothing found". */
  loading: boolean
  /** Set when there is no bridge at all — see `window.grove` above. */
  bridgeMissing: boolean
  /** Begin listening. Returns the unsubscribe function, for React's cleanup. */
  connect: () => () => void
  refresh: () => void
}

export const useGrove = create<GroveStore>((set) => ({
  snapshot: null,
  loading: true,
  bridgeMissing: false,

  connect: () => {
    const api = window.grove
    if (!api) {
      set({ loading: false, bridgeMissing: true })
      return () => {}
    }
    return api.onSnapshot((snapshot) => set({ snapshot, loading: false }))
  },

  refresh: () => {
    void window.grove?.refresh()
  },
}))
