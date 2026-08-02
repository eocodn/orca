import { translate } from '@/i18n/i18n'
import { ActiveSettingsSectionProvider } from './SettingsSection'
import { SettingsPagePrimarySections } from './settings-page-primary-sections'
import { SettingsPageSecondarySections } from './settings-page-secondary-sections'
import { SettingsPageProjectSections } from './settings-page-project-sections'

export function SettingsPageSectionList({
  context
}: {
  context: Record<string, any>
}): React.JSX.Element {
  const {
    visibleNavSections,
    settingsSearchQuery,
    activeSectionId
  } = context

  if (visibleNavSections.length === 0) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 text-sm text-muted-foreground">
        {translate('auto.components.settings.Settings.3c88ec55d6', 'No settings found for "')}
        {settingsSearchQuery.trim()}
        {translate('auto.components.settings.Settings.add3b97ee6', '"')}
      </div>
    )
  }

  return (
    <ActiveSettingsSectionProvider value={activeSectionId}>
      <SettingsPagePrimarySections context={context} />
      <SettingsPageSecondarySections context={context} />
      <SettingsPageProjectSections context={context} />
    </ActiveSettingsSectionProvider>
  )
}