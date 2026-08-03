import React from 'react'
import { GHEditSection } from './github-item-dialog-edit'
import { GitHubItemDialogHeader } from './github-item-dialog-header'
import { GitHubItemDialogIssueBody } from './github-item-dialog-issue-body'
import { GitHubItemDialogPRTabs } from './github-item-dialog-pr-tabs'
import type { GitHubItemDialogContentProps } from './github-item-dialog-content-props'

export type { GitHubItemDialogContentProps } from './github-item-dialog-content-props'

export function GitHubItemDialogContent(
  props: GitHubItemDialogContentProps
): React.JSX.Element | null {
  const {
    workItem,
    isIssuePage,
    repoPath,
    effectiveRepoId,
    sourceContext,
    projectOrigin,
    canUseDetailsRepoContext,
    details,
    localState,
    localLabels,
    issueAttachedWorkspaceLabel,
    setLocalState,
    setLocalLabels,
    invalidateCurrentDetailsCache,
    onUse,
    handleOpenOrUseIssueWorkspace,
    error
  } = props

  return workItem ? (
    <div className="flex h-full min-h-0 flex-col">
      <GitHubItemDialogHeader {...props} />

      {!isIssuePage && (canUseDetailsRepoContext || projectOrigin) && (
        <GHEditSection
          item={workItem}
          repoPath={repoPath}
          repoId={effectiveRepoId}
          sourceContext={sourceContext}
          projectOrigin={projectOrigin}
          localState={localState}
          localLabels={localLabels}
          onStateChange={setLocalState}
          onLabelsChange={setLocalLabels}
          onMutated={invalidateCurrentDetailsCache}
          assignees={details?.assignees ?? []}
          onUse={onUse}
          onOpenOrUse={handleOpenOrUseIssueWorkspace}
          attachedWorkspaceLabel={issueAttachedWorkspaceLabel}
        />
      )}

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="px-4 py-6 text-[12px] text-destructive">{error}</div>
        ) : isIssuePage ? (
          <GitHubItemDialogIssueBody {...props} />
        ) : (
          <GitHubItemDialogPRTabs {...props} />
        )}
      </div>
    </div>
  ) : null
}
