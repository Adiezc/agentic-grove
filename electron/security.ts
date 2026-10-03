/**
 * The walls round the Grove's window, in one place so they can be read and checked together.
 *
 * The window runs page code: React, three.js and our own interface. None of it should ever be
 * able to reach the Mac except through the bridge in `preload.ts`, and the bridge only does what
 * each handler in `main.ts` allows. That is already true because the page has no node access
 * (`contextIsolation` on, `nodeIntegration` off). The rules here are for the day something goes
 * wrong anyway, say a bug that lets a project name or a transcript line be treated as HTML. They
 * make sure that such a slip still cannot load code from the internet, open a web page inside
 * the app, or call the bridge from anywhere but the Grove's own page:
 *
 *   1. **A content security policy** (`page-rules.ts`), written into the built page by
 *      `vite.config.ts`: scripts, styles and fonts only from the app itself, and no network at all
 *      from the page. The Grove's own network calls (the update check) happen on the node side.
 *   2. **No new windows and no navigation away.** A link or a script can neither open a window nor
 *      turn the Grove's window into some other page. Links meant for your browser go through
 *      `shell.openExternal` on the node side, after their own checks.
 *   3. **No permissions.** Camera, microphone, location, notifications from the page: all refused.
 *      The Grove's notifications come from the node side (`notify.ts`).
 *   4. **Only the Grove's page may use the bridge** (`isOwnPage`, checked on every message).
 *   5. **Only app links go to the system opener** (`isAppLink`): the `claude://`, `codex://` and
 *      `cursor://` links that hand a session back to its tool, and nothing else.
 *
 * Electron's own checklist for all of this: https://www.electronjs.org/docs/latest/tutorial/security
 */
import { app, session, type WebContents } from 'electron'
import { isOwnPage } from './page-rules.ts'

export { CONTENT_SECURITY_POLICY, isAppLink, isOwnPage } from './page-rules.ts'

/** Apply rules 2 and 3 to every page the app ever makes. Call once, before the first window. */
export function lockDownPages(devServerUrl: string | undefined, pageFile: string): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, address) => {
      // Reloading the Grove's own page is fine (and is what hot reloading does in development).
      if (!isOwnPage(address, devServerUrl, pageFile)) event.preventDefault()
    })
    contents.on('will-redirect', (event, address) => {
      if (!isOwnPage(address, devServerUrl, pageFile)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
