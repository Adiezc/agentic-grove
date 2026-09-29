/**
 * How busy the Mac is, so the grove can step its graphics down when you need the machine.
 *
 * CPU only drives that decision. Memory is reported but deliberately not acted on: macOS keeps
 * free memory near zero on purpose (it fills spare memory with cache), so "free memory is low" is
 * the normal state of a healthy Mac and would make the grove look busy all day.
 *
 * The figure is the whole machine's CPU, not the Grove's own share. The point is to give the Mac
 * back when *you* are working hard in something else, which the Grove's own figure cannot see.
 */
import os from 'node:os'

export interface SystemLoad {
  /** Share of all CPU cores busy since the last sample, 0 to 100. */
  cpu: number
  /** Share of memory in use, 0 to 100, cache included. For display, not decisions. */
  memory: number
}

interface Totals {
  idle: number
  total: number
}

function totals(): Totals {
  let idle = 0
  let total = 0
  for (const core of os.cpus()) {
    const { user, nice, sys, irq, idle: rest } = core.times
    idle += rest
    total += user + nice + sys + irq + rest
  }
  return { idle, total }
}

let last = totals()

/** CPU busy since the previous call. The first call after launch measures from module load. */
export function sampleLoad(): SystemLoad {
  const now = totals()
  const total = now.total - last.total
  const idle = now.idle - last.idle
  last = now
  const cpu = total > 0 ? Math.round(100 * (1 - idle / total)) : 0
  const memory = Math.round(100 * (1 - os.freemem() / os.totalmem()))
  return { cpu: Math.max(0, Math.min(100, cpu)), memory }
}
