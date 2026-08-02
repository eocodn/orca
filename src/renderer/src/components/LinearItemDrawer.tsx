/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Linear drawer state hydrates full issue details and comments from provider IPC for the selected issue. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Gauge,
  LoaderCircle,
  Send,
  Tag,
  UserRound,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LinearIssueTextEditor } from '@/components/LinearIssueTextEditor'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VisuallyHidden } from 'radix-ui'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { useAppStore } from '@/store'
import { getScreenSubmitShortcutLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  useTeamStates,
  useTeamLabels,
  useTeamMembers,
  useImmediateMutation
} from '@/hooks/useIssueMetadata'
import {
  getLinearStateMarkerStyle,
  getLinearStatePillStyle
} from '@/components/linear-state-pill-style'
import { LinearPriorityIcon } from '@/components/linear-priority-icon'
import type { LinearIssue, LinearComment } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import {
  linearAddIssueComment,
  linearGetIssue,
  linearIssueComments,
  linearUpdateIssue
} from '@/runtime/runtime-linear-client'
import { translate } from '@/i18n/i18n'

import {
  LinearIssueEditSection,
  formatLinearEstimateLabel,
  type LinearEditState
} from './linear-item-edit-section'
export { LinearIssueEditSection, formatLinearEstimateLabel }
export type { LinearEditState } from './linear-item-edit-section'

