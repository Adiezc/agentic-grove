/**
 * Settings as the interface sees them: what `grove.json` says, plus any change you have just made
 * that the node side has not confirmed yet.
 *
 * The confirmed values arrive with the next snapshot, a moment after saving. Holding the change here
 * until then is what stops a switch flicking back for a second after you press it. Once the
 * snapshot agrees, the held value is dropped, so a later hand edit of `grove.json` always wins.
 *
 * In a plain browser tab there is no node side to save to, so changes live here for the session.
 */
import { create } from 'zustand'
import { defaultSettings, type GroveSettings } from '../../core/state/schema.ts'
import { useGrove } from './grove'

interface Pending {
  patch: Partial<GroveSettings>
  error: string | null
}

const usePending = create<Pending>(() => ({ patch: {}, error: null }))

// Drop each held value as soon as the file agrees with it.
useGrove.subscribe((state) => {
  const confirmed = state.snapshot?.settings
  if (!confirmed) return
  const { patch } = usePending.getState()
  const still = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => confirmed[key as keyof GroveSettings] !== value)
  ) as Partial<GroveSettings>
  if (Object.keys(still).length !== Object.keys(patch).length) usePending.setState({ patch: still })
})

const DEFAULTS = defaultSettings()

export function useSettings(): GroveSettings {
  const confirmed = useGrove((state) => state.snapshot?.settings)
  const patch = usePending((state) => state.patch)
  return { ...DEFAULTS, ...confirmed, ...patch }
}

export function useSettingsError(): string | null {
  return usePending((state) => state.error)
}

export async function saveSettings(patch: Partial<GroveSettings>): Promise<void> {
  usePending.setState((state) => ({ patch: { ...state.patch, ...patch }, error: null }))
  if (!window.grove) return
  const result = await window.grove.saveSettings(patch)
  if (!result.ok) {
    // Put the switch back where the file has it, and say why.
    usePending.setState((state) => {
      const next = { ...state.patch }
      for (const key of Object.keys(patch)) delete next[key as keyof GroveSettings]
      return { patch: next, error: result.error ?? 'Could not save that' }
    })
  }
}
