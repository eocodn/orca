import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FolderKanban, LoaderCircle, MessageSquare, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { GitHubMarkdownComposer } from '@/components/github/GitHubMarkdownComposer'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { canUseGitHubRepoContext } from '@/lib/github-source-runtime-context'
import { usePRBotAuthorOverrides } from '@/lib/pr-bot-author-overrides'
import {
  getCommentReplyTargetCandidates,
  resolveCommentReplyTarget
} from '@/components/comment-reply-target-state'
import {
  filterPRCommentsByAudience,
  getPRCommentAudienceCounts,
  getPRCommentAudienceEmptyLabel,
  getPrCommentAudienceFilters,
  type PRCommentAudienceFilter
} from '@/lib/pr-comment-audience'
import { getPRCommentGroupId, groupPRComments, type PRCommentGroup } from '@/lib/pr-comment-groups'
import { resolveGitHubBodyDraft, shouldSyncGitHubBodyDraft } from '@/components/github-body-draft-state'
import { parseOwnerRepoFromItemUrl, formatGitHubWorkItemRelativeTime as formatRelativeTime } from '@/components/github-work-item-display'
import { addIssueCommentForRepo, addPRReviewCommentReplyForRepo } from './github-item-dialog-cache'
import { runWorkItemBodyUpdate } from './github-item-dialog-mutations'
import { ChecksTab } from './github-item-dialog-checks'
import { PRActionsPanel } from './github-item-dialog-actions'
import { PRAssigneesPanel, PRReviewersPanel } from './github-item-dialog-reviewers'
import { GHCommentComposer } from './github-item-dialog-edit'
import {
  resolvePullRequestRepo,
  type GitHubItemDialogProjectOrigin
} from './github-item-dialog-model'
import { CommentCard, CommentGroup } from './github-item-dialog-conversation-comments'
import { CommentCodeContext } from './github-item-dialog-conversation-code-context'
import {
  EMPTY_GITHUB_ISSUE_TIMELINE_ITEMS,
  getIssueConversationEntries,
  TimelineActivity,
  type IssueConversationEntry
} from './github-item-dialog-conversation-timeline'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  GitHubAssignableUser,
  GitHubIssueTimelineItem,
  GitHubPRFile,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  PRCheckDetail,
  PRComment
} from '../../../shared/types'

export { CommentCodeContext }