export function initLinearIssueEditState(issue: LinearIssue): LinearEditState {
  return {
    state: issue.state,
    priority: issue.priority,
    estimate: issue.estimate,
    assignee: issue.assignee,
    labelIds: issue.labelIds,
    labels: issue.labels
  }
}
export default function LinearItemDrawer({
  issue,
  onUse,
  onClose,
  sourceContext
}: LinearItemDrawerProps): React.JSX.Element {
  const [fullIssue, setFullIssue] = useState<LinearIssue | null>(null)
  const [comments, setComments] = useState<LinearComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [editState, setEditState] = useState<LinearEditState | null>(null)
  const requestIdRef = useRef(0)
  const hasEditedRef = useRef(false)
  const optimisticCommentsRef = useRef<LinearComment[]>([])
  const settings = useAppStore((s) => s.settings)
  const providerSettings = sourceContext ?? settings

  const handleEditStateChange = useCallback((patch: Partial<LinearEditState>) => {
    hasEditedRef.current = true
    setFullIssue((prev) => (prev ? { ...prev, ...patch } : prev))
    setEditState((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const handleIssueTextChange = useCallback(
    (patch: Partial<Pick<LinearIssue, 'title' | 'description'>>) => {
      hasEditedRef.current = true
      setFullIssue((prev) => (prev ? { ...prev, ...patch } : prev))
    },
    []
  )

  // Why: the list view may not include the full description. Re-fetch
  // the issue by ID and its comments to populate the drawer.
  useEffect(() => {
    if (!issue) {
      setFullIssue(null)
      setComments([])
      setEditState(null)
      hasEditedRef.current = false
      return
    }
    hasEditedRef.current = false
    optimisticCommentsRef.current = []
    setComments([])
    setCommentsLoading(true)
    setEditState(initLinearIssueEditState(issue))
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setFullIssue(issue)

    // Why: fetch issue and comments independently so a transient comments
    // failure doesn't discard the successfully-fetched issue data.
    linearGetIssue(providerSettings, issue.id, issue.workspaceId)
      .then((issueResult) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        if (issueResult) {
          const fetched = issueResult as LinearIssue
          setFullIssue(fetched)
          // Why: skip if the user already made optimistic edits — the fetch
          // carries pre-edit data that would clobber in-flight changes.
          if (!hasEditedRef.current) {
            setEditState(initLinearIssueEditState(fetched))
          }
        }
      })
      .catch(() => {})

    linearIssueComments(providerSettings, issue.id, issue.workspaceId)
      .then((commentsResult) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        // Why: merge any comments the user posted optimistically while the
        // fetch was in-flight, using id to avoid duplicates.
        let fetched = commentsResult as LinearComment[]
        const opt = optimisticCommentsRef.current
        if (opt.length > 0) {
          const fetchedIds = new Set(fetched.map((c) => c.id))
          const missing = opt.filter((c) => !fetchedIds.has(c.id))
          if (missing.length > 0) {
            fetched = [...fetched, ...missing]
          }
        }
        setComments(fetched)
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setCommentsLoading(false)
        }
      })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, issue?.workspaceId, providerSettings])

  // Why: same pointer-events fix as GitHubItemDialog — Radix may leave
  // pointer-events: none on body when overlays transition.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!issue?.id) {
      return
    }
    let cancelled = false
    let count = 0
    let frameId: number | null = null
    const tick = (): void => {
      frameId = null
      if (cancelled) {
        return
      }
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = ''
      }
      if (count++ < 5) {
        frameId = requestAnimationFrame(tick)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [issue?.id])

  const handleCommentAdded = useCallback((comment: LinearLocalComment) => {
    const newComment: LinearComment = {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      user: { displayName: 'You' }
    }
    optimisticCommentsRef.current.push(newComment)
    setComments((prev) => [...prev, newComment])
  }, [])

  const displayed = fullIssue ?? issue

  return (
    <Sheet open={issue !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full p-0 sm:max-w-[640px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>
            {displayed?.title ??
              translate('auto.components.LinearItemDrawer.39883467f4', 'Linear issue')}
          </SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            {translate(
              'auto.components.LinearItemDrawer.04a442f796',
              'Preview and edit the selected Linear issue.'
            )}
          </SheetDescription>
        </VisuallyHidden.Root>

        {displayed && (
          <div className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div className="flex-none border-b border-border/60 px-4 py-3">
              <div className="flex items-start gap-2">
                <LinearIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {displayed.identifier}
                  </span>
                  <div className="mt-1">
                    <LinearIssueTextEditor
                      issue={displayed}
                      onIssueChange={handleIssueTextChange}
                      density="drawer"
                      fields="title"
                      sourceContext={sourceContext}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {displayed.workspaceName && <span>{displayed.workspaceName}</span>}
                    {displayed.team?.name && <span>{displayed.team.name}</span>}
                    <span>· {formatRelativeTime(displayed.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => window.api.shell.openUrl(displayed.url)}
                        aria-label={translate(
                          'auto.components.LinearItemDrawer.0190b760c1',
                          'Open on Linear'
                        )}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {translate('auto.components.LinearItemDrawer.0190b760c1', 'Open on Linear')}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={onClose}
                        aria-label={translate(
                          'auto.components.LinearItemDrawer.858d0630da',
                          'Close preview'
                        )}
                      >
                        <X className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {translate('auto.components.LinearItemDrawer.9dc54172db', 'Close · Esc')}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Edit section */}
            {editState && (
              <LinearIssueEditSection
                issue={displayed}
                editState={editState}
                onEditStateChange={handleEditStateChange}
                sourceContext={sourceContext}
              />
            )}

            {/* Body + comments */}
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              <div className="px-4 py-4">
                <LinearIssueTextEditor
                  issue={displayed}
                  onIssueChange={handleIssueTextChange}
                  density="drawer"
                  fields="description"
                  sourceContext={sourceContext}
                />
              </div>

              <div className="border-t border-border/40 px-4 py-4">
                <div className="flex items-center gap-2 pb-3">
                  <span className="text-[13px] font-medium text-foreground">
                    {translate('auto.components.LinearItemDrawer.fde849b2b6', 'Comments')}
                  </span>
                  {comments.length > 0 && (
                    <span className="text-[12px] text-muted-foreground">{comments.length}</span>
                  )}
                </div>
                {commentsLoading && comments.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    {translate('auto.components.LinearItemDrawer.a4fcc57522', 'No comments yet.')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="rounded-lg border border-border/40 bg-background/30"
                      >
                        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
                          {comment.user?.avatarUrl && (
                            <img
                              src={comment.user.avatarUrl}
                              alt={comment.user.displayName}
                              className="size-5 shrink-0 rounded-full"
                            />
                          )}
                          <span className="text-[13px] font-semibold text-foreground">
                            {comment.user?.displayName ??
                              translate('auto.components.LinearItemDrawer.48e17e8cbd', 'Unknown')}
                          </span>
                          <span className="text-[12px] text-muted-foreground">
                            · {formatRelativeTime(comment.createdAt)}
                          </span>
                        </div>
                        <div className="px-3 py-2">
                          <CommentMarkdown
                            content={comment.body}
                            className="text-[13px] leading-relaxed"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Comment footer + Start workspace */}
            <LinearIssueCommentFooter
              issueId={displayed.id}
              workspaceId={displayed.workspaceId}
              onCommentAdded={handleCommentAdded}
              sourceContext={sourceContext}
            />
            <div className="flex-none border-t border-border/60 bg-background/40 px-4 py-3">
              <Button
                onClick={() => onUse(displayed)}
                className="w-full justify-center gap-2"
                aria-label={translate(
                  'auto.components.LinearItemDrawer.04008e6c46',
                  'Start workspace from issue'
                )}
              >
                {translate(
                  'auto.components.LinearItemDrawer.04008e6c46',
                  'Start workspace from issue'
                )}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
import { LinearIssueCommentFooter, type LinearLocalComment } from './linear-issue-comment-footer'
