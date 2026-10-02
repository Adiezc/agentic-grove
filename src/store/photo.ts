/**
 * Photo mode: the interface steps aside so the grove can be framed and saved as an image.
 *
 * Held in a store of its own, like the flow, because both halves need it: the scene loosens the
 * camera, adds depth of field and takes the picture; the interface hides itself and shows the
 * three controls. Nothing here is saved to `grove.json`: it is a moment, not a setting.
 */
import { create } from 'zustand'

interface Photo {
  on: boolean
  /** Depth of field, 0 (everything sharp) to 1 (only the point you are looking at). */
  depth: number
  /** Counts presses of Save. The scene takes a picture each time it goes up. */
  shots: number
  /** True from pressing Save until the image has been handed over. */
  saving: boolean
  /** Why the last picture could not be taken, if it could not. */
  error: string | null
  enter(): void
  leave(): void
  setDepth(depth: number): void
  save(): void
  saved(error?: string): void
}

export const usePhoto = create<Photo>((set) => ({
  on: false,
  depth: 0,
  shots: 0,
  saving: false,
  error: null,
  enter: () => set({ on: true, error: null }),
  leave: () => set({ on: false, saving: false, error: null }),
  setDepth: (depth) => set({ depth: Math.max(0, Math.min(1, depth)) }),
  save: () => set((state) => (state.saving ? state : { shots: state.shots + 1, saving: true, error: null })),
  saved: (error) => set({ saving: false, error: error ?? null }),
}))
