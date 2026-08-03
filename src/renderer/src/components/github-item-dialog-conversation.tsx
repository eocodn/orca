import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Braces,
  Check,
  CheckCircle2,
  ExternalLink,
  FolderKanban,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  UndoDot,
  X
} from 'lucide-react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { GitHubMarkdownComposer } from '@/components/github/GitHubMarkdownComposer'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useRepoAssignees } from '@/hooks/useIssueMetadata'
import { useAllWorktrees } from '@/store/selectors'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskSourceRuntimeSettings, type TaskSourceContext } from '../../../shared/task-source-context'
import { getGitHubRuntimeRepoId, getGitHubSourceRuntimeHost } from '@/lib/github-source-runtime-context'
import { getPrCommentCodeContext } from '@/components/github/pr-comment-code-context'
import { getCommentReplyTargetCandidates, resolveCommentReplyTarget } from '@/components/comment-reply-target-state'
import {
  createCommentCodeContextExpansionState,
  resolveCommentCodeContextExpansionState,
  updateCommentCodeContextExpansionState,
  type CommentCodeContextLineUpdate
} from '@/components/comment-code-context-state'
import {
  filterPRCommentsByAudience,
  getPRCommentAudienceCounts,
  getPRCommentAudienceEmptyLabel,
  getPrCommentAudienceFilters,
  type PRCommentAudienceFilter
} from '@/lib/pr-comment-audience'
import {
  getPRCommentGroupCount,
  getPRCommentGroupId,
  getPRCommentGroupRoot,
  groupPRComments,
  isResolvedPRCommentGroup,
  PR_COMMENT_OPEN_AUTHOR_CLASS,
  PR_COMMENT_RESOLVED_AUTHOR_CLASS,
  PR_COMMENT_RESOLVED_CONTAINER_CLASS,
  type PRCommentGroup
} from '@/lib/pr-comment-groups'
import {
  resolveGitHubBodyDraft,
  shouldSyncGitHubBodyDraft
} from '@/components/github-body-draft-state'
import { addPRReviewCommentForRepo, addPRReviewCommentReplyForRepo } from './github-item-dialog-cache'
import { ChecksTab } from './github-item-dialog-checks'
import { CommentReactions, CommentReplyForm } from './github-item-dialog-comments'
import { PRActionsPanel } from './github-item-dialog-actions'
import { PRAssigneesPanel, PRReviewersPanel } from './github-item-dialog-reviewers'
import { GHEditSection, GHCommentComposer } from './github-item-dialog-edit'
import {
  resolvePullRequestRepo,
  type GitHubItemDialogProjectOrigin
} from './github-item-dialog-model'
import type {
  GitHubIssueTimelineItem,
  GitHubIssueTimelineTarget,
  GitHubOwnerRepo,
  GitHubPRFile,
  GitHubPRFileContents,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  PRComment,
  PRCheckDetail
} from '../../../shared/types'

const MonacoCodeExcerpt = lazy(() => import('@/components/editor/MonacoCodeExcerpt'))
const CODE_CONTEXT_EXPAND_STEP = 5
const CODE_CONTEXT_FALLBACK_LINES = 20
const CODE_CONTEXT_MAX_BLOCK_LINES = CODE_CONTEXT_FALLBACK_LINES * 2 + 1

