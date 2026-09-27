/**
 * Moving between stones with the arrow keys.
 *
 * The grove has no rows or columns, so "the next stone to the right" has to mean what it looks
 * like on screen. The camera faces the tree from +z, so ground x reads as left and right and
 * ground z as down (nearer) and up (further). An arrow picks the closest target in that
 * direction, and counts sideways drift double, so pressing right does not jump to a stone that
 * is mostly above you just because it is near.
 *
 * Targets are stones and empty circles alike: an empty circle is where a project is created, so
 * someone on the keyboard needs to reach it as much as any stone.
 */
export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Target {
  id: string
  at: [number, number]
}

const DIRECTION: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

/** Where the first press lands: the target nearest the front of the grove, closest to centre. */
function start(targets: Target[]): string | null {
  let best: Target | null = null
  for (const target of targets) {
    const score = Math.abs(target.at[0]) - target.at[1] * 2
    if (!best || score < Math.abs(best.at[0]) - best.at[1] * 2) best = target
  }
  return best?.id ?? null
}

/** The target to move to, or the current one when nothing lies that way. */
export function step(targets: Target[], from: string | null, direction: Direction): string | null {
  const current = targets.find((target) => target.id === from)
  if (!current) return start(targets)
  const [dx, dy] = DIRECTION[direction]
  let best: { id: string; score: number } | null = null
  for (const target of targets) {
    if (target.id === current.id) continue
    const x = target.at[0] - current.at[0]
    const y = target.at[1] - current.at[1]
    const along = x * dx + y * dy
    if (along <= 0.2) continue
    const across = Math.abs(x * dy - y * dx)
    const score = along + across * 2
    if (!best || score < best.score) best = { id: target.id, score }
  }
  return best?.id ?? current.id
}
