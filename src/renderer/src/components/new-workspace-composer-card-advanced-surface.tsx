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
import type { SetupConfig } from '@/lib/new-workspace'
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


type ComposerSurfaceContext = Record<string, any>

function SetupCommandPreview({ setupConfig }: { setupConfig: SetupConfig }): React.JSX.Element {
  // Why: just the script in a quiet monochrome card — the source label (orca.yaml / local) and
  // the run-setup toggle live in the section header above, so the card carries no chrome of its
  // own. Neutral foreground avoids the colored-terminal look. max-h keeps long scripts from
  // growing the dialog past the viewport.
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 shadow-inner">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-foreground/90 scrollbar-sleek">
        {setupConfig.command}
      </pre>
    </div>
  )
}


export default function NewWorkspaceComposerCardAdvancedSurface({
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
    <div>
        {/* Why: keep the Advanced disclosure header grouped with the content below while preserving spacing from the Agent field above. */}
        <div className="!mb-2">
          {/* Why: -ml-2 pulls the button so its label aligns flush-left with the field labels above
              while the padded hover highlight extends past the label on the left. The scroll
              container's px-2 inset gives that overhang room so it isn't clipped. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleAdvanced}
            className="-ml-2 text-xs"
          >
            {translate('auto.components.NewWorkspaceComposerCard.f0470c7383', 'Advanced')}
            <ChevronDown
              className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')}
            />
          </Button>
        </div>

        <div
          className={cn(
            'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
            !advancedOpen && '!mt-2',
            advancedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
          aria-hidden={!advancedOpen}
        >
          <div className="min-h-0">
            {/* Why: px-1 gives the Note textarea's 3px outset focus ring breathing room so the overflow-hidden drawer doesn't clip it. */}
            <div
              className={cn(
                'space-y-4 px-1 pt-1 pb-3 transition-[opacity,transform] duration-150 ease-out',
                advancedOpen
                  ? 'translate-y-0 opacity-100 delay-200'
                  : '-translate-y-1 opacity-0 delay-0'
              )}
            >
              {smartNameSelection ? (
                // Why: with a source pill the smart field isn't editable, so surface the derived name here; a typed name already is the name field.
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {translate('auto.components.NewWorkspaceComposerCard.2688050e4b', 'Name')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => onNameValueChange(event.target.value)}
                    placeholder={translate(
                      'auto.components.NewWorkspaceComposerCard.0ee17638fe',
                      'Workspace name'
                    )}
                    className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              ) : null}

              {/* Why: for a tracked work item (PR/issue/MR/Linear) the branch is derived from the item, so a manual override here would be silently ignored. */}
              {selectedRepoIsGit &&
              branchesEnabled &&
              (!smartNameSelection || smartNameSelection.kind === 'branch') ? (
                <div className="space-y-1">
                  <label
                    htmlFor={branchNameInputId}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {translate(
                      'auto.components.NewWorkspaceComposerCard.branchName',
                      'Branch name'
                    )}
                  </label>
                  <input
                    id={branchNameInputId}
                    type="text"
                    value={branchNameOverride ?? ''}
                    onChange={(event) => onBranchNameOverrideChange(event.target.value)}
                    placeholder={translate(
                      'auto.components.NewWorkspaceComposerCard.branchNamePlaceholder',
                      'feature/my-branch'
                    )}
                    className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              ) : null}

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {translate('auto.components.NewWorkspaceComposerCard.f8728aa4f9', 'Note')}
                </label>
                <textarea
                  value={note}
                  onChange={(event) => onNoteChange(event.target.value)}
                  onPaste={handleNotePaste}
                  onInput={(event) => {
                    // Why: reset then size to content so short notes stay compact and long ones grow without a scrollbar until max-h clamps.
                    const ta = event.currentTarget
                    ta.style.height = 'auto'
                    ta.style.height = `${ta.scrollHeight}px`
                  }}
                  placeholder={translate(
                    'auto.components.NewWorkspaceComposerCard.090cfedeb4',
                    'Write a note'
                  )}
                  rows={1}
                  className="w-full min-w-0 resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 max-h-40"
                />
              </div>

              {setupControlsEnabled && setupConfig ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      {setupConfigLabel}
                    </label>
                    {/* Why: a quiet monospace filename chip (not an uppercase tag) — orca.yaml is a
                        literal filename, so it reads as code, matching the app's path styling. */}
                    <span className="rounded border border-border/50 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {setupConfig.source === 'yaml'
                        ? translate(
                            'auto.components.NewWorkspaceComposerCard.23bb365554',
                            'orca.yaml'
                          )
                        : setupConfig.source === 'both'
                          ? translate(
                              'auto.components.NewWorkspaceComposerCard.326a578923',
                              'orca.yaml + local'
                            )
                          : translate(
                              'auto.components.NewWorkspaceComposerCard.92e34f0311',
                              'local settings'
                            )}
                    </span>
                  </div>

                  {/* Why: `orca.yaml` is the committed source of truth for shared setup,
                      so the preview reconstructs the real YAML shape instead of showing a raw
                      shell blob that hides where the command came from. */}
                  <SetupCommandPreview setupConfig={setupConfig} />

                  {/* Why: group the run-setup and wait-for-setup toggles in one bordered box so
                      they read as a single settings cluster, aligned hard-right. */}
                  {!requiresExplicitSetupChoice || showSetupAgentStartupPolicy ? (
                    <div className="rounded-md border border-border/60 bg-muted/25">
                      {requiresExplicitSetupChoice ? null : (
                        <div className="flex items-center justify-between gap-3 p-3">
                          <span className="text-xs font-medium text-foreground">
                            {setupRunLabel}
                          </span>
                          <SettingsSwitch
                            checked={resolvedSetupDecision === 'run'}
                            onChange={() =>
                              onSetupDecisionChange(
                                resolvedSetupDecision === 'run' ? 'skip' : 'run'
                              )
                            }
                            ariaLabel={setupRunLabel}
                          />
                        </div>
                      )}
                      {showSetupAgentStartupPolicy ? (
                        // Why: nothing to wait for when setup won't run — disable the toggle and
                        // dim the label so it reads as inactive (the switch dims itself).
                        <div className="flex items-start justify-between gap-3 p-3">
                          <span
                            className={cn(
                              'min-w-0 space-y-1',
                              resolvedSetupDecision === 'run' ? '' : 'opacity-50'
                            )}
                          >
                            <span className="block text-xs font-medium text-foreground">
                              {translate(
                                'auto.components.NewWorkspaceComposerCard.waitForSetupBeforeAgent',
                                'Wait for setup to complete before starting agent'
                              )}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {translate(
                                'auto.components.NewWorkspaceComposerCard.waitForSetupBeforeAgentHelp',
                                'Turn this on when setup installs dependencies, MCP servers, or config files the agent needs during startup.'
                              )}
                            </span>
                          </span>
                          <SettingsSwitch
                            checked={setupAgentStartupPolicy === 'wait-for-setup'}
                            disabled={resolvedSetupDecision !== 'run'}
                            onChange={() =>
                              onSetupAgentStartupPolicyChange(
                                setupAgentStartupPolicy === 'wait-for-setup'
                                  ? 'start-immediately'
                                  : 'wait-for-setup'
                              )
                            }
                            ariaLabel={translate(
                              'auto.components.NewWorkspaceComposerCard.waitForSetupBeforeAgent',
                              'Wait for setup to complete before starting agent'
                            )}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {requiresExplicitSetupChoice ? (
                    <div className="space-y-2">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        {setupAskLabel}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          onClick={() => onSetupDecisionChange('run')}
                          variant={setupDecision === 'run' ? 'default' : 'outline'}
                          size="sm"
                        >
                          {setupRunButtonLabel}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => onSetupDecisionChange('skip')}
                          variant={setupDecision === 'skip' ? 'secondary' : 'outline'}
                          size="sm"
                        >
                          {setupSkipButtonLabel}
                        </Button>
                      </div>
                      {!setupDecision ? (
                        <div className="text-xs text-muted-foreground">
                          {shouldWaitForSetupCheck
                            ? translate(
                                'auto.components.NewWorkspaceComposerCard.803b7fe72f',
                                'Checking setup configuration...'
                              )
                            : translate(
                                'auto.components.NewWorkspaceComposerCard.9a70e4859e',
                                'Choose whether to run setup before creating this workspace.'
                              )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {sparseControlsEnabled ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {translate(
                      'auto.components.NewWorkspaceComposerCard.d861de981b',
                      'Sparse checkout'
                    )}
                  </label>
                  <SparseCheckoutPresetSelect
                    repoId={repoId}
                    presets={sparsePresets}
                    selectedPresetId={sparseSelectedPresetId}
                    onSelectPreset={onSparseSelectPreset}
                    disabled={!canUseSparseCheckout}
                  />
                  {!canUseSparseCheckout ? (
                    <p className="text-[11px] text-muted-foreground">
                      {translate(
                        'auto.components.NewWorkspaceComposerCard.cbb47ee0dc',
                        'Only available for local Git projects.'
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>


  )
}