export function CommentCodeContext({
  comment,
  repoPath,
  repoId,
  sourceContext,
  prNumber,
  prRepo,
  files,
  headSha,
  baseSha
}: {
  comment: PRComment
  repoPath: string | null
  repoId: string
  sourceContext?: TaskSourceContext | null
  prNumber: number
  prRepo?: GitHubOwnerRepo | null
  files: GitHubPRFile[]
  headSha: string | undefined
  baseSha: string | undefined
}): React.JSX.Element | null {
  const [contents, setContents] = useState<GitHubPRFileContents | null>(null)
  const [error, setError] = useState(false)
  const [contextExpansionState, setContextExpansionState] = useState(() =>
    createCommentCodeContextExpansionState(comment.id)
  )
  const file = useMemo(
    () => files.find((candidate) => candidate.path === comment.path),
    [comment.path, files]
  )
  const line = comment.line
  const startLine = comment.startLine ?? line

  useEffect(() => {
    setContents(null)
    setError(false)
    if (!repoPath || !file || !headSha || !baseSha || !line || file.isBinary) {
      return
    }
    let cancelled = false
    loadPRFileContents({
      repoPath,
      repoId,
      sourceContext,
      prNumber,
      prRepo,
      file,
      headSha,
      baseSha
    })
      .then((result) => {
        if (!cancelled) {
          setContents(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [baseSha, file, headSha, line, prNumber, prRepo, repoId, repoPath, sourceContext])

  const resolvedContextExpansionState = resolveCommentCodeContextExpansionState(
    contextExpansionState,
    comment.id
  )
  if (resolvedContextExpansionState !== contextExpansionState) {
    // Why: comment rows can be reused on PR refresh; reset before paint so the previous comment's expanded context isn't shown on the next.
    setContextExpansionState(resolvedContextExpansionState)
  }
  const contextBefore = resolvedContextExpansionState.contextBefore
  const contextAfter = resolvedContextExpansionState.contextAfter
  const setContextBefore = useCallback(
    (contextBeforeUpdate: CommentCodeContextLineUpdate) => {
      setContextExpansionState((current) =>
        updateCommentCodeContextExpansionState(current, comment.id, {
          contextBefore: contextBeforeUpdate
        })
      )
    },
    [comment.id]
  )
  const setContextAfter = useCallback(
    (contextAfterUpdate: CommentCodeContextLineUpdate) => {
      setContextExpansionState((current) =>
        updateCommentCodeContextExpansionState(current, comment.id, {
          contextAfter: contextAfterUpdate
        })
      )
    },
    [comment.id]
  )

  if (!comment.path || !line || !file || file.isBinary || error) {
    return null
  }

  if (!contents) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        {translate('auto.components.GitHubItemDialog.db61d76cd5', 'Loading code context…')}
      </div>
    )
  }

  if (getPRFileContentsRenderLimit(contents).limited) {
    return null
  }

  const source = contents.modified || contents.original
  const codeContext = getPrCommentCodeContext({
    source,
    line,
    startLine,
    contextBefore,
    contextAfter,
    fallbackLines: CODE_CONTEXT_FALLBACK_LINES,
    maxBlockLines: CODE_CONTEXT_MAX_BLOCK_LINES
  })
  if (!codeContext) {
    return null
  }
  const {
    selectedLines,
    totalLines,
    commentFrom,
    commentTo,
    from,
    to,
    blockRange,
    shouldUseBlockRange,
    canExpandAbove,
    canExpandBelow,
    canExpandBlock
  } = codeContext
  const language = detectLanguage(comment.path)
  const blockTooltip = shouldUseBlockRange
    ? 'Show surrounding code block'
    : 'Show nearby code context'

  return (
    <div className="mb-3 overflow-hidden rounded-md border border-border/50 bg-muted/20">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono">{comment.path}</span>
          <span className="shrink-0 font-mono">
            L{from}
            {to !== from
              ? translate('auto.components.GitHubItemDialog.d1c0dad471', '-L{{value0}}', {
                  value0: to
                })
              : ''}
          </span>
          {(from !== commentFrom || to !== commentTo) && (
            <span className="shrink-0 font-mono text-muted-foreground/70">
              {translate('auto.components.GitHubItemDialog.bd7be7b1fd', 'comment L')}
              {commentFrom}
              {commentTo !== commentFrom
                ? translate('auto.components.GitHubItemDialog.d1c0dad471', '-L{{value0}}', {
                    value0: commentTo
                  })
                : ''}
            </span>
          )}
        </div>
        <ButtonGroup
          className="text-muted-foreground"
          aria-label={translate(
            'auto.components.GitHubItemDialog.d43736d09c',
            'Code context controls'
          )}
        >
          {(contextBefore > 0 || contextAfter > 0) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="size-7 border-border/55 bg-background/35 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setContextBefore(0)
                    setContextAfter(0)
                  }}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.b1574e8ac2',
                    'Reset code context'
                  )}
                >
                  <UndoDot className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('auto.components.GitHubItemDialog.b1574e8ac2', 'Reset code context')}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-7 border-border/55 bg-background/35 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                disabled={!canExpandAbove}
                onClick={() =>
                  setContextBefore((current) =>
                    Math.min(current + CODE_CONTEXT_EXPAND_STEP, commentFrom - 1)
                  )
                }
                aria-label={translate(
                  'auto.components.GitHubItemDialog.307c98e8e3',
                  'Show {{value0}} more lines above',
                  { value0: CODE_CONTEXT_EXPAND_STEP }
                )}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.GitHubItemDialog.5664681624', 'Show more lines above')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-7 border-border/55 bg-background/35 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                disabled={!canExpandBelow}
                onClick={() =>
                  setContextAfter((current) =>
                    Math.min(current + CODE_CONTEXT_EXPAND_STEP, totalLines - commentTo)
                  )
                }
                aria-label={translate(
                  'auto.components.GitHubItemDialog.307c98e8e3',
                  'Show {{value0}} more lines below',
                  { value0: CODE_CONTEXT_EXPAND_STEP }
                )}
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.GitHubItemDialog.06c06e58ba', 'Show more lines below')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="size-7 border-border/55 bg-background/35 text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                disabled={!canExpandBlock}
                onClick={() => {
                  setContextBefore((current) =>
                    Math.max(current, Math.max(0, commentFrom - blockRange.startLine))
                  )
                  setContextAfter((current) =>
                    Math.max(current, Math.max(0, blockRange.endLine - commentTo))
                  )
                }}
                aria-label={blockTooltip}
              >
                <Braces className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{blockTooltip}</TooltipContent>
          </Tooltip>
        </ButtonGroup>
      </div>
      <Suspense
        fallback={
          <pre className="overflow-x-auto py-1 text-[12px] leading-5">
            {selectedLines.map((codeLine, index) => {
              const lineNumber = from + index
              const isCommentedLine = lineNumber >= commentFrom && lineNumber <= commentTo
              return (
                <div
                  key={lineNumber}
                  className={cn('flex font-mono', isCommentedLine && 'bg-emerald-500/10')}
                >
                  <span className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted-foreground">
                    {lineNumber}
                  </span>
                  <code className="min-w-0 flex-1 px-3 text-foreground">{codeLine || ' '}</code>
                </div>
              )
            })}
          </pre>
        }
      >
        <MonacoCodeExcerpt
          lines={selectedLines}
          firstLineNumber={from}
          highlightedStartLine={commentFrom}
          highlightedEndLine={commentTo}
          language={language}
        />
      </Suspense>
    </div>
  )
}

