import { cn } from '@/lib/utils'
import { SettingsSidebar } from './SettingsSidebar'
import { SettingsPageSectionList } from './settings-page-section-list'

export function SettingsPageRender({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    settings,
    repos,
    activeSectionId,
    generalNavGroups,
    repoNavSections,
    settingsSearchInputQuery,
    searchInputRef,
    closeSettingsPageWithPromptGuard,
    setSettingsSearchQuery,
    scrollToSection,
    setSettingsRootNode,
    setContentScrollNode,
    isFocusedShortcutsPane,
    isFocusedSetupGuidePane
  } = context

  return (
    <div
      ref={setSettingsRootNode}
      className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background"
    >
      <SettingsSidebar
        settings={settings}
        activeSectionId={activeSectionId}
        generalGroups={generalNavGroups}
        repoSections={repoNavSections}
        hasRepos={repos.length > 0}
        searchQuery={settingsSearchInputQuery}
        searchInputRef={searchInputRef}
        onBack={closeSettingsPageWithPromptGuard}
        onSearchChange={setSettingsSearchQuery}
        onSelectSection={scrollToSection}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={setContentScrollNode}
          className={cn(
            'min-h-0 flex-1',
            isFocusedShortcutsPane ? 'overflow-hidden' : 'overflow-y-auto scrollbar-sleek'
          )}
        >
          <div
            className={cn(
              'mx-auto flex w-full flex-col gap-10 px-8 pt-10',
              isFocusedShortcutsPane ? 'h-full pb-6' : 'pb-24',
              isFocusedSetupGuidePane ? 'max-w-6xl' : 'max-w-4xl'
            )}
          >
            <SettingsPageSectionList context={context} />
          </div>
        </div>
      </div>
    </div>
  )
}