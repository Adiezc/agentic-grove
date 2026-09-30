/**
 * macOS notifications for runs, as decided by `core/attention.ts`.
 *
 * Silent, always: the brief's default is no sound, and a notification that chimes is a different
 * thing to leave running all day. Nothing is shown while a Grove window is in front, because the
 * grove is already saying it. Clicking one brings the Grove forward on that run.
 *
 * Each notification is held in a set until it is clicked or closed. Electron lets an unreferenced
 * notification be garbage collected, and one collected before it is clicked loses its click.
 */
import { BrowserWindow, Notification } from 'electron'
import type { Notice } from '../core/attention.ts'

const showing = new Set<Notification>()

export function notify(notice: Notice, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const inFront = BrowserWindow.getAllWindows().some((window) => window.isVisible() && window.isFocused())
  if (inFront) return
  const notification = new Notification({ title: notice.title, body: notice.body, silent: true })
  showing.add(notification)
  notification.on('click', () => {
    showing.delete(notification)
    onClick()
  })
  notification.on('close', () => showing.delete(notification))
  notification.show()
}