type IssueConversationEntry =
  | { kind: 'comment'; id: string; createdAt: string; comment: PRComment; index: number }
  | {
      kind: 'activity'
      id: string
      createdAt: string
      activity: GitHubIssueTimelineItem
      index: number
    }

const EMPTY_GITHUB_ISSUE_TIMELINE_ITEMS: GitHubIssueTimelineItem[] = []

function getTimelineSortValue(createdAt: string): number {
  const value = new Date(createdAt).getTime()
  return Number.isFinite(value) ? value : 0
}

function getIssueConversationEntries(
  comments: PRComment[],
  timelineItems: GitHubIssueTimelineItem[]
): IssueConversationEntry[] {
  return [
    ...comments.map(
      (comment, index): IssueConversationEntry => ({
        kind: 'comment',
        id: `comment:${comment.id}`,
        createdAt: comment.createdAt,
        comment,
        index
      })
    ),
    ...timelineItems.map(
      (activity, index): IssueConversationEntry => ({
        kind: 'activity',
        id: `activity:${activity.id}`,
        createdAt: activity.createdAt,
        activity,
        index: comments.length + index
      })
    )
  ].sort((a, b) => {
    const diff = getTimelineSortValue(a.createdAt) - getTimelineSortValue(b.createdAt)
    return diff === 0 ? a.index - b.index : diff
  })
}

function getTimelineTargetLabel(target: GitHubIssueTimelineTarget): string {
  const prefix = target.type === 'pr' ? 'PR' : 'issue'
  const title = target.title ? ` ${target.title}` : ''
  return `${prefix} #${target.number}${title}`
}

