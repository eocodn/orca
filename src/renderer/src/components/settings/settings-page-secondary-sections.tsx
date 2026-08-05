import { Suspense } from 'react'
import { translate } from '@/i18n/i18n'
import { BrowserPane } from './BrowserPane'
import { FloatingWorkspacePane } from './FloatingWorkspacePane'
import { AppearancePane } from './AppearancePane'
import { InputPane } from './InputPane'
import { NotificationsPane } from './NotificationsPane'
import { ShortcutsPane } from './ShortcutsPane'
import { StatsPane } from '../stats/StatsPane'
import { RuntimeEnvironmentsPane } from './RuntimeEnvironmentsPane'
import { SshPane } from './SshPane'
import { DeveloperPermissionsPane } from './DeveloperPermissionsPane'
import { PrivacyPane } from './PrivacyPane'
import { AdvancedPane } from './AdvancedPane'
import { ExperimentalPane } from './ExperimentalPane'
import { PluginsSettingsSection } from './PluginsSettingsSection'
import { SettingsSection } from './SettingsSection'
import { DevToolsPane } from './settings-navigation-model'

export function SettingsPageSecondarySections({
  context
}: {
  context: Record<string, any>
}): React.JSX.Element {
  const {
    settings,
    updateSettings,
    showDesktopOnlySettings,
    isSectionMounted,
    getSectionSearchEntries,
    scrollbackMode,
    setScrollbackMode,
    windowsTerminalCapabilities,
    isWindowsTerminalHost,
    applyTheme,
    fontSuggestions,
    terminalFontSuggestions,
    requestFontSuggestions,
    systemPrefersDark,
    ghostty,
    warpThemes,
    isFocusedShortcutsPane,
    isWebClient,
    setActiveRuntimeEnvironmentPreference,
    remoteServerAddIntentSignal,
    sshHostAddIntentSignal,
    isMac,
    hiddenExperimentalUnlocked,
    updateSettingsOrThrow
  } = context

  return (
    <>
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
            <BrowserPane settings={settings} updateSettings={updateSettings} />
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection
        id="floating-workspace"
        title={translate('auto.components.settings.Settings.3eb22a3ada', 'Floating Workspace')}
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
        title={translate('auto.components.settings.Settings.d7a3e635b6', 'Input & Editing')}
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
          title={translate('auto.components.settings.Settings.9907545fa3', 'Notifications')}
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
          isFocusedShortcutsPane ? 'flex min-h-0 flex-1 flex-col space-y-0 gap-6' : undefined
        }
        bodyClassName={isFocusedShortcutsPane ? 'min-h-0 flex-1 overflow-hidden' : undefined}
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
        title={translate('auto.components.settings.Settings.bd0181eeca', 'Remote Orca Servers')}
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
          title={translate('auto.components.settings.Settings.65660d4548', 'macOS Permissions')}
          description={translate(
            'auto.components.settings.Settings.9b83cc62c2',
            'macOS privacy access for terminal-launched developer tools.'
          )}
          searchEntries={getSectionSearchEntries('developer-permissions')}
        >
          {isSectionMounted('developer-permissions') ? <DeveloperPermissionsPane /> : null}
        </SettingsSection>
      ) : null}

      <SettingsSection
        id="privacy"
        title={translate('auto.components.settings.Settings.d7e3f62d70', 'Privacy & Telemetry')}
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
    </>
  )
}
