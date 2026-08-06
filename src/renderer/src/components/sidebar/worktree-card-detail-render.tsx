import React from 'react'
import {
  WorktreeCardDetailsHover,
  WorktreeCardMetaBadges,
  hasWorktreeCardDetails
} from './WorktreeCardMeta'
import { WorktreeCardPortsDetails, WorktreeCardPortsTrigger } from './WorktreeCardPorts'
import type { WorktreeCardDetailsHoverControl } from './worktree-card-details-hover-state'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import type { WorkspacePort } from '../../../../shared/workspace-ports'

export type WorktreeCardDetailRenderProps = {
  worktreeHostId?: string
  worktreeDisplayName: string
  newCardStyle: boolean
  compactCards: boolean
  affiliateListMode: boolean
  showIssue: boolean
  showLinearIssue: boolean
  showJiraIssue: boolean
  showPR: boolean
  showAutomation: boolean
  showCli: boolean
  showComment: boolean
  showPorts: boolean
  cardProps: readonly string[]
  visibleCardTitle: string
  identityDisplay?: string
  branch: string
  isDeleting: boolean
  workspacePorts: WorkspacePort[]
  detailsHoverControl: WorktreeCardDetailsHoverControl
  issueDisplay: Parameters<typeof WorktreeCardDetailsHover>[0]['issue']
  linearIssueDisplay: Parameters<typeof WorktreeCardDetailsHover>[0]['linearIssue']
  jiraIssueDisplay: Parameters<typeof WorktreeCardDetailsHover>[0]['jiraIssue']
  prDisplay: WorktreeCardPrDisplay | null | undefined
  linearIssue?: { url?: string } | null
  comment?: string | null
  automationProvenance?: Parameters<typeof WorktreeCardDetailsHover>[0]['automationProvenance']
  cliProvenance?: Parameters<typeof WorktreeCardDetailsHover>[0]['cliProvenance']
  linkedReview: boolean
  handleEditIssue: (event: React.MouseEvent) => void
  handleEditComment: (event: React.MouseEvent) => void
  handleOpenGitHubIssueInOrca: (event: React.MouseEvent) => void
  handleOpenLinearIssueInOrca: (event: React.MouseEvent) => void
  handleOpenReviewInOrca: (event: React.MouseEvent) => void
  handleOpenAutomation: (event: React.MouseEvent) => void
  handleOpenAutomationRun: (event: React.MouseEvent) => void
  handleUnlinkReview: () => void
}

