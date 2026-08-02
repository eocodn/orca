// Concrete settings page view and orchestration.
// Concrete surface implementation for Settings.tsx
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import { GeneralPane } from './GeneralPane'
import { BrowserPane } from './BrowserPane'
import { AppearancePane } from './AppearancePane'
import { InputPane } from './InputPane'
import { ShortcutsPane } from './ShortcutsPane'
import { TerminalPane } from './TerminalPane'
import { FloatingWorkspacePane } from './FloatingWorkspacePane'
import { RepositoryPane } from './RepositoryPane'
import { GitPane } from './GitPane'
import { CommitMessageAiPane } from './CommitMessageAiPane'
import { GitProviderApiBudgetPane } from './GitProviderApiBudgetPane'
import { NotificationsPane } from './NotificationsPane'
import { VoicePane } from './VoicePane'
import { SshPane } from './SshPane'
import { ExperimentalPane } from './ExperimentalPane'
import { PluginsSettingsSection } from './PluginsSettingsSection'
import { AgentsPane } from './AgentsPane'
import { OrchestrationPane } from './OrchestrationPane'
import { LinearAgentSkillPane } from './LinearAgentSkillPane'
import { AccountsPane } from './AccountsPane'
import { StatsPane } from '../stats/StatsPane'
import { IntegrationsPane } from './IntegrationsPane'
import { TasksPane } from './TasksPane'
import { QuickCommandsPane } from './QuickCommandsPane'
import { DeveloperPermissionsPane } from './DeveloperPermissionsPane'
import { ComputerUsePane } from './ComputerUsePane'
import { MobileSettingsPane } from './MobileSettingsPane'
import { MobileEmulatorSettingsPane } from './MobileEmulatorSettingsPane'
import { RuntimeEnvironmentsPane } from './RuntimeEnvironmentsPane'
import { PrivacyPane } from './PrivacyPane'
import { AdvancedPane } from './AdvancedPane'
import { SettingsSidebar } from './SettingsSidebar'
import { SettingsSetupGuidePane } from './SettingsSetupGuidePane'
import { ActiveSettingsSectionProvider, SettingsSection } from './SettingsSection'
import { cn } from '@/lib/utils'
import {
  isWebClientLocation,
  useSettingsNavigationMetadata
} from '@/hooks/useSettingsNavigationMetadata'
import { translate } from '@/i18n/i18n'
import { getRepoHostIdentity } from '../../store/slices/repo-host-identity'
import {
  buildRepoIdToHostSelection,
  buildRepoIdToRepresentative,
  buildSettingsProjectList,
  getSettingsProjectHostRepo,
  getSettingsTargetHostSelection,
  removeSettingsProjectFromAllHosts,
  resolveSettingsTargetRepoId
} from './settings-project-list'

import {
  DevToolsPane,
  SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID,
  SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS,
  getSettingsSectionId,
  getFallbackVisibleSection,
  getSettingsNavGroupDefinitionsForSearch,
  hasReadyVoiceModel,
  getSettingsScrollTarget,
  scrollSubsectionIntoView,
  readSourceControlAiSettings,
  cancelPendingSettingsSubsectionScrollFrame,
  isEditableTarget
} from './settings-navigation-model'

