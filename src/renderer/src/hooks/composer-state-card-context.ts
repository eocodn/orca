/* Typed inputs assembled by useComposerState for card projection. */
import type { ComposerCardProps } from './composer-state-contracts'

type Repo = ComposerCardProps['eligibleRepos'][number]
type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>

export type ComposerCardBuildContext = {
  repoId: string
  workspaceSeedName: string
  creating: boolean
  shouldWaitForSetupCheck: boolean
  shouldWaitForIssueAutomationCheck: boolean
  sourceIntentBlocksCreate: boolean
  requiresExplicitSetupChoice: boolean
  setupDecision: ComposerCardProps['setupDecision']
  selectedRepoRequiresConnection: boolean
  sparseError: string | null
  createGateMode: 'full' | 'quick'
  isProjectGroupTarget: boolean
  folderCreateDisabled: boolean
  folderSourceRepos: ComposerCardProps['eligibleRepos']
  eligibleRepos: ComposerCardProps['eligibleRepos']
  projectOptions: ComposerCardProps['projectOptions']
  selectedProjectId: string | null
  selectedRepoIsGit: boolean
  handleFolderSourceRepoChange: ComposerCardProps['onRepoChange']
  handleRepoChange: ComposerCardProps['onRepoChange']
  handleProjectChange: ComposerCardProps['onProjectChange']
  projectHostSetupOptions: ComposerCardProps['projectHostSetupOptions']
  selectedProjectHostSetupId: string | null
  handleProjectHostSetupChange: ComposerCardProps['onProjectHostSetupChange']
  smartNameSelection: ComposerCardProps['smartNameSelection']
  name: string
  handleNameValueChange: ComposerCardProps['onNameValueChange']
  branchNameOverride: string | undefined
  handleBranchNameOverrideChange: ComposerCardProps['onBranchNameOverrideChange']
  handleSmartGitHubItemSelect: ComposerCardProps['onSmartGitHubItemSelect']
  handleSmartGitLabItemSelect: ComposerCardProps['onSmartGitLabItemSelect']
  handleSmartBranchSelect: ComposerCardProps['onSmartBranchSelect']
  setSmartNameMode: NonNullable<ComposerCardProps['onSmartNameModeChange']>
  handleSmartLinearIssueSelect: ComposerCardProps['onSmartLinearIssueSelect']
  handleSmartJiraIssueSelect: ComposerCardProps['onSmartJiraIssueSelect']
  handleOpenJiraSettings: ComposerCardProps['onOpenJiraSettings']
  selectedRepoGitHubSourceContext: ComposerCardProps['smartNameGitHubSourceContext']
  smartNameJiraSourceContext: ComposerCardProps['smartNameJiraSourceContext']
  handleClearSmartNameSelection: ComposerCardProps['onClearSmartNameSelection']
  reuseEligibleBranch: string | null
  reuseSelectedBranch: boolean
  handleReuseSelectedBranchChange: ComposerCardProps['onReuseSelectedBranchChange']
  createMultiple: boolean
  setCreateMultiple: ComposerCardProps['onCreateMultipleChange']
  agentPrompt: string
  setAgentPrompt: ComposerCardProps['onAgentPromptChange']
  shouldApplyLinkedOnlyTemplate: boolean
  linkedOnlyTemplatePrompt: string
  attachmentPaths: string[]
  handleAddAttachment: () => void | Promise<void>
  getAttachmentLabel: ComposerCardProps['getAttachmentLabel']
  setAttachmentPaths: StateSetter<string[]>
  linkedWorkItem: ComposerCardProps['linkedWorkItem']
  handleRemoveLinkedWorkItem: ComposerCardProps['onRemoveLinkedWorkItem']
  linkPopoverOpen: boolean
  handleLinkPopoverChange: ComposerCardProps['onLinkPopoverOpenChange']
  linkQuery: string
  setLinkQuery: ComposerCardProps['onLinkQueryChange']
  filteredLinkItems: ComposerCardProps['filteredLinkItems']
  linkItemsLoading: boolean
  linkDirectLoading: boolean
  normalizedLinkQuery: ComposerCardProps['normalizedLinkQuery']
  handleSelectLinkedItem: ComposerCardProps['onSelectLinkedItem']
  tuiAgent: ComposerCardProps['tuiAgent']
  setTuiAgent: ComposerCardProps['onTuiAgentChange']
  folderDetectedAgentIds: ComposerCardProps['detectedAgentIds']
  detectedAgentIds: ComposerCardProps['detectedAgentIds']
  handleOpenAgentSettings: ComposerCardProps['onOpenAgentSettings']
  advancedOpen: boolean
  setAdvancedOpen: StateSetter<boolean>
  projectError: string | null
  pathStatusProjectError: string | null
  submit: () => void | Promise<void>
  baseBranch: string | undefined
  handleBaseBranchChange: ComposerCardProps['onBaseBranchChange']
  handleBaseBranchPrSelect: ComposerCardProps['onBaseBranchPrSelect']
  handleBaseBranchMrSelect: NonNullable<ComposerCardProps['onBaseBranchMrSelect']>
  selectedRepo: Repo | undefined
  selectedRepoConnectionId: ComposerCardProps['selectedRepoConnectionId']
  selectedRepoSshStatus: ComposerCardProps['selectedRepoSshStatus']
  folderTargetIsRemote: boolean
  folderTargetConnectionId: string | null
  folderTargetSshStatus: ComposerCardProps['selectedRepoSshStatus']
  folderTargetRequiresConnection: boolean
  selectedRepoConnectInProgress: boolean
  folderTargetConnectInProgress: boolean
  onConnectSelectedProjectGroup: ComposerCardProps['onConnectSelectedRepo']
  onConnectSelectedRepo: ComposerCardProps['onConnectSelectedRepo']
  startFromResetHint: string | null
  forkPushWarning: string | null
  note: string
  setNote: ComposerCardProps['onNoteChange']
  setupConfig: ComposerCardProps['setupConfig']
  resolvedSetupDecision: ComposerCardProps['resolvedSetupDecision']
  setupAgentStartupPolicy: ComposerCardProps['setupAgentStartupPolicy']
  handleSetupAgentStartupPolicyChange: ComposerCardProps['onSetupAgentStartupPolicyChange']
  createError: ComposerCardProps['createError']
  sparsePresets: ComposerCardProps['sparsePresets']
  sparseSelectedPresetId: ComposerCardProps['sparseSelectedPresetId']
  handleSparseSelectPreset: ComposerCardProps['onSparseSelectPreset']
}
