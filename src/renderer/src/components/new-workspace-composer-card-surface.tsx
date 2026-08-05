import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CornerDownLeft,
  FolderPlus,
  LoaderCircle,
  PlugZap,
  Settings2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSwitch } from '@/components/settings/SettingsFormControls'
import type RepoCombobox from '@/components/repo/RepoCombobox'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { getAgentCatalog } from '@/lib/agent-catalog'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../shared/tui-agent-selection'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { WORKSPACE_FILE_PATH_MIME } from '@/lib/workspace-file-drag'
import {
  TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES,
  measureTextControlPasteByteLength,
  pasteTextIntoTextControl,
  shouldHandleTextControlPaste
} from '@/lib/text-control-paste'
import { getScreenSubmitModifierLabel } from '@/lib/screen-submit-shortcut'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import type {
  GitHubWorkItem,
  GitLabWorkItem,
  JiraIssue,
  LinearIssue,
  SetupAgentStartupPolicy,
  OrcaHooks,
  SparsePreset,
  TuiAgent
} from '../../../shared/types'
import SparseCheckoutPresetSelect from '@/components/sparse/SparseCheckoutPresetSelect'
import SmartWorkspaceNameField, {
  type SmartWorkspaceNameSelection
} from '@/components/new-workspace/SmartWorkspaceNameField'
import type { SmartNameMode } from '@/components/new-workspace/smart-workspace-source-results'
import ProjectCombobox from '@/components/new-workspace/ProjectCombobox'
import RunTargetCombobox from '@/components/new-workspace/RunTargetCombobox'
import {
  AddRemoteHostDialog,
  type AddRemoteHostMode
} from '@/components/sidebar/AddRemoteHostDialog'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/project-host-setup-options'
import type { WorkspaceCreateErrorDisplay } from '@/lib/workspace-create-error-format'
import type { SshConnectionStatus } from '../../../shared/ssh-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

import NewWorkspaceComposerCardAdvancedSurface from './new-workspace-composer-card-advanced-surface'

type ComposerSurfaceContext = Record<string, any>



