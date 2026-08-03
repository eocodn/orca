import { useCallback } from 'react'
import { getAttachmentLabel } from '@/lib/new-workspace'
import { useComposerAttachmentActions } from './composer-state-attachment-actions'
import { buildComposerCardProps } from './composer-state-card-props'
import { useComposerFormState } from './composer-state-form-state'
import { useComposerFolderSubmission } from './composer-state-folder-submission'
import { useComposerLinkedItemActions } from './composer-state-linked-item-actions'
import { useComposerLinkLookup } from './composer-state-link-lookup'
import { useComposerQuickSubmission } from './composer-state-quick-submission'
import { useComposerRepositoryActions } from './composer-state-repository-actions'
import { useComposerRuntimeDerived } from './composer-state-runtime-derived'
import { useComposerRuntimeEffects } from './composer-state-runtime-effects'
import { useComposerSetupPolicy } from './composer-state-setup-policy'
import { useComposerSmartSourceActions } from './composer-state-smart-source-actions'
import { useComposerTargetState } from './composer-state-target-selection'
import { useComposerWorktreeSubmission } from './composer-state-worktree-submission'
import type {
  UseComposerStateOptions,
  UseComposerStateResult
} from './composer-state-contracts'
export {
  canResolveFolderSmartGitHubSubmit,
  getInitialAutoManagedWorkspaceName,
  getMatchingLinkedTaskSourceContext,
  isExplicitWorkspaceNameInput,
  resolveInitialWorkspaceRunSeed,
  resolveSmartGitHubCreateNames
} from './composer-state-contracts'
export type {
  ComposerCardProps,
  InitialWorkspaceRunSeedInput,
  UseComposerStateOptions,
  UseComposerStateResult
} from './composer-state-contracts'

export function useComposerState(options: UseComposerStateOptions): UseComposerStateResult {
  const target = useComposerTargetState(options)
  const targetState = { ...options, ...target, ...target.actions }
  const form = useComposerFormState(targetState)
  const state = { ...targetState, ...form }

  const cancelPromptCaretFrame = useCallback((): void => {
    if (state.promptCaretFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(state.promptCaretFrameRef.current)
    state.promptCaretFrameRef.current = null
  }, [state.promptCaretFrameRef])

  const onComposerNodeChange = useCallback(
    (node: HTMLDivElement | null): void => {
      if (!node) {
        cancelPromptCaretFrame()
      }
    },
    [cancelPromptCaretFrame]
  )

  const setup = useComposerSetupPolicy(state)
  const withSetup = { ...state, ...setup }
  const runtimeDerived = useComposerRuntimeDerived(withSetup)
  const withRuntime = { ...withSetup, ...runtimeDerived }
  const runtimeEffects = useComposerRuntimeEffects(withRuntime)
  const withEffects = { ...withRuntime, ...runtimeEffects }
  const linkLookup = useComposerLinkLookup(withEffects)
  const withLookup = { ...withEffects, ...linkLookup }
  const linkedActions = useComposerLinkedItemActions(withLookup)
  const withLinkedActions = { ...withLookup, ...linkedActions }
  const repositoryActions = useComposerRepositoryActions(withLinkedActions)
  const withRepositoryActions = { ...withLinkedActions, ...repositoryActions }
  const smartActions = useComposerSmartSourceActions(withRepositoryActions)
  const withSmartActions = { ...withRepositoryActions, ...smartActions }

  const resetForNextCreate = useCallback(() => {
    state.setName('')
    state.lastAutoNameRef.current = ''
    state.setAgentPrompt('')
    state.setNote('')
    state.setAttachmentPaths([])
    state.setLinkedWorkItem(null)
    state.setLinkedTaskSourceContext(null)
    state.setLinkedIssue('')
    state.setLinkedPR(null)
    state.setLinkedGitLabIssue(null)
    state.setLinkedGitLabMR(null)
    state.setBranchNameOverride(undefined)
    state.setBranchNameOverridePreservesNameEdits(false)
    state.setCompareBaseRef(undefined)
    state.setPushTarget(undefined)
    state.setReuseSelectedBranch(false)
    state.setStartFromResetHint(null)
    state.setForkPushWarning(null)
    state.setCreateError(null)
    requestAnimationFrame(() => state.nameInputRef.current?.focus())
  }, [])

  const withReset = { ...withSmartActions, resetForNextCreate }
  const attachments = useComposerAttachmentActions({
    setAttachmentPaths: state.setAttachmentPaths,
    setAgentPrompt: state.setAgentPrompt,
    promptTextareaRef: state.promptTextareaRef,
    promptCaretFrameRef: state.promptCaretFrameRef,
    agentPromptRef: state.agentPromptRef,
    cancelPromptCaretFrame,
    selectedRepoSettings: state.selectedRepoSettings,
    connectionId: state.connectionId,
    selectedRepoPath: state.selectedRepoPath,
    selectedRepoSettingsRef: state.selectedRepoSettingsRef,
    connectionIdRef: state.connectionIdRef,
    selectedRepoPathRef: state.selectedRepoPathRef
  })
  const withAttachments = {
    ...withReset,
    ...attachments,
    getAttachmentLabel
  }

  const folder = useComposerFolderSubmission(withAttachments)
  const withFolder = { ...withAttachments, ...folder }
  const worktree = useComposerWorktreeSubmission(withFolder)
  const withWorktree = { ...withFolder, ...worktree }
  const quick = useComposerQuickSubmission(withWorktree)
  const withSubmission = { ...withWorktree, ...quick }

  const { cardProps, createDisabled } = buildComposerCardProps({
    ...withSubmission,
    createGateMode: options.createGateMode ?? 'full',
    submit: withSubmission.submit,
    getAttachmentLabel
  })

  return {
    cardProps,
    composerRef: state.composerRef,
    onComposerNodeChange,
    promptTextareaRef: state.promptTextareaRef,
    nameInputRef: state.nameInputRef,
    submit: withSubmission.submit,
    submitQuick: withSubmission.submitQuick,
    createDisabled,
    selectAddedProjectRepo: state.selectAddedProjectRepo
  }
}

export default useComposerState
