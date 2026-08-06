/* Checks panel render branch. */
// @ts-nocheck
import React from 'react'

export function renderChecksPanelReview(context: Record<string, unknown>): React.JSX.Element {
  const {
    activeConflictReview,
    activeConnectionId,
    activeGitLabReview,
    activeReview,
    activeSourceControlLaunchPlatform,
    activeWorktreeId,
    aiActionDisabledReason,
    canTargetPRComments,
    commentsDisabledReason,
    detachedHeadDisplay,
    handleAddPRComment,
    handleCancelEdit,
    handleDeleteComment,
    handleEditComment,
    handleFixChecksWithAI,
    handleLinkAnotherPullRequest,
    handleLoadCheckDetails,
    handleOpenPR,
    handleRefresh,
    handleReplyToComment,
    handleResolve,
    handleResolveCommentsWithAI,
    handleResolveConflictsWithAI,
    handleSaveTitle,
    handleStartEdit,
    handleTitleKeyDown,
    handleUnlinkPullRequest,
    isResolvingConflictsWithAI,
    linkedPR,
    pr,
    prRefreshState,
    refreshHostedReviewAfterMutation,
    repo,
    resolveCommentsWithAIDisabledReason,
    resolveSelectedThreadsAfterLaunch,
    saveLaunchActionDefault,
    setChecksPanelContentRef,
    settings,
    sourceControlAiActionsVisible,
    stateRequestKey,
    titleInputRef,
  } = context

const reviewShortLabel = activeReview.provider === 'gitlab' ? 'MR' : 'PR'
const shouldShowReviewTriageStrip =
  activeConflictReview !== null || getBrokenChecks(checks).length > 0
const hostedReviewModifierHintDestination = resolveChecksPanelHostedReviewModifierDestination(
  settings,
  Boolean(activeWorktreeId)
)
return (
  <div ref={setChecksPanelContentRef} className="flex-1 overflow-auto scrollbar-sleek">
    {/* Why: surface a background-refresh failure over stale cached PR data so a GitHub outage doesn't look like a normal panel. GitHub-only. */}
    {activeReview?.provider === 'github' && prRefreshState?.status === 'error' ? (
      <div
        role="alert"
        className="border-b border-border/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {getChecksPanelRefreshErrorBannerLine(prRefreshState.errorType)}
      </div>
    ) : null}
    {/* Hosted review header */}
    <div className="px-3 py-3 border-b border-border space-y-2.5">
      {/* Review number + state badge + refresh + open link */}
      <ChecksPanelReviewHeader
        review={activeReview}
        isRefreshing={isRefreshing}
        canUnlinkPullRequest={linkedPR !== null}
        modifierHintDestination={hostedReviewModifierHintDestination}
        onRefresh={() => void handleRefresh()}
        onOpenReview={handleOpenPR}
        onUnlinkPullRequest={handleUnlinkPullRequest}
        onLinkAnotherPullRequest={handleLinkAnotherPullRequest}
      />

      {detachedHeadDisplay && <DetachedHeadBadge display={detachedHeadDisplay} side="bottom" />}

      {/* Review title */}
      {editingTitle ? (
        <div className="flex items-center gap-1">
          <input
            ref={titleInputRef}
            className="flex-1 text-[12px] bg-background border border-border rounded px-2 py-1 text-foreground outline-none focus:ring-1 focus:ring-ring"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            disabled={titleSaving}
          />
          <button
            className="cursor-pointer rounded p-1 text-emerald-500 transition-colors hover:bg-accent hover:text-emerald-400 disabled:cursor-default disabled:opacity-50"
            title={translate('auto.components.right.sidebar.ChecksPanel.2ab7fd4b6d', 'Save')}
            onClick={() => void handleSaveTitle()}
            disabled={titleSaving}
          >
            {titleSaving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </button>
          <button
            className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
            title={translate('auto.components.right.sidebar.ChecksPanel.058039787c', 'Cancel')}
            onClick={handleCancelEdit}
            disabled={titleSaving}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div
          className="group/title flex items-start gap-1.5 cursor-pointer -mx-1 px-1 py-0.5 rounded hover:bg-accent/40 transition-colors"
          onClick={handleStartEdit}
        >
          <span className="text-[12px] text-foreground leading-snug flex-1">
            {activeReview.title}
          </span>
          <Pencil className="size-3 text-muted-foreground/40 can-hover:opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0 mt-0.5" />
        </div>
      )}

      {/* Updated at */}
      {activeReview.updatedAt && (
        <ChecksPanelUpdatedAtMetadata
          reviewShortLabel={reviewShortLabel}
          updatedAt={activeReview.updatedAt}
        />
      )}
      {/* Merge / Delete Workspace actions */}
      {activeReview && activeWorktree && repo && (
        <HostedReviewActions
          review={activeReview}
          githubPR={pr}
          repo={repo}
          worktree={activeWorktree}
          onRefreshReview={refreshHostedReviewAfterMutation}
        />
      )}
    </div>

    <ChecksPanelChecksSection
      review={activeReview}
      conflictReview={activeConflictReview}
      checks={checks}
      checksLoading={checksLoading}
      contextKey={stateRequestKey}
      conflictDetailsRefreshing={isRefreshing || conflictDetailsRefreshing}
      showTriage={shouldShowReviewTriageStrip}
      aiVisible={sourceControlAiActionsVisible}
      resolvingConflicts={isResolvingConflictsWithAI}
      fixingChecks={isFixingChecksWithAI}
      aiDisabledReason={aiActionDisabledReason}
      onResolveConflicts={() => void handleResolveConflictsWithAI()}
      onFixChecks={() => void handleFixChecksWithAI()}
      onLoadCheckDetails={handleLoadCheckDetails}
    />
    <ChecksPanelCommentsSection
      comments={comments}
      commentsLoading={commentsLoading}
      reviewKind={reviewShortLabel}
      commentsDisabled={!canTargetPRComments}
      commentsDisabledReason={commentsDisabledReason}
      selectionContextKey={stateRequestKey}
      selectionClearRequest={commentsSelectionClearRequest}
      resolveCommentsWithAIDisabled={Boolean(resolveCommentsWithAIDisabledReason)}
      resolveCommentsWithAIDisabledReason={resolveCommentsWithAIDisabledReason}
      onAddComment={pr ? handleAddPRComment : undefined}
      onResolveSelectedCommentsWithAI={
        sourceControlAiActionsVisible ? handleResolveCommentsWithAI : undefined
      }
      onReply={pr ? handleReplyToComment : undefined}
      onResolve={pr || activeGitLabReview ? handleResolve : undefined}
      onEditComment={pr ? handleEditComment : undefined}
      onDeleteComment={pr ? handleDeleteComment : undefined}
    />
    <ChecksPanelActionsSection
      open={sourceControlAiActionsVisible && agentComposerState !== null}
      onOpenChange={(open) => {
        if (!open) {
          setAgentComposerState(null)
        }
      }}
      actionId={agentComposerState?.actionId ?? 'fixChecks'}
      title={
        agentComposerState?.title ??
        translate('auto.components.right.sidebar.ChecksPanel.7fad8509fe', 'Fix With AI')
      }
      description={agentComposerState?.description ?? ''}
      baseCommandInput={agentComposerState?.prompt ?? ''}
      worktreeId={activeWorktreeId}
      groupId={activeWorktreeId}
      connectionId={activeConnectionId}
      repoId={repo?.id ?? null}
      promptDelivery="submit-after-ready"
      launchPlatform={activeSourceControlLaunchPlatform}
      launchSource={agentComposerState?.launchSource ?? 'task_page'}
      savedAgentId={
        agentComposerState
          ? readSourceControlLaunchRecipeAgentId(
              resolveSourceControlActionRecipe({
                settings,
                repo,
                actionId: agentComposerState.actionId
              })
            )
          : null
      }
      savedCommandInputTemplate={
        agentComposerState
          ? (resolveSourceControlActionRecipe({
              settings,
              repo,
              actionId: agentComposerState.actionId
            }).commandInputTemplate ?? null)
          : null
      }
      savedAgentArgs={
        agentComposerState
          ? (resolveSourceControlActionRecipe({
              settings,
              repo,
              actionId: agentComposerState.actionId
            }).agentArgs ?? null)
          : null
      }
      onSaveAgentDefault={saveLaunchActionDefault}
      onLaunched={() => {
        const launchedState = agentComposerState
        if (launchedState?.actionId === 'resolveComments' && launchedState.commentResolution) {
          void resolveSelectedThreadsAfterLaunch(launchedState.commentResolution).catch((err) => {
            console.warn('Failed to resolve selected review comments after AI launch:', err)
            toast.error(
              translate(
                'auto.components.right.sidebar.ChecksPanel.495b2f8c4b',
                'Started the agent, but could not mark the selected comments resolved.'
              )
            )
          })
        } else if (launchedState?.actionId === 'resolveConflicts') {
          toast.success(
            translate(
              'auto.components.right.sidebar.ChecksPanel.a0181a8d76',
              'Started an AI agent for the conflicts.'
            )
          )
        } else {
          toast.success(
            translate(
              'auto.components.right.sidebar.ChecksPanel.2ef90c9819',
              'Started an AI agent for the broken checks.'
            )
          )
        }
      }}
    />
  </div>
)
}
}
