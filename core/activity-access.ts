/** The page may select known stone/session IDs, never a transcript path. */
import type { ActivityDetail } from './activity.ts'
import type { HarnessAdapter, Session } from './harnesses/types.ts'

export type ActivityResult = { ok: true; detail: ActivityDetail | null; unavailable?: string } | { ok: false; error: string }
export async function selectedActivity(
  stones: { id: string; sessions: Session[] }[], stoneId: unknown, sessionId: unknown,
  lookup: (id: string) => HarnessAdapter | null,
): Promise<ActivityResult> {
  if (typeof stoneId !== 'string' || typeof sessionId !== 'string' || stoneId.length > 4096 || sessionId.length > 160) return { ok: false, error: 'Choose a known session on this stone.' }
  const session = stones.find((stone) => stone.id === stoneId)?.sessions.find((session) => session.id === sessionId)
  if (!session) return { ok: false, error: 'This session is no longer on the selected stone.' }
  const adapter = lookup(session.harness)
  if (!adapter?.readActivity) return { ok: true, detail: null, unavailable: 'This provider does not expose tool details here yet.' }
  try {
    const detail = await adapter.readActivity(session.id)
    return { ok: true, detail, ...(!detail ? { unavailable: 'No readable transcript evidence is available for this session.' } : {}) }
  } catch { return { ok: false, error: 'Recorded activity could not be read.' } }
}
