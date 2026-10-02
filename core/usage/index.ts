/**
 * Everything the crystal knows about usage, in one report.
 *
 * Runs on its own slower timer rather than inside the scan. The scan has to be quick because it
 * runs every few seconds all day; usage moves by the minute, and the first pass reads a week of
 * transcripts. A provider that fails costs its own figures and nothing else, the same rule the
 * harness adapters follow.
 */
import { claudeUsage } from './claude.ts'
import { codexUsage } from './codex.ts'
import { withOfficial, type ClaudeReading } from './probe.ts'
import type { ProviderUsage, UsageReport } from './types.ts'

/** `claudeReading` is the last press of "Check now", if there was one; see `probe.ts`. */
export async function usage(now = Date.now(), claudeReading: ClaudeReading | null = null): Promise<UsageReport> {
  const claude = claudeUsage(now).then((counted) => withOfficial(counted, claudeReading, now))
  const results = await Promise.allSettled([claude, codexUsage(now)])
  const providers = results
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter((provider): provider is ProviderUsage => provider !== null)
  return { at: now, providers }
}

/** Refresh every `intervalMs`, one pass at a time. Returns a stop function. */
export function startUsageLoop(
  onReport: (report: UsageReport) => void,
  intervalMs = 60_000,
  claudeReading: () => ClaudeReading | null = () => null
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    const report = await usage(Date.now(), claudeReading()).catch(() => null)
    if (stopped) return
    if (report) onReport(report)
    timer = setTimeout(() => void tick(), intervalMs)
  }
  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
