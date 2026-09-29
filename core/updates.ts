/**
 * Is there a newer Grove? One question to GitHub, at most once a day.
 *
 * **What is sent, and why that is all.** A single unauthenticated GET to GitHub's public releases
 * API for this repository. No identifier, no usage data, nothing about your projects: GitHub sees
 * an IP address asking about a public page, which is what any browser visiting the repo shows it.
 * The Grove's no-telemetry rule still holds, and README.md says this in plain words. The check can
 * be turned off in Settings, and it is skipped while the Mac is offline.
 *
 * **Why it does not install anything.** A self-updating Mac app has to be signed with a paid Apple
 * Developer certificate, or macOS refuses the new copy. The Grove is not signed (Adrian's call,
 * 30 September 2026), so the honest version is a notice with a download link. Your `grove.json`
 * lives in `~/.agentic-grove`, outside the app, so replacing the app never touches it.
 */

/** The repository whose releases are checked. Public once the Grove is. */
export const RELEASES_REPO = 'Adiezc/agentic-grove'
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000

export interface UpdateStatus {
  /**
   *   off        turned off in Settings
   *   unknown    not checked yet
   *   current    this is the newest release
   *   available  a newer release exists: `latest` and `url` say which
   *   offline    no connection, so not asked
   *   error      asked, and GitHub did not answer usefully (a private repo answers 404)
   */
  state: 'off' | 'unknown' | 'current' | 'available' | 'offline' | 'error'
  current: string
  latest?: string
  /** The release page. Always GitHub, never a URL taken from the response. */
  url?: string
  checkedAt?: number
  error?: string
}

/** "v0.2.10" and "0.2.9" compared as numbers, part by part. Anything unreadable counts as 0. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) =>
    version
      .replace(/^v/i, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parts(candidate)
  const b = parts(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** Ask GitHub for the latest release. Never throws; every failure is a status. */
export async function checkForUpdate(current: string, now = Date.now()): Promise<UpdateStatus> {
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agentic-grove' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { state: 'error', current, checkedAt: now, error: `GitHub answered ${response.status}` }
    }
    const body: unknown = await response.json()
    const tag = typeof body === 'object' && body !== null ? (body as { tag_name?: unknown }).tag_name : undefined
    if (typeof tag !== 'string') return { state: 'error', current, checkedAt: now, error: 'No version in the answer' }
    const latest = tag.replace(/^v/i, '')
    return isNewer(latest, current)
      ? { state: 'available', current, latest, url: RELEASES_PAGE, checkedAt: now }
      : { state: 'current', current, latest, checkedAt: now }
  } catch (error) {
    return { state: 'error', current, checkedAt: now, error: error instanceof Error ? error.message : String(error) }
  }
}
