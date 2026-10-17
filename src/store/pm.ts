/**
 * Whether PM's chat panel is open. The conversation itself arrives with every snapshot
 * (`snapshot.pm`); only this choice of yours lives in the page.
 */
import { create } from 'zustand'

interface PmPanel {
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
}

export const usePmPanel = create<PmPanel>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))