export default function NewWorkspaceComposerCardSurface({
  context
}: {
  context: ComposerSurfaceContext
}): React.JSX.Element {
  const {
  activeModal,
  addRemoteHostMode,
  advancedOpen,
  allowSmartNameAddProject,
  branchNameInputId,
  branchNameOverride,
  branchesEnabled,
  canReuseSelectedBranch,
  canUseSparseCheckout,
  cancelNameInputFocusFrame,
  composerRef,
  connectButtonLabel,
  containerClassName,
  contextualTourSource,
  createDisabled,
  createError,
  createMultiple,
  creating,
  defaultTuiAgent,
  detectedAgentIds,
  disabledTuiAgents,
  dragHandlers,
  eligibleRepos,
  emptyProjectMessage,
  focusNameInput,
  forkPushWarning,
  handleAddRemoteServer,
  handleAddRepo,
  handleAddSshHost,
  handleConnectRunTargetHost,
  handleNotePaste,
  handleProjectHostSetupChange,
  handleSetDefaultAgent,
  isFileDragOver,
  name,
  nameInputFocusFrameRef,
  nameInputRef,
  needsSetupProjectHostSetupOptions,
  note,
  onAddProjectOverride,
  onBranchNameOverrideChange,
  onClearSmartNameSelection,
  onComposerNodeChange,
  onConnectSelectedRepo,
  onCreate,
  onCreateMultipleChange,
  onNameValueChange,
  onNoteChange,
  onOpenAgentSettings,
  onOpenJiraSettings,
  onProjectChange,
  onProjectHostSetupChange,
  onQuickAgentChange,
  onRepoChange,
  onReuseSelectedBranchChange,
  onSetupAgentStartupPolicyChange,
  onSetupDecisionChange,
  onSmartBranchSelect,
  onSmartGitHubItemSelect,
  onSmartGitLabItemSelect,
  onSmartJiraIssueSelect,
  onSmartLinearIssueSelect,
  onSmartNameModeChange,
  onSparseSelectPreset,
  onToggleAdvanced,
  openModal,
  primaryActionLabel,
  projectDescriptionId,
  projectError,
  projectHostSetupOptions,
  projectLabel,
  projectOptions,
  projectPlaceholder,
  quickAgent,
  readyProjectHostSetupOptions,
  repoBackedSearchRepos,
  repoBackedSourcesDisabled,
  repoId,
  requiresExplicitSetupChoice,
  resolvedSetupDecision,
  reuseSelectedBranch,
  selectedProjectHostSetupId,
  selectedProjectId,
  selectedProjectName,
  selectedRepoConnectInProgress,
  selectedRepoConnectionId,
  selectedRepoIsGit,
  selectedRepoName,
  selectedRepoRequiresConnection,
  selectedRepoSshStatus,
  setComposerNode,
  setupAgentStartupPolicy,
  setupAskLabel,
  setupConfig,
  setupConfigLabel,
  setupControlsEnabled,
  setupDecision,
  setupRunButtonLabel,
  setupRunLabel,
  setupSkipButtonLabel,
  shouldShowRunTargetPicker,
  shouldWaitForSetupCheck,
  showAddProjectButton,
  showCreateMultiple,
  showSetupAgentStartupPolicy,
  smartNameGitHubSourceContext,
  smartNameJiraSourceContext,
  smartNameRepoSwitchTarget,
  smartNameSelection,
  sparseControlsEnabled,
  sparsePresets,
  sparseSelectedPresetId,
  sshStatusLabel,
  submitShortcutModifierLabel,
  updateSettings,
  visibleQuickAgents
} = context
    return (
    <div
      ref={setComposerNode}
      data-workspace-composer-root="true"
      // Why: preload routes native file drops by the nearest data-native-file-drop-target marker, so tag the root to catch card-wide drops.
      data-native-file-drop-target="composer"
      onDragEnter={dragHandlers.onDragEnter}
      onDragLeave={dragHandlers.onDragLeave}
      className={cn(
        'grid min-w-0 gap-1 rounded-md transition',
        isFileDragOver && 'ring-2 ring-ring/30',
        containerClassName
      )}
    >
      <div className="min-w-0 space-y-4 pt-3">
        <div className="space-y-1" data-contextual-tour-target="workspace-creation-project">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {projectLabel ??
                translate('auto.components.NewWorkspaceComposerCard.969a8bff66', 'Project')}
            </label>
            {showAddProjectButton ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleAddRepo}
                    className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                    aria-label={translate(
                      'auto.components.NewWorkspaceComposerCard.d6b0a96f32',
                      'Add project'
                    )}
                  >
                    <FolderPlus className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {translate('auto.components.NewWorkspaceComposerCard.d6b0a96f32', 'Add project')}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <ProjectCombobox
            options={projectOptions}
            value={selectedProjectId}
            onValueChange={onProjectChange}
            onValueSelected={focusNameInput}
            onAddProject={handleAddRepo}
            placeholder={
              projectPlaceholder ??
              translate('auto.components.NewWorkspaceComposerCard.dccd26d4e4', 'Choose project')
            }
            // Why: programmatic .focus() doesn't reliably trigger :focus-visible in Chromium, so mirror the Input ring onto :focus.
            triggerClassName="h-9 w-full border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            invalid={Boolean(projectError)}
            describedBy={projectDescriptionId}
          />
          {projectError ? (
            <p id={projectDescriptionId} className="text-[11px] text-destructive">
              {projectError}
            </p>
          ) : projectOptions.length === 0 ? (
            <p id={projectDescriptionId} className="text-[11px] text-muted-foreground">
              {emptyProjectMessage ??
                translate(
                  'auto.components.NewWorkspaceComposerCard.addProjectBeforeWorkspace',
                  'Add a project before creating a workspace.'
                )}
            </p>
          ) : null}
          {shouldShowRunTargetPicker ? (
            // Why: Run on is nested in the Project block (so they share the
            // error/empty states), which put it on the block's 4px rhythm. It's
            // its own field, so give it the 16px other fields get.
            <div className="space-y-1 pt-3">
              <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
                {translate('auto.components.NewWorkspaceComposerCard.runOn', 'Run on')}
              </label>
              <RunTargetCombobox
                hostOptions={projectHostSetupOptions}
                hostValue={selectedProjectHostSetupId ?? null}
                onHostChange={handleProjectHostSetupChange}
                onAddSshHost={handleAddSshHost}
                onAddRemoteServer={handleAddRemoteServer}
                onConnectHost={handleConnectRunTargetHost}
              />
            </div>
          ) : null}
          {selectedRepoRequiresConnection && selectedRepoConnectionId ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/35 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">
                  {translate('auto.components.NewWorkspaceComposerCard.b5a0796911', 'Connect')}{' '}
                  {selectedProjectName}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{sshStatusLabel}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void onConnectSelectedRepo()}
                disabled={selectedRepoConnectInProgress}
                className="shrink-0"
              >
                {selectedRepoConnectInProgress ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <PlugZap className="size-3.5" />
                )}
                {selectedRepoConnectInProgress
                  ? translate('auto.components.NewWorkspaceComposerCard.f660aa1454', 'Connecting')
                  : connectButtonLabel}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1" data-contextual-tour-target="workspace-creation-name">
          <label className="block min-w-0 truncate text-xs font-medium text-muted-foreground">
            {selectedRepoIsGit
              ? translate(
                  'auto.components.NewWorkspaceComposerCard.ac3748dcda',
                  "Name or 'Create From'"
                )
              : translate(
                  'auto.components.NewWorkspaceComposerCard.0ee17638fe',
                  'Workspace name'
                )}{' '}
            <span className="text-muted-foreground/70">
              {translate('auto.components.NewWorkspaceComposerCard.0c5d6a479c', '[Optional]')}
            </span>
          </label>
          <SmartWorkspaceNameField
            inputRef={nameInputRef}
            repos={eligibleRepos}
            repoId={repoId}
            onRepoChange={onRepoChange}
            value={name}
            onValueChange={onNameValueChange}
            onGitHubItemSelect={onSmartGitHubItemSelect}
            onGitLabItemSelect={onSmartGitLabItemSelect}
            onBranchSelect={onSmartBranchSelect}
            onLinearIssueSelect={onSmartLinearIssueSelect}
            onJiraIssueSelect={onSmartJiraIssueSelect}
            onOpenJiraSettings={onOpenJiraSettings}
            selectedSource={smartNameSelection}
            onClearSelectedSource={onClearSmartNameSelection}
            githubSourceContext={smartNameGitHubSourceContext}
            jiraSourceContext={smartNameJiraSourceContext}
            disabled={selectedRepoRequiresConnection}
            disabledPlaceholder={translate(
              'auto.components.NewWorkspaceComposerCard.connectProjectFirst',
              'Connect this project first'
            )}
            textOnly={!selectedRepoIsGit}
            branchesEnabled={branchesEnabled}
            repoBackedSourcesDisabled={repoBackedSourcesDisabled}
            repoBackedSearchRepos={repoBackedSearchRepos}
            allowCrossRepoProjectAdd={allowSmartNameAddProject}
            crossRepoSwitchTarget={smartNameRepoSwitchTarget}
            onActiveSourceModeChange={onSmartNameModeChange}
            onPlainEnter={() => {
              // Why: Enter advances focus to the Agent combobox rather than submitting, keeping keyboard flow through the form.
              const root = composerRef?.current
              const agentTrigger = root?.querySelector<HTMLElement>(
                '[data-agent-combobox-root="true"][role="combobox"]'
              )
              agentTrigger?.focus()
            }}
          />
          {forkPushWarning ? (
            <p className="flex items-start gap-1.5 text-[11px] text-yellow-600 dark:text-yellow-500">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{forkPushWarning}</span>
            </p>
          ) : null}
          {/* Why (#5181): sits under the branch selection (not Name, which can differ) so reusing the picked branch is an explicit choice. */}
          <div
            className={cn(
              'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
              canReuseSelectedBranch ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            )}
            aria-hidden={!canReuseSelectedBranch}
          >
            <div className="min-h-0">
              <div className="space-y-1 pt-1">
                <label className="group flex w-fit items-center gap-2 text-xs text-foreground">
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-[3px] border shadow-sm transition',
                      reuseSelectedBranch
                        ? 'border-emerald-500/60 bg-emerald-500 text-white'
                        : 'border-foreground/20 bg-background dark:border-white/20 dark:bg-muted/10'
                    )}
                  >
                    <Check
                      className={cn(
                        'size-3 transition-opacity',
                        reuseSelectedBranch ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </span>
                  <input
                    type="checkbox"
                    checked={reuseSelectedBranch}
                    onChange={(event) => onReuseSelectedBranchChange(event.target.checked)}
                    // Why: row is aria-hidden while collapsed, so disable the input too (no focusable control inside an aria-hidden tree).
                    disabled={!canReuseSelectedBranch}
                    className="sr-only"
                  />
                  <span>
                    {translate(
                      'auto.components.NewWorkspaceComposerCard.reuseExistingBranch',
                      'Reuse branch'
                    )}
                  </span>
                </label>
                <p className="pl-6 text-[11px] text-muted-foreground">
                  {translate(
                    'auto.components.NewWorkspaceComposerCard.reuseExistingBranchHint',
                    'Check out the existing branch instead of creating a new one from it.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-1" data-contextual-tour-target="workspace-creation-agent">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {translate('auto.components.NewWorkspaceComposerCard.01d1e8f601', 'Agent')}
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onOpenAgentSettings}
                  // Why: keep Tab flow Name → Agent; tabIndex=-1 so this settings detour doesn't add a keystroke to every creation.
                  tabIndex={-1}
                  className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label={translate(
                    'auto.components.NewWorkspaceComposerCard.ab63f25397',
                    'Open agent settings'
                  )}
                >
                  <Settings2 className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate(
                  'auto.components.NewWorkspaceComposerCard.ba64270bdb',
                  'Configure agents'
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          <AgentCombobox
            agents={visibleQuickAgents}
            value={quickAgent}
            onValueChange={onQuickAgentChange}
            onOpenManageAgents={onOpenAgentSettings}
            defaultAgent={defaultTuiAgent}
            onSetDefault={handleSetDefaultAgent}
            // Why: match Project/Run-on — full-width form row, no 260px min that can overflow the dialog column.
            allowNarrowTrigger
            triggerClassName="h-9 w-full min-w-0 border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            onTriggerEnter={createDisabled ? undefined : onCreate}
          />
        </div>


    <NewWorkspaceComposerCardAdvancedSurface context={context} />
      {createError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {createError.help ? (
            <div className="space-y-1">
              <p className="font-medium">{createError.title}</p>
              <p>{createError.message}</p>
              <p className="text-destructive/85">{createError.help}</p>
            </div>
          ) : (
            createError.message
          )}
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-center gap-3',
          showCreateMultiple ? 'justify-between' : 'justify-end'
        )}
      >
        {showCreateMultiple ? (
          <button
            type="button"
            role="switch"
            aria-checked={createMultiple}
            onClick={() => onCreateMultipleChange?.(!createMultiple)}
            className="group flex w-fit cursor-pointer items-center gap-2 rounded-md text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span
              aria-hidden
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors',
                createMultiple ? 'bg-foreground' : 'bg-muted-foreground/30'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform',
                  createMultiple ? 'translate-x-4' : 'translate-x-0.5'
                )}
              />
            </span>
            <span className="text-muted-foreground transition-colors group-hover:text-foreground">
              {translate('auto.components.NewWorkspaceComposerCard.createMultiple', 'Create more')}
            </span>
          </button>
        ) : null}
        <Button
          onClick={() => void onCreate()}
          disabled={createDisabled}
          size="sm"
          className="text-xs"
        >
          {creating ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {primaryActionLabel}
          <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-current/80">
            <span>{submitShortcutModifierLabel}</span>
            <CornerDownLeft className="size-3" />
          </span>
        </Button>
      </div>
      {/* Why: layer the host-add form over the composer instead of navigating to Settings so
          the in-progress workspace form is preserved; on success the new host flows back into
          the run-target picker via the store. */}
      <AddRemoteHostDialog mode={addRemoteHostMode} onOpenChange={setAddRemoteHostMode} />
    </div>
  )
}