export function buildWorktreeCardDetailRenderModel(props: WorktreeCardDetailRenderProps) {
  const {
    newCardStyle,
    compactCards,
    affiliateListMode,
    showIssue,
    showLinearIssue,
    showJiraIssue,
    showPR,
    showAutomation,
    showCli,
    showComment,
    showPorts,
    cardProps,
    visibleCardTitle,
    identityDisplay,
    branch,
    worktreeDisplayName,
    worktreeHostId,
    workspacePorts,
    detailsHoverControl,
    issueDisplay,
    linearIssueDisplay,
    jiraIssueDisplay,
    prDisplay,
    linearIssue,
    comment,
    automationProvenance,
    cliProvenance,
    linkedReview,
    handleEditIssue,
    handleEditComment,
    handleOpenGitHubIssueInOrca,
    handleOpenLinearIssueInOrca,
    handleOpenReviewInOrca,
    handleOpenAutomation,
    handleOpenAutomationRun,
    handleUnlinkReview
  } = props
  const metaIssue = showIssue ? issueDisplay : null
  const metaLinearIssue = showLinearIssue ? linearIssueDisplay : null
  const metaJiraIssue = showJiraIssue ? jiraIssueDisplay : null
  const metaReview = showPR ? prDisplay : null
  const metaAutomation = showAutomation ? automationProvenance : null
  const metaCli = showCli ? cliProvenance : null
  const metaComment = showComment ? comment : null
  const hasDetails = hasWorktreeCardDetails({
    issue: metaIssue,
    linearIssue: metaLinearIssue,
    jiraIssue: metaJiraIssue,
    review: newCardStyle ? null : metaReview,
    comment: metaComment,
    automationProvenance: metaAutomation,
    cliProvenance: metaCli
  })
  const hasPorts = showPorts && workspacePorts.length > 0
  const title = visibleCardTitle.trim()
  const showBranchIdentityHover = newCardStyle
    ? Boolean(identityDisplay) && !cardProps.includes('branch') && identityDisplay !== title
    : compactCards && branch.length > 0
  const hoverBranchName = newCardStyle
    ? identityDisplay
    : showBranchIdentityHover
      ? branch
      : undefined
  const hoverWorkspaceTitle = title.length > 0 && title !== hoverBranchName ? title : undefined
  const hasHoverDetails =
    newCardStyle &&
    (hasWorktreeCardDetails({
      issue: issueDisplay,
      linearIssue: linearIssueDisplay,
      jiraIssue: jiraIssueDisplay,
      review: prDisplay,
      comment,
      automationProvenance: metaAutomation,
      cliProvenance: metaCli
    }) ||
      workspacePorts.length > 0 ||
      Boolean(hoverWorkspaceTitle || hoverBranchName))
  const titleWrapper = newCardStyle
    ? hasHoverDetails
      ? (value: React.ReactElement) => value
      : undefined
    : compactCards && (showBranchIdentityHover || hasDetails || hasPorts)
      ? (value: React.ReactElement) => (
          <WorktreeCardDetailsHover
            issue={metaIssue}
            linearIssue={metaLinearIssue}
            jiraIssue={metaJiraIssue}
            review={metaReview}
            comment={metaComment}
            automationProvenance={metaAutomation}
            cliProvenance={metaCli}
            automationHostId={worktreeHostId}
            branchName={showBranchIdentityHover ? branch : undefined}
            workspaceTitle={worktreeDisplayName}
            identityOrder="branch-first"
            detailsAfter={hasPorts ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null}
            openDelay={100}
            onEditIssue={affiliateListMode ? undefined : handleEditIssue}
            onEditComment={affiliateListMode ? undefined : handleEditComment}
            onOpenGitHubIssueInOrca={
              metaIssue && 'url' in metaIssue && metaIssue.url
                ? handleOpenGitHubIssueInOrca
                : undefined
            }
            onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
            onOpenReviewInOrca={
              metaReview?.url && metaReview.provider === 'github'
                ? handleOpenReviewInOrca
                : undefined
            }
            onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
            onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
            onUnlinkReview={!affiliateListMode && linkedReview ? handleUnlinkReview : undefined}
          >
            {value}
          </WorktreeCardDetailsHover>
        )
      : undefined
  const detailsContent =
    hasDetails || hasPorts ? (
      <div className="flex shrink-0 items-center gap-1">
        {hasPorts && <WorktreeCardPortsTrigger ports={workspacePorts} />}
        {hasDetails && (
          <WorktreeCardMetaBadges
            issue={metaIssue}
            linearIssue={metaLinearIssue}
            jiraIssue={metaJiraIssue}
            review={newCardStyle ? null : metaReview}
            comment={metaComment}
            automationProvenance={metaAutomation}
            cliProvenance={metaCli}
            className="ml-0 pr-0"
          />
        )}
      </div>
    ) : null
  const detailsAndPorts =
    detailsContent && !newCardStyle ? (
      <WorktreeCardDetailsHover
        issue={metaIssue}
        linearIssue={metaLinearIssue}
        jiraIssue={metaJiraIssue}
        review={metaReview}
        comment={metaComment}
        automationProvenance={metaAutomation}
        cliProvenance={metaCli}
        automationHostId={worktreeHostId}
        detailsAfter={hasPorts ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null}
        hoverControl={detailsHoverControl}
        onEditIssue={affiliateListMode ? undefined : handleEditIssue}
        onEditComment={affiliateListMode ? undefined : handleEditComment}
        onOpenGitHubIssueInOrca={
          metaIssue && 'url' in metaIssue && metaIssue.url ? handleOpenGitHubIssueInOrca : undefined
        }
        onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
        onOpenReviewInOrca={
          metaReview?.url && metaReview.provider === 'github' ? handleOpenReviewInOrca : undefined
        }
        onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
        onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
        onUnlinkReview={!affiliateListMode && linkedReview ? handleUnlinkReview : undefined}
      >
        {detailsContent}
      </WorktreeCardDetailsHover>
    ) : (
      detailsContent
    )
  return {
    metaIssue,
    metaLinearIssue,
    metaJiraIssue,
    metaReview,
    metaAutomationProvenance: metaAutomation,
    metaCliProvenance: metaCli,
    metaComment,
    hasDetails,
    hasPorts,
    hasHoverDetails,
    hoverBranchName,
    hoverWorkspaceTitle,
    titleWrapper,
    detailsAndPorts
  }
}
