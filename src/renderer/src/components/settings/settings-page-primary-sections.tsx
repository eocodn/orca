import { translate } from '@/i18n/i18n'
import { AgentsPane } from './AgentsPane'
import { AccountsPane } from './AccountsPane'
import { OrchestrationPane } from './OrchestrationPane'
import { LinearAgentSkillPane } from './LinearAgentSkillPane'
import { ComputerUsePane } from './ComputerUsePane'
import { VoicePane } from './VoicePane'
import { SettingsSetupGuidePane } from './SettingsSetupGuidePane'
import { GeneralPane } from './GeneralPane'
import { IntegrationsPane } from './IntegrationsPane'
import { MobileSettingsPane } from './MobileSettingsPane'
import { GitPane } from './GitPane'
import { CommitMessageAiPane } from './CommitMessageAiPane'
import { GitProviderApiBudgetPane } from './GitProviderApiBudgetPane'
import { TasksPane } from './TasksPane'
import { TerminalPane } from './TerminalPane'
import { QuickCommandsPane } from './QuickCommandsPane'
import { SettingsSection } from './SettingsSection'

export function SettingsPagePrimarySections({
  context
}: {
  context: Record<string, any>
}): React.JSX.Element {
  const {
    settings,
    updateSettings,
    linearConnected,
    showDesktopOnlySettings,
    isSectionMounted,
    getSectionSearchEntries,
    localWslSupportedPlatform,
    localWindowsRuntimeCapabilities,
    runtimeWslSupportedPlatform,
    windowsTerminalCapabilities,
    terminalFontSuggestions,
    requestFontSuggestions,
    hasUnsavedSourceControlAiPromptChanges,
    writeSourceControlAiSettings,
    displayedGitUsername,
    hasUnsavedBranchPromptChanges,
    setHasUnsavedBranchPromptChanges,
    sourceControlAiPromptDiscardSignal,
    setHasUnsavedCommitPromptChanges,
    settingsSearchQuery,
    scrollbackMode,
    setScrollbackMode,
    quickCommandAddIntentSignal
  } = context

  return (
    <>
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

    </>
  )
}