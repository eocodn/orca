import React from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDashed,
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  FolderKanban,
  GitPullRequest,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatGitHubWorkItemRelativeTime as formatRelativeTime } from '@/components/github-work-item-display'
import {
  resolvePullRequestRepo,
  WorkItemStateBadge,
  type GitHubItemDialogProjectOrigin
} from './github-item-dialog-model'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  GitHubIssueTimelineItem,
  GitHubOwnerRepo,
  GitHubPRFile,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  PRCheckDetail,
  PRComment,
  GitHubAssignableUser
} from '../../../shared/types'
import { ConversationTab } from './github-item-dialog-conversation'
import { ChecksTab } from './github-item-dialog-checks'
import { GHEditSection } from './github-item-dialog-edit'
import { PRFilesCombinedDiffViewer } from './github-item-dialog-files'
import { WorkItemIssueSourceIndicator } from './github-item-dialog-source-indicator'
import {
  patchCachedPRChecks,
  patchCachedPRReviewRequests,
  patchCachedWorkItemBody
} from './github-item-dialog-cache'

type GitHubItemDialogContentProps = {
  workItem: GitHubWorkItem
  isIssuePage: boolean
  ownerRepo: GitHubOwnerRepo | null
  issueStateBadgeTone: string
  localState: GitHubWorkItem['state']
  localLabels: string[]
  linkCopied: boolean
  backLabel: string
  issueAttachedWorkspace: { id: string } | null
  issueAttachedWorkspaceLabel: string | null
  effectiveRepoId: string | null
  repoPath: string | null
  projectOrigin?: GitHubItemDialogProjectOrigin
  sourceContext?: TaskSourceContext | null
  canUseDetailsRepoContext: boolean
  details: GitHubWorkItemDetails | null
  displayWorkItem: GitHubWorkItem | null
  body: string
  comments: PRComment[]
  timelineItems: GitHubIssueTimelineItem[]
  files: GitHubPRFile[]
  checks: PRCheckDetail[]
  headSha: string | undefined
  baseSha: string | undefined
  loading: boolean
  detailsLoaded: boolean
  filesUnavailable: boolean
  pendingViewedPaths: Set<string>
  detailsCacheKey: string | null
  setLinkCopyButtonRef: React.RefCallback<HTMLButtonElement>
  handleCopyWorkItemLink: () => Promise<void>
  handleOpenOrUseIssueWorkspace: (item: GitHubWorkItem) => void
  onUse: (item: GitHubWorkItem) => void
  onClose: () => void
  setLocalState: (state: GitHubWorkItem['state']) => void
  setLocalLabels: (labels: string[]) => void
  invalidateCurrentDetailsCache: () => void
  appendOptimisticComment: (comment: PRComment) => void
  handlePRFileViewedChange: (path: string, viewed: boolean) => Promise<boolean>
  onReviewRequestsChange?: (
    itemKey: { id: string; repoId: string },
    reviewRequests: GitHubAssignableUser[]
  ) => void
}

