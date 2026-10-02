/**
 * The answer the tree is giving, if it is giving one. See `core/history.ts`.
 *
 * In a store because two places need it: the console shows the words, and the scene lights the
 * stones involved, one after another, in the order you worked on them.
 */
import { create } from 'zustand'
import type { Answer } from '../../core/history.ts'

interface AnswerStore {
  answer: Answer | null
  /** How many projects were on the grove when it was asked, for the wording of an empty answer. */
  stonesOnGrove: number
  /** The stone being named right now, while the answer is read out. */
  lit: string | null
  show(answer: Answer, stonesOnGrove: number): void
  light(id: string | null): void
  clear(): void
}

export const useAnswer = create<AnswerStore>((set) => ({
  answer: null,
  stonesOnGrove: 0,
  lit: null,
  show: (answer, stonesOnGrove) => set({ answer, stonesOnGrove, lit: null }),
  light: (lit) => set({ lit }),
  clear: () => set({ answer: null, lit: null }),
}))
