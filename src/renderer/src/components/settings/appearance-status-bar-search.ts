import type { StatusBarItem } from '../../../../shared/types'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

type StatusBarToggle = {
  id: StatusBarItem
  title: string
  description: string
  keywords: string[]
  toggleDescription: string
}

const genericToggle = (id: StatusBarItem, title: string, description: string, keyword: string, toggleDescription: string): StatusBarToggle => ({
  id,
  title,
  description,
  keywords: [
    ...translateSearchKeyword('auto.components.settings.appearance.search.896eb53fd4', 'status bar'),
    keyword
  ],
  toggleDescription
})

export const getStatusBarToggles = createLocalizedCatalog(
  (): readonly StatusBarToggle[] => [
    genericToggle(
      'ssh',
      translate('auto.components.settings.appearance.search.57fb424c56', 'Remote Hosts'),
      translate('auto.components.settings.appearance.search.f17d66d0d2', 'Show remote host connection status in the status bar.'),
      'remote hosts',
      translate('settings.appearance.statusBar.sshToggleDescription', 'Show configured SSH and remote Orca hosts when available.')
    ),
    genericToggle(
      'resource-usage',
      translate('auto.components.settings.appearance.search.7cf005b29f', 'Resource Manager'),
      translate('auto.components.settings.appearance.search.81ef5abc2f', 'Show CPU, memory, terminal sessions, and workspace disk usage in the status bar.'),
      'resource manager',
      translate('settings.appearance.statusBar.resourceUsageToggleDescription', 'Show the Resource Manager.')
    ),
    genericToggle(
      'ports',
      translate('auto.components.settings.appearance.search.cf409b6c4d', 'Ports'),
      translate('auto.components.settings.appearance.search.0ececfa190', 'Show live workspace ports in the status bar.'),
      'ports',
      translate('settings.appearance.statusBar.portsToggleDescription', 'Show live workspace ports.')
    )
  ]
)