export function SettingsPageRender({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    settings,
    updateSettings,
    updateSettingsOrThrow,
    setActiveRuntimeEnvironmentPreference,
    repos,
    updateProject,
    updateRepo,
    removeProject,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    settingsSearchInputQuery,
    settingsSearchQuery,
    setSettingsSearchQuery,
    settingsProjectList,
    removeProjectAllHosts,
    repoHooksMap,
    systemPrefersDark,
    isMac,
    isWebClient,
    showDesktopOnlySettings,
    linearConnected,
    scrollbackMode,
    setScrollbackMode,
    ghostty,
    warpThemes,
    fontSuggestions,
    terminalFontSuggestions,
    activeSectionId,
    quickCommandAddIntentSignal,
    sshHostAddIntentSignal,
    remoteServerAddIntentSignal,
    setHasUnsavedCommitPromptChanges,
    hasUnsavedBranchPromptChanges,
    setHasUnsavedBranchPromptChanges,
    sourceControlAiPromptDiscardSignal,
    hiddenExperimentalUnlocked,
    searchInputRef,
    hasUnsavedSourceControlAiPromptChanges,
    writeSourceControlAiSettings,
    setSettingsRootNode,
    setContentScrollNode,
    requestFontSuggestions,
    closeSettingsPageWithPromptGuard,
    generalNavGroups,
    repoNavSections,
    isSectionMounted,
    isFocusedShortcutsPane,
    isFocusedSetupGuidePane,
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
            {visibleNavSections.length === 0 ? (
              <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 text-sm text-muted-foreground">
                {translate(
                  'auto.components.settings.Settings.3c88ec55d6',
                  'No settings found for "'
                )}
                {settingsSearchQuery.trim()}
                {translate('auto.components.settings.Settings.add3b97ee6', '"')}
              </div>
            ) : (
              <ActiveSettingsSectionProvider value={activeSectionId}>
                <SettingsSection
                  id="agents"
                  title={translate('auto.components.settings.Settings.8afa676615', 'Agents')}
                  description={translate(
                    'auto.components.settings.Settings.ec1ba547f7',
                    'Manage AI agents, set a default, and customize commands.'
                  )}
                  searchEntries={getSectionSearchEntries('agents')}
                >
                  {isSectionMounted('agents') ? (
                    <AgentsPane
                      settings={settings}
                      updateSettings={updateSettings}
                      wslSupportedPlatform={localWslSupportedPlatform}
                      wslAvailable={localWindowsRuntimeCapabilities.wslAvailable}
                      wslDistros={localWindowsRuntimeCapabilities.wslDistros}
                      wslCapabilitiesLoading={localWindowsRuntimeCapabilities.isLoading}
                    />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="accounts"
                  title={translate(
                    'auto.components.settings.Settings.ad6c529693',
                    'AI Provider Accounts'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.21f09426ea',
                    'Optional. Orca works with your existing provider logins; add accounts only if you want Orca to help switch between them.'
                  )}
                  badge={translate(
                    'auto.hooks.useSettingsNavigationMetadata.7c79d3b7bf',
                    'Optional'
                  )}
                  searchEntries={getSectionSearchEntries('accounts')}
                >
                  {isSectionMounted('accounts') ? (
                    <AccountsPane
                      settings={settings}
                      updateSettings={updateSettings}
                      wslSupportedPlatform={runtimeWslSupportedPlatform}
                      wslAvailable={windowsTerminalCapabilities.wslAvailable}
                      wslDistros={windowsTerminalCapabilities.wslDistros}
                      wslCapabilitiesLoading={windowsTerminalCapabilities.isLoading}
                      accountOwnerPlatform={windowsTerminalCapabilities.hostPlatform}
                    />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="orchestration"
                  title={translate('auto.components.settings.Settings.00c3a7950d', 'Orchestration')}
                  description={translate(
                    'auto.components.settings.Settings.475980f53d',
                    'Coordinate multiple coding agents through Orca.'
                  )}
                  searchEntries={getSectionSearchEntries('orchestration')}
                >
                  {isSectionMounted('orchestration') ? <OrchestrationPane /> : null}
                </SettingsSection>

                {linearConnected ? (
                  <SettingsSection
                    id="linear"
                    title={translate('auto.components.settings.Settings.linearTitle', 'Linear')}
                    description={translate(
                      'auto.components.settings.Settings.linearDescription',
                      'How Linear works in Orca, setup checklist, agent skill, and example prompts.'
                    )}
                    searchEntries={getSectionSearchEntries('linear')}
                  >
                    {isSectionMounted('linear') ? <LinearAgentSkillPane /> : null}
                  </SettingsSection>
                ) : null}

                {showDesktopOnlySettings ? (
                  <>
                    <SettingsSection
                      id="computer-use"
                      title={translate(
                        'auto.components.settings.Settings.c9841721cb',
                        'Computer Use'
                      )}
                      description={translate(
                        'auto.components.settings.Settings.7118953f14',
                        'Enable agents to control any app on your computer.'
                      )}
                      searchEntries={getSectionSearchEntries('computer-use')}
                    >
                      {isSectionMounted('computer-use') ? <ComputerUsePane /> : null}
                    </SettingsSection>

                    <SettingsSection
                      id="voice"
                      title={translate('auto.components.settings.Settings.5063bb47a5', 'Voice')}
                      description={translate(
                        'auto.components.settings.Settings.eb1176a14e',
                        'Local speech-to-text dictation with on-device models.'
                      )}
                      searchEntries={getSectionSearchEntries('voice')}
                    >
                      {isSectionMounted('voice') ? (
                        <VoicePane settings={settings} updateSettings={updateSettings} />
                      ) : null}
                    </SettingsSection>
                  </>
                ) : null}

                <SettingsSection
                  id="setup-guide"
                  title={translate(
                    'auto.components.settings.Settings.6d119427ef',
                    'Onboarding checklist'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.6855b0f77d',
                    'Finish the core workflows that make Orca useful for parallel agent work.'
                  )}
                  searchEntries={getSectionSearchEntries('setup-guide')}
                  bodyClassName="overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none"
                >
                  {isSectionMounted('setup-guide') ? <SettingsSetupGuidePane /> : null}
                </SettingsSection>

                <SettingsSection
                  id="general"
                  title={translate('auto.components.settings.Settings.7807c11c4d', 'General')}
                  description={translate(
                    'auto.components.settings.Settings.f9b77539fd',
                    'Workspace defaults, app setup, and maintenance.'
                  )}
                  searchEntries={getSectionSearchEntries('general')}
                >
                  {isSectionMounted('general') ? (
                    <GeneralPane
                      settings={settings}
                      updateSettings={updateSettings}
                      fontSuggestions={terminalFontSuggestions}
                      onRequestFontSuggestions={requestFontSuggestions}
                      wslSupportedPlatform={localWslSupportedPlatform}
                      wslAvailable={localWindowsRuntimeCapabilities.wslAvailable}
                      wslDistros={localWindowsRuntimeCapabilities.wslDistros}
                      wslCapabilitiesLoading={localWindowsRuntimeCapabilities.isLoading}
                    />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="integrations"
                  title={translate('auto.components.settings.Settings.c9ca101a3b', 'Integrations')}
                  description={translate(
                    'auto.components.settings.Settings.b07041697f',
                    'Connect GitHub, GitLab, Linear, and source-hosting services.'
                  )}
                  searchEntries={getSectionSearchEntries('integrations')}
                  bodyClassName="rounded-none border-0 bg-transparent p-0 shadow-none"
                >
                  {isSectionMounted('integrations') ? <IntegrationsPane /> : null}
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="mobile"
                    title={translate('auto.components.settings.Settings.c40dadaac8', 'Mobile')}
                    badge="Beta"
                    description={translate(
                      'auto.components.settings.Settings.c6c01ac209',
                      'Control terminals and agents from your phone.'
                    )}
                    searchEntries={getSectionSearchEntries('mobile')}
                  >
                    {isSectionMounted('mobile') ? <MobileSettingsPane /> : null}
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  id="git"
                  title={translate(
                    'auto.components.settings.Settings.70100f94c7',
                    'Git & Source Control'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.cfa34f4465',
                    'Branch naming, base refs, attribution, and Git AI Author.'
                  )}
                  searchEntries={getSectionSearchEntries('git')}
                  forceVisible={hasUnsavedSourceControlAiPromptChanges}
                >
                  {isSectionMounted('git') ? (
                    <>
                      <GitPane
                        settings={settings}
                        updateSettings={updateSettings}
                        writeSourceControlAiSettings={writeSourceControlAiSettings}
                        displayedGitUsername={displayedGitUsername}
                        hasUnsavedBranchPromptChanges={hasUnsavedBranchPromptChanges}
                        onBranchPromptDirtyChange={setHasUnsavedBranchPromptChanges}
                        branchPromptDiscardSignal={sourceControlAiPromptDiscardSignal}
                        settingsSearchQuery={settingsSearchQuery}
                      />
                      <CommitMessageAiPane
                        settings={settings}
                        updateSettings={updateSettings}
                        writeSourceControlAiSettings={writeSourceControlAiSettings}
                        onCustomPromptDirtyChange={setHasUnsavedCommitPromptChanges}
                        customPromptDiscardSignal={sourceControlAiPromptDiscardSignal}
                        settingsSearchQuery={settingsSearchQuery}
                      />
                      <GitProviderApiBudgetPane settingsSearchQuery={settingsSearchQuery} />
                    </>
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="tasks"
                  title={translate('auto.components.settings.Settings.11faa2f7dd', 'Task Sources')}
                  description={translate(
                    'auto.components.settings.Settings.tasksDescription',
                    'Connect providers, install the Linear skill, and choose what appears in Tasks.'
                  )}
                  searchEntries={getSectionSearchEntries('tasks')}
                >
                  {isSectionMounted('tasks') ? (
                    <TasksPane settings={settings} updateSettings={updateSettings} />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="terminal"
                  title={translate('auto.components.settings.Settings.3de4bbb841', 'Terminal')}
                  description={translate(
                    'auto.components.settings.Settings.b79b5b31e9',
                    'Shells, renderer, sessions, and terminal behavior.'
                  )}
                  searchEntries={getSectionSearchEntries('terminal')}
                >
                  {isSectionMounted('terminal') ? (
                    <TerminalPane
                      settings={settings}
                      updateSettings={updateSettings}
                      scrollbackMode={scrollbackMode}
                      setScrollbackMode={setScrollbackMode}
                      wslAvailable={windowsTerminalCapabilities.wslAvailable}
                      wslDistros={windowsTerminalCapabilities.wslDistros}
                      wslCapabilitiesLoading={windowsTerminalCapabilities.isLoading}
                      pwshAvailable={windowsTerminalCapabilities.pwshAvailable}
                      gitBashAvailable={windowsTerminalCapabilities.gitBashAvailable}
                      isWindowsTerminalHost={isWindowsTerminalHost}
                    />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="quick-commands"
                  title={translate(
                    'auto.components.settings.Settings.13d4fe30ad',
                    'Quick Commands'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.6742c7932c',
                    'Saved terminal commands, scoped globally or per project.'
                  )}
                  searchEntries={getSectionSearchEntries('quick-commands')}
                >
                  {isSectionMounted('quick-commands') ? (
                    <QuickCommandsPane
                      settings={settings}
                      updateSettings={updateSettings}
                      addCommandIntentSignal={quickCommandAddIntentSignal}
                    />
                  ) : null}
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="browser"
                    title={translate('auto.components.settings.Settings.c46215ea03', 'Browser')}
                    description={translate(
                      'auto.components.settings.Settings.ad9788036f',
                      'Home page, link routing, and session cookies.'
                    )}
                    searchEntries={getSectionSearchEntries('browser')}
                  >
                    {isSectionMounted('browser') ? (
                      <BrowserPane
                        settings={settings}
                        updateSettings={updateSettings}
                        onOpenComputerUse={openComputerUseFromBrowser}
                      />
                    ) : null}
                  </SettingsSection>
                ) : null}

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="mobile-emulator"
                    title={translate(
                      'auto.components.settings.Settings.f75daf1002',
                      'Mobile Emulator'
                    )}
                    description={translate(
                      'auto.components.settings.Settings.01f9d36292',
                      'Configure mobile emulator support for Orca and coding agents.'
                    )}
                    searchEntries={getSectionSearchEntries('mobile-emulator')}
                  >
                    {isSectionMounted('mobile-emulator') ? (
                      <MobileEmulatorSettingsPane
                        settings={settings}
                        updateSettings={updateSettings}
                      />
                    ) : null}
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  id="floating-workspace"
                  title={translate(
                    'auto.components.settings.Settings.3eb22a3ada',
                    'Floating Workspace'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.3d9adfe6a5',
                    'Global terminal, browser, and markdown tabs.'
                  )}
                  searchEntries={getSectionSearchEntries('floating-workspace')}
                >
                  {isSectionMounted('floating-workspace') ? (
                    <FloatingWorkspacePane settings={settings} updateSettings={updateSettings} />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="appearance"
                  title={translate('auto.components.settings.Settings.2b4474780a', 'Appearance')}
                  description={translate(
                    'auto.components.settings.Settings.6d1a27e193',
                    'Theme, zoom, app and terminal appearance, sidebars, and status bar.'
                  )}
                  searchEntries={getSectionSearchEntries('appearance')}
                >
                  {isSectionMounted('appearance') ? (
                    <AppearancePane
                      settings={settings}
                      updateSettings={updateSettings}
                      applyTheme={applyTheme}
                      fontSuggestions={fontSuggestions}
                      terminalFontSuggestions={terminalFontSuggestions}
                      onRequestFontSuggestions={requestFontSuggestions}
                      systemPrefersDark={systemPrefersDark}
                      ghostty={ghostty}
                      warpThemes={warpThemes}
                    />
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  id="input"
                  title={translate(
                    'auto.components.settings.Settings.d7a3e635b6',
                    'Input & Editing'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.d0b7021d64',
                    'Selection and editing behavior.'
                  )}
                  searchEntries={getSectionSearchEntries('input')}
                >
                  <InputPane settings={settings} updateSettings={updateSettings} />
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="notifications"
                    title={translate(
                      'auto.components.settings.Settings.9907545fa3',
                      'Notifications'
                    )}
                    description={translate(
                      'auto.components.settings.Settings.7210ac09c4',
                      'Native desktop notifications for agent activity and terminal events.'
                    )}
                    searchEntries={getSectionSearchEntries('notifications')}
                  >
                    {isSectionMounted('notifications') ? (
                      <NotificationsPane settings={settings} updateSettings={updateSettings} />
                    ) : null}
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  id="shortcuts"
                  title={translate('auto.components.settings.Settings.23bf7a1ad4', 'Shortcuts')}
                  description={translate(
                    'auto.components.settings.Settings.a737a4bb22',
                    'Keyboard shortcuts for common actions.'
                  )}
                  searchEntries={getSectionSearchEntries('shortcuts')}
                  className={
                    isFocusedShortcutsPane
                      ? 'flex min-h-0 flex-1 flex-col space-y-0 gap-6'
                      : undefined
                  }
                  bodyClassName={
                    isFocusedShortcutsPane ? 'min-h-0 flex-1 overflow-hidden' : undefined
                  }
                >
                  {isSectionMounted('shortcuts') ? <ShortcutsPane /> : null}
                </SettingsSection>

                <SettingsSection
                  id="stats"
                  title={translate('auto.components.settings.Settings.954a8f5aef', 'Stats & Usage')}
                  description={translate(
                    'auto.components.settings.Settings.8acf3f22e0',
                    'Orca stats plus Claude, Codex, OpenCode token analytics and Grok subscription usage.'
                  )}
                  searchEntries={getSectionSearchEntries('stats')}
                >
                  {isSectionMounted('stats') ? <StatsPane /> : null}
                </SettingsSection>

                <SettingsSection
                  id="servers"
                  title={translate(
                    'auto.components.settings.Settings.bd0181eeca',
                    'Remote Orca Servers'
                  )}
                  badge="Beta"
                  description={
                    isWebClient
                      ? translate(
                          'auto.components.settings.Settings.7686cb5c36',
                          'Connect this browser to a saved Orca server.'
                        )
                      : translate(
                          'auto.components.settings.Settings.b5ee17826b',
                          'Pair remote Orca runtimes for persistent sessions, richer remote state, and web or mobile handoff.'
                        )
                  }
                  searchEntries={getSectionSearchEntries('servers')}
                >
                  {isSectionMounted('servers') ? (
                    <RuntimeEnvironmentsPane
                      settings={settings}
                      setActiveRuntimeEnvironmentPreference={setActiveRuntimeEnvironmentPreference}
                      canGeneratePairingUrl={!isWebClient}
                      allowLocalRuntime={!isWebClient}
                      addServerIntentSignal={remoteServerAddIntentSignal}
                    />
                  ) : null}
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="ssh"
                    title={translate('auto.components.settings.Settings.9b02492d1f', 'SSH Hosts')}
                    description={translate(
                      'auto.components.settings.Settings.c2ee313198',
                      'Use existing machines over SSH for files, terminals, Git, and workspaces.'
                    )}
                    searchEntries={getSectionSearchEntries('ssh')}
                  >
                    {isSectionMounted('ssh') ? (
                      <SshPane addTargetIntentSignal={sshHostAddIntentSignal} />
                    ) : null}
                  </SettingsSection>
                ) : null}

                {showDesktopOnlySettings && isMac ? (
                  <SettingsSection
                    id="developer-permissions"
                    title={translate(
                      'auto.components.settings.Settings.65660d4548',
                      'macOS Permissions'
                    )}
                    description={translate(
                      'auto.components.settings.Settings.9b83cc62c2',
                      'macOS privacy access for terminal-launched developer tools.'
                    )}
                    searchEntries={getSectionSearchEntries('developer-permissions')}
                  >
                    {isSectionMounted('developer-permissions') ? (
                      <DeveloperPermissionsPane />
                    ) : null}
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  id="privacy"
                  title={translate(
                    'auto.components.settings.Settings.d7e3f62d70',
                    'Privacy & Telemetry'
                  )}
                  description={translate(
                    'auto.components.settings.Settings.c1b43dc4e2',
                    'Anonymous usage data and telemetry controls.'
                  )}
                  searchEntries={getSectionSearchEntries('privacy')}
                >
                  {isSectionMounted('privacy') ? <PrivacyPane settings={settings} /> : null}
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <SettingsSection
                    id="advanced"
                    title={translate('auto.components.settings.Settings.1c87f8d024', 'Advanced')}
                    description={translate(
                      'auto.components.settings.Settings.499c1cd7f9',
                      'Low-level compatibility settings for troubleshooting.'
                    )}
                    searchEntries={getSectionSearchEntries('advanced')}
                  >
                    {isSectionMounted('advanced') ? (
                      <AdvancedPane settings={settings} updateSettings={updateSettings} />
                    ) : null}
                  </SettingsSection>
                ) : null}

                {showDesktopOnlySettings && import.meta.env.DEV ? (
                  <SettingsSection
                    id="dev"
                    title={translate('auto.components.settings.Settings.dev', 'Dev Tools')}
                    description={translate(
                      'auto.components.settings.Settings.devDescription',
                      'Dev-only tools for exercising UI states.'
                    )}
                    searchEntries={getSectionSearchEntries('dev')}
                  >
                    {DevToolsPane && isSectionMounted('dev') ? (
                      <Suspense fallback={null}>
                        <DevToolsPane />
                      </Suspense>
                    ) : null}
                  </SettingsSection>
                ) : null}

                <SettingsSection
                  id="experimental"
                  title={translate('auto.components.settings.Settings.8b017f2506', 'Experimental')}
                  description={translate(
                    'auto.components.settings.Settings.075341c763',
                    'New features that are still taking shape. Give them a try.'
                  )}
                  searchEntries={getSectionSearchEntries('experimental')}
                >
                  {isSectionMounted('experimental') ? (
                    <ExperimentalPane
                      settings={settings}
                      updateSettings={updateSettings}
                      hiddenExperimentalUnlocked={hiddenExperimentalUnlocked}
                    />
                  ) : null}
                </SettingsSection>

                {showDesktopOnlySettings ? (
                  <PluginsSettingsSection
                    mounted={isSectionMounted('plugins')}
                    settings={settings}
                    updateSettings={updateSettingsOrThrow}
                  />
                ) : null}

                {settingsProjectList.map((settingsProject) => {
                  const repoSectionId = `repo-${settingsProject.representativeRepoId}`
                  // Why: use the switcher-selected host's repo so identity/host-specific edits follow "Available Hosts".
                  const repo = getSettingsProjectHostRepo(
                    settingsProject,
                    repos,
                    settingsProjectHostSelection[settingsProject.projectId],
                    settingsProjectSetupSelection[settingsProject.projectId]
                  )
                  if (!repo) {
                    return null
                  }
                  const repoHostIdentity = getRepoHostIdentity(repo)
                  const repoHooksState = repoHooksMap[repoHostIdentity]
                  const project = projectByRepoId.get(repo.id) ?? settingsProject.project

                  return (
                    <SettingsSection
                      key={repoSectionId}
                      id={repoSectionId}
                      title={translate(
                        'auto.components.settings.Settings.3bf149e873',
                        'Project Settings > {{value0}}',
                        { value0: project.displayName }
                      )}
                      description={repo.path}
                      searchEntries={getSectionSearchEntries(repoSectionId)}
                    >
                      {isSectionMounted(repoSectionId) ? (
                        // Why: re-key per host so same-id hosts don't reuse the prior host's drafts/effects.
                        <RepositoryPane
                          key={repoHostIdentity}
                          repo={repo}
                          yamlHooks={repoHooksState?.hooks ?? null}
                          hasHooksFile={repoHooksState?.hasHooks ?? false}
                          hooksInspectionReady={Boolean(repoHooksState)}
                          mayNeedUpdate={repoHooksState?.mayNeedUpdate ?? false}
                          updateRepo={updateRepo}
                          removeProject={() => void removeProjectAllHosts(settingsProject.setups)}
                          project={project}
                          selectedProjectSetupId={
                            settingsProjectSetupSelection[settingsProject.projectId]
                          }
                          isLocalWindowsProject={
                            getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
                            isWindowsTerminalHost
                          }
                          wslAvailable={windowsTerminalCapabilities.wslAvailable}
                          wslDistros={windowsTerminalCapabilities.wslDistros}
                          wslCapabilitiesLoading={windowsTerminalCapabilities.isLoading}
                          updateProject={updateProject}
                        />
                      ) : null}
                    </SettingsSection>
                  )
                })}
              </ActiveSettingsSectionProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
