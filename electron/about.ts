/** Native credits access, with fixed bundled documents and no renderer filesystem bridge. */
import { app, dialog, Menu, shell } from 'electron'
import path from 'node:path'

const documents = {
  credits: 'CREDITS.txt',
  licences: 'THIRD_PARTY_NOTICES.txt',
  electron: 'LICENSES.chromium.html',
} as const

export async function openCreditsDocument(document: keyof typeof documents): Promise<void> {
  const file = path.join(app.getAppPath(), 'dist', 'attribution', documents[document])
  const error = await shell.openPath(file).catch((reason: unknown) => String(reason))
  if (error) {
    await dialog.showMessageBox({
      type: 'error', title: 'Agentic Grove', message: 'This credits document could not be opened.',
      detail: app.isPackaged ? error : 'Run npm run build first. Electron notices are added when packaging the Mac app.',
    })
  }
}

let showing = false
export async function showAbout(): Promise<void> {
  if (showing) return
  showing = true
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info', title: 'About Agentic Grove', message: `Agentic Grove ${app.getVersion()}`,
      detail: 'A calm desktop grove for running and watching AI agents.\n\nBuilt by Adrian Diez Cuadrado, with thanks to bot-crossing and the open-source projects credited here.\n\nCredits explain what we use. Licences preserve the original notices, including the font. Electron notices cover the desktop runtime.',
      buttons: ['Close', 'Credits', 'Licences', 'Electron notices'], defaultId: 0, cancelId: 0,
      noLink: true,
    })
    const document = (['credits', 'licences', 'electron'] as const)[response - 1]
    if (document) await openCreditsDocument(document)
  } finally {
    showing = false
  }
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Agentic Grove', submenu: [
        { label: 'About Agentic Grove', click: () => { void showAbout() } },
        { label: 'Credits', click: () => { void openCreditsDocument('credits') } },
        { label: 'Third-party licences', click: () => { void openCreditsDocument('licences') } },
        { label: 'Electron notices', click: () => { void openCreditsDocument('electron') } },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
}
