/** One owner signal feeds filament shading and junction lights. */
export interface MyceliumSignal { active: number; attention: number; grow: number; beat: number; time: number }

export function ownerPhase(owner: string | null): number {
  let hash = 2166136261
  for (const char of owner ?? 'grove') hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) / 4294967296
}

export function junctionBrightness(at: number, state: MyceliumSignal): number {
  if (state.grow < 1 && at > state.grow * 1.2) return 0
  const d = at - (state.time % 1)
  const core = Math.exp(-((d * 24) ** 2))
  return Math.min(1, 0.16 + state.beat * 0.18 + state.active * (0.12 + core * 0.65))
}