export function ConversationTab({
  item,
  repoPath,
  sourceContext,
  body,
  comments,
  timelineItems,
  files,
  headSha,
  baseSha,
  loading,
  detailsLoaded,
  checks,
  localState,
  onStateChange,
  projectOrigin,
  onMutated,
  onChecksUpdated,
  onBodyUpdated,
  onCommentAdded,
  onReviewersRequested
}: {
  item: GitHubWorkItem
  repoPath: string | null
  repoId: string | null
  sourceContext?: TaskSourceContext | null
  body: string
  comments: PRComment[]
  timelineItems?: GitHubIssueTimelineItem[]
  files: GitHubPRFile[]
  headSha: string | undefined
  baseSha: string | undefined
  loading: boolean
  detailsLoaded: boolean
  checks: GitHubWorkItemDetails['checks']
  localState: GitHubWorkItem['state']
  onStateChange: (state: GitHubWorkItem['state']) => void
  projectOrigin: GitHubItemDialogProjectOrigin | undefined
  onMutated: () => void
  onChecksUpdated: (checks: PRCheckDetail[]) => void
  onBodyUpdated: (body: string) => void
  onCommentAdded: (comment: PRComment) => void
  onReviewersRequested: (reviewRequests: GitHubAssignableUser[]) => void
}): React.JSX.Element {
  const authorLabel = item.author ?? 'unknown'
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [commentFilter, setCommentFilter] = useState<PRCommentAudienceFilter>('all')
  const [bodyDraft, setBodyDraft] = useState(body)
  const [bodyEditing, setBodyEditing] = useState(false)
  const [bodySaving, setBodySaving] = useState(false)
  const canUseRepoMutationContext = canUseGitHubRepoContext(repoPath, sourceContext)
  const botAuthorOverrides = usePRBotAuthorOverrides()
  const commentCounts = useMemo(
    () => getPRCommentAudienceCounts(comments, botAuthorOverrides),
    [botAuthorOverrides, comments]
  )
  const visibleComments = useMemo(
    () => filterPRCommentsByAudience(comments, commentFilter, botAuthorOverrides),
    [botAuthorOverrides, commentFilter, comments]
  )
  const visibleCommentGroups = useMemo(() => groupPRComments(visibleComments), [visibleComments])
  const resolvedTimelineItems = timelineItems ?? EMPTY_GITHUB_ISSUE_TIMELINE_ITEMS
  const issueConversationEntries = useMemo(
    () => getIssueConversationEntries(comments, resolvedTimelineItems),
    [comments, resolvedTimelineItems]
  )
  const replyTargetComments = getCommentReplyTargetCandidates(item.type, comments, visibleComments)
  const resolvedReplyingTo = resolveCommentReplyTarget(replyingTo, replyTargetComments)

  if (resolvedReplyingTo !== replyingTo) {
    // Why: filters/refetches can hide the active reply target; clear before paint so a stale composer doesn't flash for the wrong comment set.
    setReplyingTo(resolvedReplyingTo)
  }

  const resolvedBodyDraft = resolveGitHubBodyDraft(bodyDraft, body, bodyEditing)
  if (shouldSyncGitHubBodyDraft(bodyDraft, body, bodyEditing)) {
    // Why: a background refresh can change the body while the editor is closed; reconcile before paint so reopening never sees a stale draft.
    setBodyDraft(resolvedBodyDraft)
  }

  const bodySlug = useMemo(() => parseOwnerRepoFromItemUrl(item.url), [item.url])
  const prRepo = useMemo(() => resolvePullRequestRepo(item, projectOrigin), [item, projectOrigin])
  const markdownGitHubRepo = useMemo(
    () => (projectOrigin ? { owner: projectOrigin.owner, repo: projectOrigin.repo } : bodySlug),
    [bodySlug, projectOrigin]
  )
  const canEditBody =
    item.type === 'pr'
      ? Boolean(projectOrigin || bodySlug)
      : Boolean(projectOrigin || canUseRepoMutationContext)
  const bodyChanged = resolvedBodyDraft !== body

  const handleSaveBody = useCallback(async (): Promise<void> => {
    if (bodySaving || !bodyChanged) {
      setBodyEditing(false)
      return
    }
    setBodySaving(true)
    try {
      await runWorkItemBodyUpdate({
        item,
        repoPath,
        sourceContext,
        projectOrigin,
        body: resolvedBodyDraft,
        parsedSlug: bodySlug
      })
      onBodyUpdated(resolvedBodyDraft)
      setBodyEditing(false)
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(
        translate('auto.components.GitHubItemDialog.5221548274', 'Description updated.')
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translate(
              'auto.components.GitHubItemDialog.58c73cb0d8',
              'Failed to update description.'
            )
      )
    } finally {
      setBodySaving(false)
    }
  }, [
    bodyChanged,
    resolvedBodyDraft,
    bodySaving,
    bodySlug,
    item,
    onBodyUpdated,
    projectOrigin,
    repoPath,
    sourceContext
  ])

  const handleReply = useCallback(
    async (comment: PRComment, replyBody: string): Promise<boolean> => {
      if (!canUseRepoMutationContext) {
        toast.error(
          translate(
            'auto.components.GitHubItemDialog.745c9089ec',
            'Unable to reply without a repository path.'
          )
        )
        return false
      }
      const result =
        comment.path && item.type === 'pr'
          ? await addPRReviewCommentReplyForRepo({
              repoPath: repoPath ?? '',
              repoId: item.repoId,
              sourceContext,
              prNumber: item.number,
              prRepo,
              commentId: comment.id,
              body: replyBody,
              threadId: comment.threadId,
              path: comment.path,
              line: comment.line
            })
          : await addIssueCommentForRepo({
              repoPath: repoPath ?? '',
              repoId: item.repoId,
              sourceContext,
              number: item.number,
              body: `@${comment.author} ${replyBody}`,
              type: item.type,
              prRepo
            })

      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.GitHubItemDialog.283699bc82', 'Failed to post reply.')
        )
        return false
      }
      onCommentAdded(result.comment)
      setReplyingTo(null)
      toast.success(translate('auto.components.GitHubItemDialog.10f4ff5be8', 'Reply posted.'))
      return true
    },
    [
      canUseRepoMutationContext,
      item.number,
      item.repoId,
      item.type,
      onCommentAdded,
      prRepo,
      repoPath,
      sourceContext
    ]
  )

  const rightPanel =
    item.type === 'pr' ? (
      <div className="flex h-fit flex-col gap-5 xl:sticky xl:top-4">
        <PRActionsPanel
          item={item}
          repoPath={repoPath}
          repoId={item.repoId}
          sourceContext={sourceContext}
          projectOrigin={projectOrigin}
          localState={localState}
          onStateChange={onStateChange}
          onMutated={onMutated}
        />
        <PRAssigneesPanel
          item={item}
          repoPath={repoPath}
          projectOrigin={projectOrigin}
          sourceContext={sourceContext}
          onMutated={onMutated}
        />
        <PRReviewersPanel
          item={item}
          loading={loading}
          repoPath={repoPath}
          sourceContext={sourceContext}
          projectOrigin={projectOrigin}
          onReviewersRequested={onReviewersRequested}
        />
        <aside className="overflow-hidden rounded-lg border border-border/50 bg-card/50 shadow-xs">
          <ChecksTab
            item={item}
            repoPath={repoPath}
            repoId={item.repoId}
            sourceContext={sourceContext}
            headSha={headSha}
            checks={checks}
            loading={loading || !detailsLoaded}
            onChecksUpdated={onChecksUpdated}
          />
        </aside>
      </div>
    ) : null

  const commentCardProps = {
    item: { repoId: item.repoId, number: item.number, type: item.type },
    repoPath,
    sourceContext,
    prRepo,
    files,
    headSha,
    baseSha,
    markdownGitHubRepo,
    onToggleReply: (comment: PRComment) =>
      setReplyingTo((current) => (current === comment.id ? null : comment.id)),
    onCancelReply: () => setReplyingTo(null),
    onReply: handleReply
  }

  return (
    <div
      className={cn(
        'grid min-w-0 gap-5 px-4 py-4',
        // Why: keep PR controls beside the conversation, not buried below long review threads on narrow windows.
        item.type === 'pr' && 'grid-cols-[minmax(0,1fr)_300px]'
      )}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-lg border border-border/50 bg-card/50 shadow-xs">
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">{authorLabel}</span>
            <span>
              {translate('auto.components.GitHubItemDialog.8223320f8d', 'updated')}{' '}
              {formatRelativeTime(item.updatedAt)}
            </span>
            {canEditBody && !loading && detailsLoaded ? (
              bodyEditing ? (
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="gap-1.5"
                    disabled={bodySaving}
                    onClick={() => {
                      setBodyDraft(body)
                      setBodyEditing(false)
                    }}
                  >
                    <X className="size-3.5" />
                    {translate('auto.components.GitHubItemDialog.675bc0d638', 'Cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    className="gap-1.5"
                    disabled={bodySaving || !bodyChanged}
                    onClick={() => void handleSaveBody()}
                  >
                    {bodySaving ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {translate('auto.components.GitHubItemDialog.9df4e74bdf', 'Save')}
                  </Button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto size-7"
                      onClick={() => {
                        setBodyDraft(body)
                        setBodyEditing(true)
                      }}
                      aria-label={translate(
                        'auto.components.GitHubItemDialog.4d555d3796',
                        'Edit description'
                      )}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {translate('auto.components.GitHubItemDialog.4d555d3796', 'Edit description')}
                  </TooltipContent>
                </Tooltip>
              )
            ) : null}
          </div>
          <div className="px-4 py-4 text-[14px] leading-relaxed text-foreground">
            {loading && !detailsLoaded ? (
              <div className="flex items-center justify-center py-5">
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : bodyEditing ? (
              <GitHubMarkdownComposer
                value={resolvedBodyDraft}
                onChange={setBodyDraft}
                placeholder={translate(
                  'auto.components.GitHubItemDialog.52b20b56f7',
                  'Description'
                )}
                disabled={bodySaving}
                autoFocus
                minHeightClassName="min-h-64"
                onSubmitShortcut={() => void handleSaveBody()}
              />
            ) : body.trim() ? (
              <CommentMarkdown
                content={body}
                variant="document"
                githubRepo={markdownGitHubRepo}
                className="min-w-0 max-w-full overflow-hidden break-words text-[14px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
              />
            ) : (
              <span className="italic text-muted-foreground">
                {translate(
                  'auto.components.GitHubItemDialog.9b9cb55994',
                  'No description provided.'
                )}
              </span>
            )}
          </div>
        </div>

        {detailsLoaded ? (
          <>
            <div className="flex items-center gap-2 pt-1">
              {item.type === 'issue' ? (
                <FolderKanban className="size-4 text-muted-foreground" />
              ) : (
                <MessageSquare className="size-4 text-muted-foreground" />
              )}
              <span className="text-[13px] font-medium text-foreground">
                {item.type === 'issue'
                  ? translate('auto.components.GitHubItemDialog.timeline.activity', 'Activity')
                  : translate('auto.components.GitHubItemDialog.1506916c09', 'Comments')}
              </span>
              {comments.length + (item.type === 'issue' ? resolvedTimelineItems.length : 0) > 0 && (
                <span className="rounded-full border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {comments.length + (item.type === 'issue' ? resolvedTimelineItems.length : 0)}
                </span>
              )}
            </div>

            {item.type === 'pr' && comments.length > 0 && (
              <div className="grid grid-cols-3 rounded-lg border border-border/50 bg-background p-0.5">
                {getPrCommentAudienceFilters().map((filter) => {
                  const isActive = commentFilter === filter.value
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      className={cn(
                        'flex h-8 items-center justify-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors',
                        isActive && 'bg-muted text-foreground'
                      )}
                      aria-pressed={isActive}
                      onClick={() => setCommentFilter(filter.value)}
                    >
                      <span>{filter.label}</span>
                      <span className="tabular-nums">{commentCounts[filter.value]}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {item.type === 'issue' ? (
              issueConversationEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 px-3 py-6 text-left text-[13px] text-muted-foreground">
                  {translate(
                    'auto.components.GitHubItemDialog.timeline.noActivity',
                    'No activity yet.'
                  )}
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  {issueConversationEntries.map((entry: IssueConversationEntry) =>
                    entry.kind === 'comment' ? (
                      <CommentCard
                        key={entry.id}
                        comment={entry.comment}
                        {...commentCardProps}
                        onToggleReply={() => commentCardProps.onToggleReply(entry.comment)}
                      />
                    ) : (
                      <TimelineActivity key={entry.id} activity={entry.activity} />
                    )
                  )}
                </div>
              )
            ) : comments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 px-3 py-6 text-left text-[13px] text-muted-foreground">
                {translate('auto.components.GitHubItemDialog.5a94f3d0e9', 'No comments yet.')}
              </div>
            ) : visibleComments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 px-3 py-6 text-center text-[13px] text-muted-foreground">
                {getPRCommentAudienceEmptyLabel(commentFilter)}
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
                  {visibleCommentGroups.map((group: PRCommentGroup) => (
                    <CommentGroup
                      key={getPRCommentGroupId(group)}
                      group={group}
                      replyingTo={resolvedReplyingTo}
                      {...commentCardProps}
                    />
                  ))}
              </div>
            )}
          </>
        ) : null}

        {detailsLoaded && canUseRepoMutationContext && (
          <GHCommentComposer
            className="mt-1"
            repoPath={repoPath ?? ''}
            repoId={item.repoId}
            sourceContext={sourceContext}
            issueNumber={item.number}
            itemType={item.type}
            prRepo={prRepo}
            onCommentAdded={onCommentAdded}
          />
        )}
      </div>

      {rightPanel}
    </div>
  )
}
