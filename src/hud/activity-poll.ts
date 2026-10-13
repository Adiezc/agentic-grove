/** One outstanding read; closing or changing the panel makes late replies irrelevant. */
import type { ActivityResult } from '../../core/activity-access.ts'

export function pollActivity(read: () => Promise<ActivityResult>, receive: (result: ActivityResult) => void, interval = 2500): () => void {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    let result: ActivityResult
    try { result = await read() } catch { result = { ok: false, error: 'Recorded activity could not be read.' } }
    if (!alive) return
    receive(result)
    if (alive) timer = setTimeout(() => { void tick() }, interval)
  }
  void tick()
  return () => { alive = false; clearTimeout(timer) }
}
