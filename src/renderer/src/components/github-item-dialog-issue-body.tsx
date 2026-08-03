import React from 'react'
import { ConversationTab } from './github-item-dialog-conversation'
import { GHEditSection } from './github-item-dialog-edit'
import {
  patchCachedPRChecks,
  patchCachedPRReviewRequests,
  patchCachedWorkItemBody
} from './github-item-dialog-cache'
import type { GitHubItemDialogContentProps } from './github-item-dialog-content-props'

export function GitHubItemDialogIssueBody({
  workItem,
  repoPath,
  effectiveRepoId,
  sourceContext,
  canUseDetailsRepoContext,
  projectOrigin,
  details,
  displayWorkItem,
  issueAttachedWorkspaceLabel,
  body,
  comments,
  timelineItems,
  files,
  checks,
  localState,
  localLabels,
  loading,
  detailsLoaded,
  detailsCacheKey,
  setLocalState,
  setLocalLabels,
  invalidateCurrentDetailsCache,
  appendOptimisticComment,
  onUse,
  handleOpenOrUseIssueWorkspace,
  onReviewRequestsChange
}: GitHubItemDialogContentProps): React.JSX.Element {
  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-sleek bg-background">
      {/* Why: full content width so the description isn't squeezed by a right rail; px-2 + ConversationTab px-4 = header px-6. */}
      <div className="w-full px-2 py-6">
        {(canUseDetailsRepoContext || projectOrigin) && (
          <div className="mb-5 border-b border-border/60 px-4 pb-5">
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
              layout="top-columns"
            />
          </div>
        )}
        <div className="min-w-0">
          <ConversationTab
            item={displayWorkItem ?? workItem}
            repoPath={repoPath}
            repoId={effectiveRepoId}
            sourceContext={sourceContext}
            body={body}
            comments={comments}
            timelineItems={timelineItems}
            files={files}
            headSha={details?.headSha}
            baseSha={details?.baseSha}
            loading={loading}
            detailsLoaded={detailsLoaded}
            checks={checks}
            localState={localState}
            onStateChange={setLocalState}
            projectOrigin={projectOrigin}
            onMutated={invalidateCurrentDetailsCache}
            onChecksUpdated={(nextChecks) => {
              if (detailsCacheKey) {
                patchCachedPRChecks(detailsCacheKey, nextChecks)
              }
            }}
            onBodyUpdated={(nextBody) => {
              if (detailsCacheKey) {
                patchCachedWorkItemBody(detailsCacheKey, nextBody)
              }
            }}
            onCommentAdded={appendOptimisticComment}
            onReviewersRequested={(nextReviewRequests) => {
              if (detailsCacheKey) {
                patchCachedPRReviewRequests(detailsCacheKey, nextReviewRequests)
              }
              onReviewRequestsChange?.(
                { id: workItem.id, repoId: workItem.repoId },
                nextReviewRequests
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}