function getTimelineStateReasonLabel(reason: string | null | undefined): string | null {
  if (reason === 'completed') {
    return translate('auto.components.GitHubItemDialog.timeline.completed', 'as completed')
  }
  if (reason === 'not_planned') {
    return translate('auto.components.GitHubItemDialog.timeline.notPlanned', 'as not planned')
  }
  return null
}

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

  const renderCommentCard = (comment: PRComment, isReply = false): React.JSX.Element => (
    <div
      key={comment.id}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border border-border/40 bg-card/50 shadow-xs',
        isReply && 'ml-6 max-w-[calc(100%-1.5rem)]',
        comment.isResolved && PR_COMMENT_RESOLVED_CONTAINER_CLASS
      )}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        {comment.authorAvatarUrl ? (
          <img
            src={comment.authorAvatarUrl}
            alt={comment.author}
            className="size-5 shrink-0 rounded-full"
          />
        ) : (
          <div className="size-5 shrink-0 rounded-full bg-muted" />
        )}
        <span
          className={cn(
            'min-w-0 truncate text-[13px] font-semibold',
            comment.isResolved ? PR_COMMENT_RESOLVED_AUTHOR_CLASS : PR_COMMENT_OPEN_AUTHOR_CLASS
          )}
        >
          {comment.author}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          · {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.path && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
            {comment.path.split('/').pop()}
            {comment.line
              ? translate('auto.components.GitHubItemDialog.136542c9ba', ':L{{value0}}', {
                  value0: comment.line
                })
              : ''}
          </span>
        )}
        {comment.isResolved && (
          <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.68cb993d61', 'resolved')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-7"
                onClick={() =>
                  setReplyingTo((current) => (current === comment.id ? null : comment.id))
                }
                aria-label={translate(
                  'auto.components.GitHubItemDialog.bca8eb39ac',
                  'Reply to comment'
                )}
              >
                <MessageSquarePlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.GitHubItemDialog.bca8eb39ac', 'Reply to comment')}
            </TooltipContent>
          </Tooltip>
          {comment.url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7"
                  onClick={() => window.api.shell.openUrl(comment.url)}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.a154ec5224',
                    'Open comment on GitHub'
                  )}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('auto.components.GitHubItemDialog.a154ec5224', 'Open comment on GitHub')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="min-w-0 px-3 py-2">
        <CommentCodeContext
          comment={comment}
          repoPath={repoPath}
          repoId={item.repoId}
          sourceContext={sourceContext}
          prNumber={item.number}
          prRepo={prRepo}
          files={files}
          headSha={headSha}
          baseSha={baseSha}
        />
        <CommentMarkdown
          content={comment.body}
          variant="document"
          githubRepo={markdownGitHubRepo}
          className="min-w-0 max-w-full overflow-hidden break-words text-[13px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
        />
        <CommentReactions reactions={comment.reactions} />
        {resolvedReplyingTo === comment.id && (
          <CommentReplyForm
            className="mt-3"
            placeholder={
              comment.path
                ? translate(
                    'auto.components.GitHubItemDialog.86f809e2ce',
                    'Reply in this review thread'
                  )
                : translate('auto.components.GitHubItemDialog.080d071d48', 'Reply to @{{value0}}', {
                    value0: comment.author
                  })
            }
            onCancel={() => setReplyingTo(null)}
            onSubmit={(replyBody) => handleReply(comment, replyBody)}
          />
        )}
      </div>
    </div>
  )

  const renderCommentGroup = (group: PRCommentGroup): React.JSX.Element => {
    const cards =
      group.kind === 'thread'
        ? [
            renderCommentCard(group.root),
            ...group.replies.map((reply) => renderCommentCard(reply, true))
          ]
        : [renderCommentCard(group.comment)]

    if (!isResolvedPRCommentGroup(group)) {
      return (
        <div key={getPRCommentGroupId(group)} className="flex min-w-0 flex-col gap-3">
          {cards}
        </div>
      )
    }

    const root = getPRCommentGroupRoot(group)
    const count = getPRCommentGroupCount(group)
    return (
      <Accordion key={getPRCommentGroupId(group)} type="single" collapsible>
        <AccordionItem
          value={getPRCommentGroupId(group)}
          className="rounded-lg border border-border/40 bg-card/40"
        >
          <AccordionTrigger className="px-3 py-2 text-[13px] text-muted-foreground hover:bg-accent/30">
            <span className="min-w-0 truncate">
              {translate('auto.components.GitHubItemDialog.228e2f59d3', 'Resolved')}{' '}
              {group.kind === 'thread'
                ? translate('auto.components.GitHubItemDialog.28d0d3374f', 'thread')
                : translate('auto.components.GitHubItemDialog.e2bf3e41a9', 'comment')}{' '}
              {translate('auto.components.GitHubItemDialog.0ae387d8ca', 'by')} {root.author}
              {count > 1 ? ` (${count})` : ''}
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex min-w-0 flex-col gap-3 px-3 pb-3 pt-0">
            {cards}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  const renderTimelineTarget = (target: GitHubIssueTimelineTarget | undefined): React.ReactNode => {
    if (!target) {
      return null
    }
    return (
      <button
        key={target.url}
        type="button"
        className="min-w-0 truncate font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
        title={getTimelineTargetLabel(target)}
        onClick={() => window.api.shell.openUrl(target.url)}
      >
        {getTimelineTargetLabel(target)}
      </button>
    )
  }

  const renderTimelineActivityMessage = (activity: GitHubIssueTimelineItem): React.ReactNode => {
    const assignee =
      activity.assignee ?? translate('auto.components.GitHubItemDialog.timeline.someone', 'someone')
    if (activity.event === 'assigned') {
      return (
        <>
          {translate('auto.components.GitHubItemDialog.timeline.assigned', 'assigned')}{' '}
          <span className="font-medium text-foreground">{assignee}</span>
        </>
      )
    }
    if (activity.event === 'unassigned') {
      return (
        <>
          {translate('auto.components.GitHubItemDialog.timeline.unassigned', 'unassigned')}{' '}
          <span className="font-medium text-foreground">{assignee}</span>
        </>
      )
    }
    if (activity.event === 'mentioned' || activity.event === 'cross-referenced') {
      return (
        <>
          {translate('auto.components.GitHubItemDialog.timeline.mentioned', 'mentioned this')}
          {activity.source ? (
            <>
              {' '}
              {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
              {renderTimelineTarget(activity.source)}
            </>
          ) : null}
        </>
      )
    }
    if (activity.event === 'closed') {
      const stateReason = getTimelineStateReasonLabel(activity.stateReason)
      return (
        <>
          {translate('auto.components.GitHubItemDialog.timeline.closed', 'closed this')}
          {stateReason ? ` ${stateReason}` : ''}
          {activity.closer ? (
            <>
              {' '}
              {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
              {renderTimelineTarget(activity.closer)}
            </>
          ) : null}
        </>
      )
    }
    if (activity.event === 'reopened') {
      return translate('auto.components.GitHubItemDialog.timeline.reopened', 'reopened this')
    }
    const hasFrom = Boolean(activity.previousColumnName)
    const hasTo = Boolean(activity.columnName)
    return (
      <>
        {translate('auto.components.GitHubItemDialog.timeline.moved', 'moved this')}
        {hasFrom ? (
          <>
            {' '}
            {translate('auto.components.GitHubItemDialog.timeline.from', 'from')}{' '}
            <span className="font-medium text-foreground">{activity.previousColumnName}</span>
          </>
        ) : null}
        {hasTo ? (
          <>
            {' '}
            {translate('auto.components.GitHubItemDialog.timeline.to', 'to')}{' '}
            <span className="font-medium text-foreground">{activity.columnName}</span>
          </>
        ) : null}
        {activity.projectName ? (
          <>
            {' '}
            {translate('auto.components.GitHubItemDialog.timeline.in', 'in')}{' '}
            <span className="font-medium text-foreground">{activity.projectName}</span>
          </>
        ) : null}
      </>
    )
  }

  const renderTimelineActivity = (activity: GitHubIssueTimelineItem): React.JSX.Element => {
    const Icon =
      activity.event === 'assigned'
        ? UserPlus
        : activity.event === 'unassigned'
          ? UserMinus
          : activity.event === 'closed'
            ? CheckCircle2
            : activity.event === 'reopened'
              ? CircleDot
              : activity.event === 'moved_columns_in_project'
                ? MoveRight
                : Link2
    return (
      <div
        key={`activity-${activity.id}`}
        className="flex min-w-0 items-start gap-3 rounded-md px-1 py-1.5 text-[13px] text-muted-foreground"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/30 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        {activity.actorAvatarUrl ? (
          <img src={activity.actorAvatarUrl} alt="" className="mt-1 size-5 shrink-0 rounded-full" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-medium text-foreground">{activity.actor}</span>
            <span className="contents">{renderTimelineActivityMessage(activity)}</span>
            <span className="text-[12px] text-muted-foreground">
              {formatRelativeTime(activity.createdAt)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const renderIssueConversationEntry = (entry: IssueConversationEntry): React.JSX.Element =>
    entry.kind === 'comment'
      ? renderCommentCard(entry.comment)
      : renderTimelineActivity(entry.activity)

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
                  {issueConversationEntries.map(renderIssueConversationEntry)}
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
                {visibleCommentGroups.map(renderCommentGroup)}
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
