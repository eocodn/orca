// Concrete settings state; the public import remains settings-page-state.tsx.
import { useCallback, useMemo } from 'react'
import type { ProjectHostSetup } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { isWebClientLocation } from '@/hooks/useSettingsNavigationMetadata'
import { SCROLLBACK_PRESETS_ROWS } from './SettingsConstants'
import {
  buildRepoIdToHostSelection,
  buildRepoIdToRepresentative,
  buildSettingsProjectList,
  removeSettingsProjectFromAllHosts
} from './settings-project-list'
import { useSettingsPageLifecycle } from './settings-page-lifecycle'
import { useSettingsPageRuntimeState } from './settings-page-runtime-state'
import { useSettingsPageNavigation } from './settings-page-navigation-state'
import { SettingsPageRender } from './settings-page-render'
import type { SettingsNavGroup } from '@/lib/settings-navigation-types'
import { getSettingsNavGroupDefinitionsForSearch } from './settings-navigation-model'
import { translate } from '@/i18n/i18n'

function Settings(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const keybindings = useAppStore((s) => s.keybindings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const updateSettingsOrThrow = useAppStore((s) => s.updateSettingsOrThrow)
  const setActiveRuntimeEnvironmentPreference = useAppStore(
    (s) => s.setActiveRuntimeEnvironmentPreference
  )
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const fetchKeybindings = useAppStore((s) => s.fetchKeybindings)
  const closeSettingsPage = useAppStore((s) => s.closeSettingsPage)
  const repos = useAppStore((s) => s.repos)
  const projects = useAppStore((s) => s.projects)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const updateProject = useAppStore((s) => s.updateProject)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const removeProject = useAppStore((s) => s.removeProject)
  const settingsNavigationTarget = useAppStore((s) => s.settingsNavigationTarget)
  const clearSettingsTarget = useAppStore((s) => s.clearSettingsTarget)
  const settingsProjectHostSelection = useAppStore((s) => s.settingsProjectHostSelection)
  const settingsProjectSetupSelection = useAppStore((s) => s.settingsProjectSetupSelection)
  const setSettingsProjectHostSelection = useAppStore((s) => s.setSettingsProjectHostSelection)
  const settingsSearchInputQuery = useAppStore((s) => s.settingsSearchInputQuery)
  const settingsSearchQuery = useAppStore((s) => s.settingsSearchQuery)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const modelStates = useAppStore((s) => s.modelStates)
  const refreshModelStates = useAppStore((s) => s.refreshModelStates)

  // Why: one entry per project (derived from repos to match nav metadata) — the source of truth for the pane list.
  const settingsProjectList = useMemo(() => buildSettingsProjectList(repos), [repos])
  const repoIdToRepresentative = useMemo(
    () => buildRepoIdToRepresentative(settingsProjectList),
    [settingsProjectList]
  )
  // Why: lets a deep-link's repoId select the owning project's host so host-specific subsection anchors exist.
  const repoIdToHostSelection = useMemo(
    () => buildRepoIdToHostSelection(settingsProjectList),
    [settingsProjectList]
  )
  // Why: pane-level "Remove Project" removes every host setup, not just the selected host (per-host remove lives in "Available Hosts").
  const removeProjectAllHosts = useCallback(
    (setups: readonly ProjectHostSetup[]): Promise<void> =>
      removeSettingsProjectFromAllHosts(setups, removeProject),
    [removeProject]
  )

  const isWebClient = isWebClientLocation()
  const showDesktopOnlySettings = !isWebClient
  const runtimeState = useSettingsPageRuntimeState({
    settings,
    updateSettings,
    showDesktopOnlySettings
  })
  const {
    repoHooksMap,
    setRepoHooksMap,
    systemPrefersDark,
    isWindows,
    isMac,
    linearConnected,
    linearSkill,
    skillFreshnessApplies,
    voiceModelStatesLoading,
    setVoiceModelStatesLoading,
    scrollbackMode,
    setScrollbackMode,
    prevScrollbackRows,
    setPrevScrollbackRows,
    ghostty,
    warpThemes,
    fontSuggestions,
    terminalFontSuggestions,
    activeSectionId,
    setActiveSectionId,
    mountedSectionIds,
    setMountedSectionIds,
    pendingNavRequestTick,
    setPendingNavRequestTick,
    quickCommandAddIntentSignal,
    setQuickCommandAddIntentSignal,
    sshHostAddIntentSignal,
    setSshHostAddIntentSignal,
    remoteServerAddIntentSignal,
    setRemoteServerAddIntentSignal,
    hasUnsavedCommitPromptChanges,
    setHasUnsavedCommitPromptChanges,
    hasUnsavedBranchPromptChanges,
    setHasUnsavedBranchPromptChanges,
    sourceControlAiPromptDiscardSignal,
    setSourceControlAiPromptDiscardSignal,
    confirm,
    hiddenExperimentalUnlocked,
    setHiddenExperimentalUnlocked,
    contentScrollRef,
    searchInputRef,
    settingsMountedRef,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    pendingSubsectionScrollFrameRef,
    repoHooksRequestSeqRef,
    shortcutsEscapeConfirmUntilRef,
    sourceControlAiWriteQueueRef,
    hasUnsavedSourceControlAiPromptChanges,
    hasUnsavedSourceControlAiPromptChangesRef
  } = runtimeState

  const lifecycle = useSettingsPageLifecycle({
    settings,
    updateSettings,
    sourceControlAiWriteQueueRef,
    setSettingsSearchQuery,
    contentScrollRef,
    pendingSubsectionScrollFrameRef,
    installedFontsLoadedRef: runtimeState.installedFontsLoadedRef,
    installedFontsLoadPromiseRef: runtimeState.installedFontsLoadPromiseRef,
    settingsMountedRef,
    setFontSuggestions,
    confirm,
    hasUnsavedSourceControlAiPromptChanges,
    setSourceControlAiPromptDiscardSignal,
    setHasUnsavedCommitPromptChanges,
    setHasUnsavedBranchPromptChanges,
    closeSettingsPage,
    fetchSettings,
    fetchKeybindings,
    showDesktopOnlySettings,
    setVoiceModelStatesLoading,
    refreshModelStates,
    activeSectionId,
    shortcutsEscapeConfirmUntilRef,
    keybindings,
    searchInputRef,
    hasUnsavedSourceControlAiPromptChangesRef,
    settingsNavigationTarget,
    repoIdToRepresentative,
    repoIdToHostSelection,
    settingsProjectList,
    setSettingsProjectHostSelection,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    setQuickCommandAddIntentSignal,
    setSshHostAddIntentSignal,
    setRemoteServerAddIntentSignal,
    setMountedSectionIds,
    setPendingNavRequestTick,
    clearSettingsTarget
  })
  const {
    writeSourceControlAiSettings,
    setSettingsRootNode,
    setContentScrollNode,
    requestFontSuggestions,
    promptDiscardSourceControlAiPromptChanges,
    confirmDiscardSourceControlAiPromptChanges,
    closeSettingsPageWithPromptGuard
  } = lifecycle

  // Why: recompute scrollback mode only when the row value changes, not on every settings mutation.
  if (settings?.terminalScrollbackRows !== prevScrollbackRows) {
    setPrevScrollbackRows(settings?.terminalScrollbackRows)
    if (settings) {
      setScrollbackMode(
        SCROLLBACK_PRESETS_ROWS.includes(
          settings.terminalScrollbackRows as (typeof SCROLLBACK_PRESETS_ROWS)[number]
        )
          ? 'preset'
          : 'custom'
      )
    }
  }

  const settingsNavigation = useSettingsPageNavigation({
    settings,
    repos,
    projects,
    projectHostSetups,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    settingsSearchQuery,
    setSettingsSearchQuery,
    modelStates,
    settingsProjectList,
    setRepoHooksMap,
    isWindows,
    isWebClient,
    showDesktopOnlySettings,
    linearConnected,
    linearSkill,
    skillFreshnessApplies,
    voiceModelStatesLoading,
    activeSectionId,
    setActiveSectionId,
    mountedSectionIds,
    setMountedSectionIds,
    pendingNavRequestTick,
    setPendingNavRequestTick,
    setHiddenExperimentalUnlocked,
    contentScrollRef,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    pendingSubsectionScrollFrameRef,
    repoHooksRequestSeqRef,
    hasUnsavedSourceControlAiPromptChanges,
    confirmDiscardSourceControlAiPromptChanges
  })
  const {
    applyTheme,
    getSectionSearchEntries,
    visibleNavSections,
    projectByRepoId,
    neededSectionIds,
    windowsTerminalCapabilities,
    localWindowsRuntimeCapabilities,
    localWslSupportedPlatform,
    isWindowsTerminalHost,
    scrollToSection
  } = settingsNavigation
  const runtimeWslSupportedPlatform = isWindowsTerminalHost
  const displayedGitUsername = repos[0]?.gitUsername ?? ''
  if (!settings) {
    return (
      <div
        ref={setSettingsRootNode}
        className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background"
      >
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {translate('auto.components.settings.Settings.c7ad095d96', 'Loading settings...')}
        </div>
      </div>
    )
  }

  const generalNavSections = visibleNavSections.filter((section) => !section.id.startsWith('repo-'))
  const generalNavGroupDefinitions = getSettingsNavGroupDefinitionsForSearch(
    visibleNavSections,
    settingsSearchQuery
  )
  const generalNavGroups: SettingsNavGroup[] = generalNavGroupDefinitions
    .map((group) => ({
      id: group.id,
      title: translate(group.titleKey, group.titleDefault),
      sections: generalNavSections.filter((section) => section.group === group.id)
    }))
    .filter((group) => group.sections.length > 0 || group.id === 'setup')
  const repoNavSections = visibleNavSections
    .filter((section) => section.id.startsWith('repo-'))
    .map((section) => {
      const repo = repos.find((entry) => entry.id === section.id.replace('repo-', ''))
      return {
        ...section,
        badgeColor: repo?.badgeColor,
        isRemote: !!repo?.connectionId,
        repoIcon: repo?.repoIcon,
        upstream: repo?.upstream
      }
    })
  const isSectionMounted = (sectionId: string): boolean => neededSectionIds.has(sectionId)
  const isFocusedShortcutsPane =
    activeSectionId === 'shortcuts' && settingsSearchQuery.trim() === ''
  const isFocusedSetupGuidePane =
    activeSectionId === 'setup-guide' && settingsSearchQuery.trim() === ''

  const settingsViewContext = {
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
    applyTheme,
    getSectionSearchEntries,
    visibleNavSections,
    projectByRepoId,
    windowsTerminalCapabilities,
    localWindowsRuntimeCapabilities,
    localWslSupportedPlatform,
    runtimeWslSupportedPlatform,
    isWindowsTerminalHost,
    displayedGitUsername,
    isSectionMounted,
    isFocusedShortcutsPane,
    isFocusedSetupGuidePane
  }
  return <SettingsPageRender context={settingsViewContext} />
}

export default Settings
