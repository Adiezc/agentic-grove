/**
 * The menu-bar shard: the crystal, small enough to live beside the clock.
 *
 * It exists so usage can be checked without bringing the Grove forward, and so the Grove keeps
 * listening after its window is closed. Click it for the same figures the crystal's readout
 * shows, worded by the same code (`core/usage/format.ts`), so the two can never disagree.
 *
 * **Quiet unless it has earned attention.** Normally it is just the hexagon. Only when an
 * official limit is nearly spent does text appear beside it, naming which one. A number in the
 * menu bar all day would be read a hundred times and mean something once.
 */
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { LOW_HEADROOM, WINDOW_NAME, figure, source, tightest } from '../core/usage/format.ts'
import type { UsageReport } from '../core/usage/types.ts'

export interface Shard {
  update(report: UsageReport | null): void
  destroy(): void
}

function usageItems(report: UsageReport | null): MenuItemConstructorOptions[] {
  if (!report) return [{ label: 'Reading usage…', enabled: false }]
  if (!report.providers.length) return [{ label: 'No usage records found', enabled: false }]
  const items: MenuItemConstructorOptions[] = []
  for (const provider of report.providers) {
    if (items.length) items.push({ type: 'separator' })
    // Disabled items are how macOS menus show information that is not an action.
    items.push({ label: `${provider.name}   ${source(provider, report.at)}`, enabled: false })
    for (const window of provider.windows) {
      items.push({ label: `    ${WINDOW_NAME[window.key]}   ${figure(window, report.at)}`, enabled: false })
    }
  }
  return items
}

/** Text beside the icon, only when an official limit is nearly spent. Otherwise nothing. */
function title(report: UsageReport | null): string {
  const tight = report ? tightest(report.providers) : null
  if (!tight || tight.window.usedPercent === null) return ''
  const left = 100 - tight.window.usedPercent
  return left < LOW_HEADROOM ? ` ${tight.provider.name} ${Math.round(left)}% left` : ''
}

export function createShard(iconPath: string, actions: { open: () => void; quit: () => void }): Shard {
  const icon = nativeImage.createFromPath(iconPath)
  // The file name ends in "Template", which already tells macOS to tint it; saying so again
  // costs nothing and survives a rename.
  icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip('Agentic Grove')

  const update = (report: UsageReport | null) => {
    tray.setTitle(title(report))
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...usageItems(report),
        { type: 'separator' },
        { label: 'Open the Grove', click: actions.open },
        { label: 'Quit', click: actions.quit },
      ])
    )
  }
  update(null)

  return { update, destroy: () => tray.destroy() }
}