export function GitHubItemDialogContent({
  workItem,
  isIssuePage,
  ownerRepo,
  issueStateBadgeTone,
  localState,
  localLabels,
  linkCopied,
  backLabel,
  issueAttachedWorkspace,
  issueAttachedWorkspaceLabel,
  effectiveRepoId,
  repoPath,
  projectOrigin,
  sourceContext,
  canUseDetailsRepoContext,
  details,
  displayWorkItem,
  body,
  comments,
  timelineItems,
  files,
  checks,
  headSha,
  baseSha,
  loading,
  detailsLoaded,
  filesUnavailable,
  pendingViewedPaths,
  detailsCacheKey,
  setLinkCopyButtonRef,
  handleCopyWorkItemLink,
  handleOpenOrUseIssueWorkspace,
  onUse,
  onClose,
  setLocalState,
  setLocalLabels,
  invalidateCurrentDetailsCache,
  appendOptimisticComment,
  handlePRFileViewedChange,
  onReviewRequestsChange
}: GitHubItemDialogContentProps): React.JSX.Element | null {
  const Icon = workItem?.type === 'pr' ? GitPullRequest : CircleDot

  return workItem ? (
    <div className="flex h-full min-h-0 flex-col">
      {isIssuePage ? (
        <>
          {/* Row 1: breadcrumb-style strip mirroring GitHub's canvas-subtle header */}
          <div className="flex-none border-b border-border/60 bg-muted/30 px-6 py-2.5">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="-ml-2 h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                aria-label={backLabel}
              >
                <ChevronLeft className="size-4" />
                {backLabel}
              </Button>
              <span className="text-border">·</span>
              {ownerRepo ? (
                <>
                  <span className="truncate">
                    <span className="text-muted-foreground">{ownerRepo.owner}</span>
                    <span className="mx-1 text-muted-foreground/60">/</span>
                    <span className="font-medium text-foreground">{ownerRepo.repo}</span>
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                </>
              ) : null}
              <span className="font-mono text-muted-foreground">#{workItem.number}</span>
              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={setLinkCopyButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleCopyWorkItemLink()}
                      aria-label={translate(
                        'auto.components.GitHubItemDialog.c43fe79ee0',
                        'Copy GitHub link'
                      )}
                    >
                      {linkCopied ? (
                        <Check className="size-4 text-emerald-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {linkCopied
                      ? translate('auto.components.GitHubItemDialog.038b3d39b1', 'Copied')
                      : translate(
                          'auto.components.GitHubItemDialog.c43fe79ee0',
                          'Copy GitHub link'
                        )}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => window.api.shell.openUrl(workItem.url)}
                      aria-label={translate(
                        'auto.components.GitHubItemDialog.3fdf777817',
                        'Open on GitHub'
                      )}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Row 2: large title block */}
          <div className="flex-none border-b border-border/60 bg-card px-6 py-4">
            <div className="flex items-start gap-4">
              <h1 className="min-w-0 flex-1 text-[28px] font-medium leading-tight text-foreground">
                <span className="break-words">{workItem.title}</span>
                <span className="ml-2 font-light text-muted-foreground">#{workItem.number}</span>
              </h1>
              <div className="flex shrink-0 items-center gap-2">
                {/* Why: Orca's signature affordance — keep primary so it stands out against GitHub's familiar surface. */}
                {issueAttachedWorkspace ? (
                  <DropdownMenu modal={false}>
                    <ButtonGroup>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpenOrUseIssueWorkspace(workItem)}
                        className="gap-1.5 whitespace-nowrap"
                        aria-label={translate(
                          'auto.components.GitHubItemDialog.84855fedd0',
                          'Open workspace attached to issue'
                        )}
                      >
                        {translate('auto.components.GitHubItemDialog.726db41722', 'Open workspace')}
                        <ArrowRight className="size-3.5" />
                      </Button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          aria-label={translate(
                            'auto.components.GitHubItemDialog.fe6ff12dc2',
                            'More issue workspace actions'
                          )}
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </ButtonGroup>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onUse(workItem)}>
                        <Plus className="size-4" />
                        {translate(
                          'auto.components.GitHubItemDialog.36182aa57f',
                          'Start new workspace'
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => window.api.shell.openUrl(workItem.url)}>
                        <ExternalLink className="size-4" />
                        {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onUse(workItem)}
                    className="gap-1.5 whitespace-nowrap"
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.0ab4664a8b',
                      'Start workspace from issue'
                    )}
                  >
                    {translate(
                      'auto.components.GitHubItemDialog.0ab4664a8b',
                      'Start workspace from issue'
                    )}
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium',
                  issueStateBadgeTone
                )}
              >
                {localState === 'closed' ? (
                  <CircleDashed className="size-3.5" />
                ) : (
                  <CircleDot className="size-3.5" />
                )}
                {localState === 'closed'
                  ? translate('auto.components.GitHubItemDialog.ab050dffec', 'Closed')
                  : translate('auto.components.GitHubItemDialog.dc1ca081a8', 'Open')}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-foreground">
                  {workItem.author ??
                    translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                </span>
                <span>
                  {translate('auto.components.GitHubItemDialog.55962099bc', 'opened this issue')}
                </span>
                <span className="text-muted-foreground/80">
                  {translate('auto.components.GitHubItemDialog.10ef1afb8e', '· updated')}
                  {formatRelativeTime(workItem.updatedAt)}
                </span>
              </span>
              <WorkItemIssueSourceIndicator
                url={workItem.url}
                repoId={effectiveRepoId}
                repoPath={repoPath}
              />
              {issueAttachedWorkspaceLabel ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <FolderKanban className="size-3.5 shrink-0" />
                  <span className="truncate">{issueAttachedWorkspaceLabel}</span>
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-none border-b border-border/60 bg-card/80 px-4 py-3 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="-ml-1 mt-0.5 shrink-0 gap-1.5"
              aria-label={backLabel}
            >
              <ChevronLeft className="size-4" />
              {backLabel}
            </Button>
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <WorkItemStateBadge item={{ ...workItem, state: localState }} />
                <span className="font-mono">#{workItem.number}</span>
                <span>
                  {workItem.type === 'pr'
                    ? translate('auto.components.GitHubItemDialog.a2495e4784', 'Pull request')
                    : translate('auto.components.GitHubItemDialog.3e544d966d', 'Issue')}
                </span>
              </div>
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                {workItem.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {workItem.author ??
                    translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                </span>
                <span>
                  {translate('auto.components.GitHubItemDialog.8223320f8d', 'updated')}
                  {formatRelativeTime(workItem.updatedAt)}
                </span>
                {workItem.branchName && (
                  <span className="max-w-full truncate rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {workItem.branchName}
                  </span>
                )}
                {issueAttachedWorkspaceLabel ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <FolderKanban className="size-3 shrink-0" />
                    <span className="truncate">{issueAttachedWorkspaceLabel}</span>
                  </span>
                ) : null}
              </div>
              {workItem.type === 'issue' && (
                <WorkItemIssueSourceIndicator
                  url={workItem.url}
                  repoId={effectiveRepoId}
                  repoPath={repoPath}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1">
              {workItem.type === 'pr' && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onUse(workItem)}
                  className="gap-1.5 whitespace-nowrap"
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.0caac1a18f',
                    'Start workspace from PR'
                  )}
                >
                  {translate(
                    'auto.components.GitHubItemDialog.0caac1a18f',
                    'Start workspace from PR'
                  )}
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={setLinkCopyButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void handleCopyWorkItemLink()}
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.c43fe79ee0',
                      'Copy GitHub link'
                    )}
                  >
                    {linkCopied ? (
                      <Check className="size-4 text-emerald-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {linkCopied
                    ? translate('auto.components.GitHubItemDialog.038b3d39b1', 'Copied')
                    : translate('auto.components.GitHubItemDialog.c43fe79ee0', 'Copy GitHub link')}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => window.api.shell.openUrl(workItem.url)}
                    aria-label={translate(
                      'auto.components.GitHubItemDialog.3fdf777817',
                      'Open on GitHub'
                    )}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate('auto.components.GitHubItemDialog.3fdf777817', 'Open on GitHub')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      )}

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
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as ItemDialogTab)}
            className="flex h-full min-h-0 flex-col gap-0"
          >
            <TabsList
              variant="line"
              className="mx-4 mt-2 justify-start gap-3 border-b border-border/60 bg-transparent"
            >
              <TabsTrigger value="conversation" className="px-2">
                <MessageSquare className="size-3.5" />
                {translate('auto.components.GitHubItemDialog.e30a5470c9', 'Conversation')}
              </TabsTrigger>
              {workItem.type === 'pr' && (
                <>
                  <TabsTrigger value="checks" className="px-2">
                    <ListChecks className="size-3.5" />
                    {translate('auto.components.GitHubItemDialog.4bd1f5b055', 'Checks')}
                    {checks.length > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {checks.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="files" className="px-2">
                    <FileText className="size-3.5" />
                    {translate('auto.components.GitHubItemDialog.999b5ad7d9', 'Files')}
                    {files.length > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">{files.length}</span>
                    )}
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              <TabsContent value="conversation" className="mt-0">
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
              </TabsContent>

              {workItem.type === 'pr' && (
                <>
                  <TabsContent value="checks" className="mt-0">
                    <ChecksTab
                      item={displayWorkItem ?? workItem}
                      repoPath={repoPath}
                      repoId={effectiveRepoId}
                      sourceContext={sourceContext}
                      headSha={details?.headSha}
                      checks={checks}
                      loading={loading || !detailsLoaded}
                      variant="page"
                      onChecksUpdated={(nextChecks) => {
                        if (detailsCacheKey) {
                          patchCachedPRChecks(detailsCacheKey, nextChecks)
                        }
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="files" className="mt-0 h-full min-h-0 overflow-hidden">
                    {loading && files.length === 0 ? (
                      <div className="flex items-center justify-center py-10">
                        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filesUnavailable && files.length === 0 ? (
                      // Why: file fetch failed (rate limit, auth, unresolved remote); offer a retry instead of implying the PR is empty.
                      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                        <div className="text-[12px] text-muted-foreground">
                          {translate(
                            'auto.components.GitHubItemDialog.filesUnavailable',
                            "Couldn't load changed files."
                          )}
                        </div>
                        <Button variant="outline" size="sm" onClick={invalidateCurrentDetailsCache}>
                          <RefreshCw className="size-3.5" />
                          {translate('auto.components.GitHubItemDialog.filesRetry', 'Retry')}
                        </Button>
                      </div>
                    ) : files.length === 0 ? (
                      <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                        {translate(
                          'auto.components.GitHubItemDialog.3cd5ae5b7b',
                          'No files changed.'
                        )}
                      </div>
                    ) : (
                      <PRFilesCombinedDiffViewer
                        files={files}
                        comments={comments}
                        repoPath={repoPath ?? ''}
                        repoId={effectiveRepoId ?? ''}
                        sourceContext={sourceContext}
                        prNumber={workItem.number}
                        prRepo={resolvePullRequestRepo(workItem, projectOrigin)}
                        prUrl={workItem.url}
                        headSha={details?.headSha}
                        baseSha={details?.baseSha}
                        pendingViewedPaths={pendingViewedPaths}
                        onCommentAdded={appendOptimisticComment}
                        onViewedChange={handlePRFileViewedChange}
                      />
                    )}
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        )}
      </div>
    </div>
  ) : null
