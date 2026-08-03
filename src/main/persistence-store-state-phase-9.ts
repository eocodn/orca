import type {
  PersistedState,
  GlobalSettings
} from '../shared/types'


import {
  normalizeExecutionHostOrder,
  normalizeVisibleExecutionHostIds
} from '../shared/execution-host'
import {
  getDefaultUIState,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties
} from '../shared/constants'
import { normalizeUsagePercentageDisplay } from '../shared/usage-percentage-display'
import { normalizeStatusBarUsageMode } from '../shared/status-bar-usage-mode'
import { normalizePRBotAuthorOverrides } from '../shared/pr-bot-author-overrides'
import { normalizeTerminalQuickCommands } from '../shared/terminal-quick-commands'
import { normalizeTaskProviderSettings } from '../shared/task-providers'
import { normalizeOpenInApplications } from '../shared/open-in-applications'
import { normalizeTerminalShortcutPolicy } from '../shared/keybindings'
import { normalizeSourceControlGroupOrder } from '../shared/source-control-group-order'
import { normalizeAppIconId } from '../shared/app-icon'
import { normalizeTerminalCustomThemes } from '../shared/terminal-custom-themes'
import {
  normalizeDesktopTerminalScrollbackRows
} from '../shared/terminal-scrollback-policy'
import {
  normalizeFeatureInteractions
} from '../shared/feature-interactions'
import { normalizeContextualTourIds } from '../shared/contextual-tours'
import { normalizeFeatureTipIds } from '../shared/feature-tips'
import { normalizeManualRepoOrder } from '../shared/manual-repo-order'
import {
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  normalizeWorkspaceStatuses
} from '../shared/workspace-statuses'
import { clampMarkdownTocPanelWidth } from '../shared/markdown-toc-panel-width'
import { clampCombinedDiffFileTreeWidth } from '../shared/combined-diff-file-tree-width'
import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  normalizeSourceControlAiSettings,
  projectSourceControlAiToLegacyCommitMessageAi
} from '../shared/source-control-ai'
import { normalizeDisabledTuiAgents } from '../shared/tui-agent-selection'
import {
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../shared/tui-agent-launch-defaults'
import { normalizeUiLanguage } from '../shared/ui-language'
import { normalizeBrowserPageZoomLevel } from '../shared/browser-page-zoom'
import { retireLegacyInstructionsForClearedTextActionRecipes } from './persistence-state-foundation'
import {
  buildWorkspaceDirHistoryForUpdate,
  normalizeGroupBy,
  normalizeProjectOrderBy,
  normalizeShowDotfilesByWorktree,
  normalizeSortBy,
  stripLegacyTerminalScrollbackBytes,
  stripMainOwnedTelemetryMarkerFromUI
} from './persistence-state-paths'
import {
  normalizeNotificationSettings,
  normalizeRightSidebarExplorerView,
  normalizeRightSidebarTab
} from './persistence-state-migrations'

import { StorePhase8 } from './persistence-store-write-lifecycle'

export class StorePhase9 extends StorePhase8 {
  updateSettings(
    updates: Partial<GlobalSettings>,
    options: { notifyListeners?: boolean; originWebContentsId?: number } = {}
  ): GlobalSettings {
    const sanitizedUpdates = stripLegacyTerminalScrollbackBytes(updates)
    // Why: coerce to boolean here (not the IPC edge) so every write path is covered and a truthy non-bool can't persist as "tray-minimize on".
    if ('minimizeToTrayOnClose' in updates) {
      sanitizedUpdates.minimizeToTrayOnClose = updates.minimizeToTrayOnClose === true
    }
    if ('showMenuBarIcon' in updates) {
      sanitizedUpdates.showMenuBarIcon = updates.showMenuBarIcon === true
    }
    if ('disabledTuiAgents' in updates) {
      sanitizedUpdates.disabledTuiAgents = normalizeDisabledTuiAgents(updates.disabledTuiAgents)
    }
    if ('agentDefaultArgs' in updates) {
      sanitizedUpdates.agentDefaultArgs = normalizeTuiAgentArgsRecord(updates.agentDefaultArgs)
      sanitizedUpdates.agentYoloDefaultsMigrated = true
    }
    if ('agentDefaultEnv' in updates) {
      sanitizedUpdates.agentDefaultEnv = normalizeTuiAgentEnvRecord(updates.agentDefaultEnv)
      sanitizedUpdates.agentYoloDefaultsMigrated = true
    }
    if ('terminalQuickCommands' in updates) {
      sanitizedUpdates.terminalQuickCommands = normalizeTerminalQuickCommands(
        updates.terminalQuickCommands
      )
    }
    if ('terminalCustomThemes' in updates) {
      sanitizedUpdates.terminalCustomThemes = normalizeTerminalCustomThemes(
        updates.terminalCustomThemes
      )
    }
    if ('terminalScrollbackRows' in updates) {
      sanitizedUpdates.terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
        updates.terminalScrollbackRows
      )
    }
    if (
      'terminalTuiScrollSensitivity' in updates ||
      'terminalTuiScrollSensitivityDefaultedToOne' in updates
    ) {
      sanitizedUpdates.terminalTuiScrollSensitivityDefaultedToOne = true
    }
    if ('visibleTaskProviders' in updates || 'defaultTaskSource' in updates) {
      const taskProviderSettings = normalizeTaskProviderSettings({
        visibleTaskProviders:
          'visibleTaskProviders' in updates
            ? updates.visibleTaskProviders
            : this.state.settings.visibleTaskProviders,
        defaultTaskSource:
          'defaultTaskSource' in updates
            ? updates.defaultTaskSource
            : this.state.settings.defaultTaskSource
      })
      sanitizedUpdates.defaultTaskSource = taskProviderSettings.defaultTaskSource
      sanitizedUpdates.visibleTaskProviders = taskProviderSettings.visibleTaskProviders
      if ('visibleTaskProviders' in updates) {
        sanitizedUpdates.visibleTaskProvidersDefaultedForJira = true
      }
    }
    if ('autoRenameBranchFromWork' in updates || 'autoRenameBranchFromWorkDefaultedOn' in updates) {
      sanitizedUpdates.autoRenameBranchFromWorkDefaultedOn = true
    }
    if ('openInApplications' in updates) {
      sanitizedUpdates.openInApplications = normalizeOpenInApplications(updates.openInApplications)
    }
    if ('terminalShortcutPolicy' in updates) {
      sanitizedUpdates.terminalShortcutPolicy = normalizeTerminalShortcutPolicy(
        updates.terminalShortcutPolicy
      )
    }
    if ('sourceControlGroupOrder' in updates) {
      sanitizedUpdates.sourceControlGroupOrder = normalizeSourceControlGroupOrder(
        updates.sourceControlGroupOrder
      )
    }
    if ('appIcon' in updates) {
      sanitizedUpdates.appIcon = normalizeAppIconId(updates.appIcon)
    }
    if ('uiLanguage' in updates) {
      sanitizedUpdates.uiLanguage = normalizeUiLanguage(updates.uiLanguage)
    }
    if ('prBotAuthorOverrides' in updates) {
      // Why: every writer (desktop IPC, web RPC, migrations) hits this boundary, so the persisted list stays bounded and well-formed.
      sanitizedUpdates.prBotAuthorOverrides = normalizePRBotAuthorOverrides(
        updates.prBotAuthorOverrides
      )
    }
    const historyWithPreviousLayout = buildWorkspaceDirHistoryForUpdate(
      this.state.settings,
      sanitizedUpdates
    )
    if (historyWithPreviousLayout) {
      sanitizedUpdates.workspaceDirHistory = historyWithPreviousLayout
    }
    // Why deep-merge telemetry: a partial update (e.g. flipping only `optedIn`) must not clobber siblings like `installId`.
    const mergedTelemetry =
      sanitizedUpdates.telemetry !== undefined
        ? { ...this.state.settings.telemetry, ...sanitizedUpdates.telemetry }
        : this.state.settings.telemetry
    if ('sourceControlAi' in sanitizedUpdates) {
      sanitizedUpdates.sourceControlAi = retireLegacyInstructionsForClearedTextActionRecipes(
        sanitizedUpdates.sourceControlAi,
        this.state.settings
      )
      const normalizedSourceControlAi = normalizeSourceControlAiSettings(
        sanitizedUpdates.sourceControlAi,
        this.state.settings.commitMessageAi
      )
      sanitizedUpdates.sourceControlAi = normalizedSourceControlAi
      sanitizedUpdates.commitMessageAi = projectSourceControlAiToLegacyCommitMessageAi(
        normalizedSourceControlAi,
        this.state.settings.commitMessageAi
      )
    } else if ('commitMessageAi' in sanitizedUpdates) {
      sanitizedUpdates.sourceControlAi = mergeLegacyCommitMessageAiIntoSourceControlAi(
        this.state.settings.sourceControlAi,
        sanitizedUpdates.commitMessageAi
      )
    }
    const previousSettings = this.state.settings
    this.state.settings = {
      ...this.state.settings,
      ...sanitizedUpdates,
      notifications: normalizeNotificationSettings({
        ...this.state.settings.notifications,
        ...sanitizedUpdates.notifications
      }),
      ...(mergedTelemetry !== undefined ? { telemetry: mergedTelemetry } : {})
    }
    this.scheduleSave()
    const changedUpdates = {} as Partial<GlobalSettings> & Record<string, unknown>
    for (const key of Object.keys(sanitizedUpdates) as (keyof GlobalSettings)[]) {
      if (!Object.is(previousSettings[key], this.state.settings[key])) {
        changedUpdates[String(key)] = this.state.settings[key]
      }
    }
    if (options.notifyListeners === true && Object.keys(changedUpdates).length > 0) {
      this.notifySettingsChanged(changedUpdates, options.originWebContentsId)
    }
    return this.state.settings
  }

  // ── UI State ───────────────────────────────────────────────────────

  getUI(): PersistedState['ui'] {
    const uiState = stripMainOwnedTelemetryMarkerFromUI(this.state.ui)
    return {
      ...getDefaultUIState(),
      ...uiState,
      groupBy: normalizeGroupBy(this.state.ui?.groupBy),
      sortBy: normalizeSortBy(this.state.ui?.sortBy),
      projectOrderBy: normalizeProjectOrderBy(this.state.ui?.projectOrderBy),
      rightSidebarTab: normalizeRightSidebarTab(this.state.ui?.rightSidebarTab),
      rightSidebarExplorerView: normalizeRightSidebarExplorerView(
        this.state.ui?.rightSidebarExplorerView,
        this.state.ui?.rightSidebarTab
      ),
      worktreeCardProperties: normalizeWorktreeCardProperties(
        this.state.ui?.worktreeCardProperties
      ),
      agentActivityDisplayMode: normalizeAgentActivityDisplayMode(
        this.state.ui?.agentActivityDisplayMode
      ),
      workspaceStatuses: normalizeWorkspaceStatuses(this.state.ui?.workspaceStatuses),
      workspaceBoardOpacity: clampWorkspaceBoardOpacity(this.state.ui?.workspaceBoardOpacity),
      workspaceBoardColumnWidth: clampWorkspaceBoardColumnWidth(
        this.state.ui?.workspaceBoardColumnWidth
      ),
      syncTaskStatusFromWorkspaceBoard: this.state.ui?.syncTaskStatusFromWorkspaceBoard === true,
      usagePercentageDisplay: normalizeUsagePercentageDisplay(
        this.state.ui?.usagePercentageDisplay
      ),
      statusBarUsageMode: normalizeStatusBarUsageMode(this.state.ui?.statusBarUsageMode),
      // Why: strict boolean coercion so a missing/legacy value reads as false (first-run notice still fires).
      trayMinimizeNoticeShown: this.state.ui?.trayMinimizeNoticeShown === true,
      osc52ClipboardDefaultOnNoticePending:
        this.state.ui?.osc52ClipboardDefaultOnNoticePending === true,
      markdownTocPanelWidth: clampMarkdownTocPanelWidth(this.state.ui?.markdownTocPanelWidth),
      combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
        this.state.ui?.combinedDiffFileTreeWidth
      ),
      visibleWorkspaceHostIds: normalizeVisibleExecutionHostIds(
        this.state.ui?.visibleWorkspaceHostIds
      ),
      workspaceHostOrder: normalizeExecutionHostOrder(this.state.ui?.workspaceHostOrder),
      manualRepoOrder: normalizeManualRepoOrder(this.state.ui?.manualRepoOrder),
      browserDefaultZoomLevel: normalizeBrowserPageZoomLevel(
        this.state.ui?.browserDefaultZoomLevel
      ),
      showDotfilesByWorktree: normalizeShowDotfilesByWorktree(
        this.state.ui?.showDotfilesByWorktree
      ),
      featureTipsSeenIds: normalizeFeatureTipIds(this.state.ui?.featureTipsSeenIds),
      contextualToursSeenIds: normalizeContextualTourIds(this.state.ui?.contextualToursSeenIds),
      featureInteractions: normalizeFeatureInteractions(this.state.ui?.featureInteractions),
      activeView: this.activeViewPreference.get()
    }
  }


}
