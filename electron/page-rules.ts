/**
 * The pure parts of the window's walls (see `security.ts`): the content security policy, which
 * addresses count as the Grove's own page, and which links may go to the system opener. Kept
 * free of Electron so the build (`vite.config.ts`) and `npm run verify:security` can load them.
 */
import { pathToFileURL } from 'node:url'

/**
 * What the built page may load. `'self'` is the app's own files.
 *
 *   - `blob:` and `data:` images: three.js unpacks the tree model's textures into blob URLs, and
 *     the rune labels are drawn on canvases.
 *   - `'unsafe-inline'` styles: the interface sets inline styles throughout (React `style`, the
 *     animation library). Style cannot run code, so this is the usual, accepted trade.
 *   - `connect-src 'self' blob: data:`: the page reads its own model file and nothing else; no
 *     address on the internet is reachable from the page.
 *
 * Not applied to the development server, whose hot reloading needs looser rules.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** The schemes a session can be handed back to its tool by. Each adapter checks its own ids too. */
const APP_SCHEMES = new Set(['claude:', 'codex:', 'cursor:'])

export function isAppLink(link: unknown): link is string {
  if (typeof link !== 'string') return false
  try {
    return APP_SCHEMES.has(new URL(link).protocol)
  } catch {
    return false
  }
}

/**
 * Is this address the Grove's own page? The development server's page in development, the
 * bundled `index.html` otherwise. Anything after the page itself (a `#` or `?`) is ignored.
 */
export function isOwnPage(address: string | undefined, devServerUrl: string | undefined, pageFile: string): boolean {
  if (!address) return false
  try {
    const url = new URL(address)
    if (devServerUrl) return url.origin === new URL(devServerUrl).origin
    const own = pathToFileURL(pageFile)
    return url.protocol === 'file:' && decodeURIComponent(url.pathname) === decodeURIComponent(own.pathname)
  } catch {
    return false
  }
}
