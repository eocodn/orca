/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Linear issue hydration and comments are loaded from provider IPC for the selected issue while preserving edit guards. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  FolderKanban,
  GitBranch,
  Link,
  LoaderCircle,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { VisuallyHidden } from 'radix-ui'

import { LinearIcon } from '@/components/icons/LinearIcon'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import {
  initLinearIssueEditState,
  LinearIssueCommentFooter,
  LinearIssueEditSection,
  type LinearEditState,
  type LinearLocalComment
} from '@/components/LinearItemDrawer'
import { Button } from '@/components/ui/button'
import { LinearIssueTextEditor } from '@/components/LinearIssueTextEditor'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildLinearIssueContextSnapshot } from '@/lib/linear-issue-context-snapshot'
import { buildContainedLinkedContextBlock } from '@/lib/linked-work-item-context'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useAppStore } from '@/store'
import {
  buildLinearIssueBranchName,
  formatLinearIssueRelativeTime
} from '@/components/linear-issue-workspace-text'
import { getLinearProjectSearchRequestQuery } from '@/components/linear-project-search-query'
import {
  linearCreateSubIssue,
  linearGetIssue,
  linearIssueComments,
  linearListProjects,
  linearUpdateIssue
} from '@/runtime/runtime-linear-client'
import type {
  LinearComment,
  LinearIssue,
  LinearIssueChildSummary,
  LinearProjectSummary
} from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'
import { LinearIssueSidebarProjectCard } from './linear-issue-sidebar-project-card'
import { LinearIssueWorkspaceContent } from './linear-issue-workspace-content'

type LinearIssueWorkspaceProps = {
  issue: LinearIssue | null
  onUse: (issue: LinearIssue) => void
  onOpenIssue: (issue: LinearIssue) => void
  onClose: () => void
  variant?: 'sheet' | 'page'
  backLabel?: string
  sourceContext?: TaskSourceContext | null
}

async function copyTextToClipboard(text: string, label: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      translate('auto.components.LinearIssueWorkspace.7835483c43', '{{value0}} copied', {
        value0: label
      })
    )
  } catch {
    toast.error(
      translate('auto.components.LinearIssueWorkspace.9bcbaa2737', 'Failed to copy {{value0}}', {
        value0: label.toLowerCase()
      })
    )
  }
}

function LinearIssueAvatar({
  avatarUrl,
  name,
  className = 'size-6'
}: {
  avatarUrl?: string
  name?: string
  className?: string
}): React.JSX.Element {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? ''} className={`${className} shrink-0 rounded-full`} />
  }

  const initial = name?.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground`}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

function LinearIssueSubIssueButton({
  issue,
  onOpenIssue,
  sourceContext
}: {
  issue: LinearIssue
  onOpenIssue: (issue: LinearIssue) => void
  sourceContext?: TaskSourceContext | null
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const providerSettings = sourceContext ?? settings
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [optimisticSubIssues, setOptimisticSubIssues] = useState<{
    issueId: string
    subIssues: LinearIssueChildSummary[]
  }>(() => ({
    issueId: issue.id,
    subIssues: []
  }))
  const [submitting, setSubmitting] = useState(false)
  const [openingSubIssueId, setOpeningSubIssueId] = useState<string | null>(null)
  const mountedRef = useMountedRef()

  const subIssues = useMemo(() => {
    const baseSubIssues = issue.subIssues ?? []
    if (optimisticSubIssues.issueId !== issue.id || optimisticSubIssues.subIssues.length === 0) {
      return baseSubIssues
    }
    const baseIds = new Set(baseSubIssues.map((subIssue) => subIssue.id))
    const additions = optimisticSubIssues.subIssues.filter((subIssue) => !baseIds.has(subIssue.id))
    return additions.length === 0 ? baseSubIssues : [...baseSubIssues, ...additions]
  }, [issue.id, issue.subIssues, optimisticSubIssues])

  const handleOpenSubIssue = useCallback(
    async (subIssue: LinearIssueChildSummary) => {
      setOpeningSubIssueId(subIssue.id)
      try {
        const fullIssue = await fetchLinearIssue(subIssue.id, issue.workspaceId, {
          sourceContext
        })
        if (!mountedRef.current) {
          return
        }
        if (fullIssue) {
          onOpenIssue(fullIssue)
        } else {
          toast.error(
            translate('auto.components.LinearIssueWorkspace.9a1317cdd3', 'Failed to load sub-issue')
          )
        }
      } catch (error) {
        if (mountedRef.current) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.LinearIssueWorkspace.9a1317cdd3',
                  'Failed to load sub-issue'
                )
          )
        }
      } finally {
        if (mountedRef.current) {
          setOpeningSubIssueId(null)
        }
      }
    },
    [fetchLinearIssue, issue.workspaceId, mountedRef, onOpenIssue, sourceContext]
  )

  const handleCreate = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    try {
      const result = await linearCreateSubIssue(providerSettings, {
        parentIssueId: issue.id,
        teamId: issue.team.id,
        title: trimmed,
        workspaceId: issue.workspaceId,
        projectId: issue.project?.id ?? null
      })
      if (result.ok) {
        const child = {
          id: result.id,
          identifier: result.identifier,
          title: result.title || trimmed,
          url: result.url
        }
        setOptimisticSubIssues((current) => {
          const currentSubIssues = current.issueId === issue.id ? current.subIssues : []
          if (
            currentSubIssues.some((subIssue) => subIssue.id === child.id) ||
            issue.subIssues?.some((subIssue) => subIssue.id === child.id)
          ) {
            return current
          }
          return { issueId: issue.id, subIssues: [...currentSubIssues, child] }
        })
        toast.success(
          translate('auto.components.LinearIssueWorkspace.aeed19d003', 'Created {{value0}}', {
            value0: result.identifier
          })
        )
        setTitle('')
        setOpen(false)
      } else {
        toast.error(result.error)
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.LinearIssueWorkspace.b25e453c9d',
              'Failed to create sub-issue'
            )
      )
    } finally {
      setSubmitting(false)
    }
  }, [
    issue.id,
    issue.project?.id,
    issue.subIssues,
    issue.team.id,
    issue.workspaceId,
    providerSettings,
    title
  ])

  return (
    <section className="mt-10 max-w-[820px]">
      {subIssues.length > 0 ? (
        <div className="mb-3 space-y-1">
          {subIssues.map((subIssue) => (
            <button
              key={subIssue.id}
              type="button"
              onClick={() => void handleOpenSubIssue(subIssue)}
              disabled={openingSubIssueId !== null}
              className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="shrink-0 font-mono text-xs">{subIssue.identifier}</span>
              <span className="min-w-0 flex-1 truncate">{subIssue.title}</span>
              {openingSubIssueId === subIssue.id ? (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
              ) : (
                <ArrowRight className="size-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-md px-1 text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-4" />
            <span>
              {translate('auto.components.LinearIssueWorkspace.8c55d6696a', 'Add sub-issues')}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreate()
                }
              }}
              placeholder={translate(
                'auto.components.LinearIssueWorkspace.c182e02de5',
                'Sub-issue title'
              )}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void handleCreate()}
                disabled={!title.trim() || submitting}
              >
                {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {translate('auto.components.LinearIssueWorkspace.42589845bc', 'Create')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </section>
  )
}


export default function LinearIssueWorkspace({
  issue,
  onUse,
  onOpenIssue,
  onClose,
  variant = 'sheet',
  backLabel = 'Back',
  sourceContext
}: LinearIssueWorkspaceProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const providerSettings = sourceContext ?? settings
  const [fullIssue, setFullIssue] = useState<LinearIssue | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [comments, setComments] = useState<LinearComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [editState, setEditState] = useState<LinearEditState | null>(null)
  const requestIdRef = useRef(0)
  const hydratedIssueKeyRef = useRef<string | null>(null)
  const hasEditedRef = useRef(false)
  const optimisticCommentsRef = useRef<LinearComment[]>([])
  const mountedRef = useMountedRef()

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

  const loadComments = useCallback(
    async (targetIssue: LinearIssue, requestId: number): Promise<void> => {
      if (mountedRef.current) {
        setCommentsLoading(true)
        setCommentsError(null)
      }
      try {
        let fetched = (await linearIssueComments(
          providerSettings,
          targetIssue.id,
          targetIssue.workspaceId
        )) as LinearComment[]
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return
        }
        const optimistic = optimisticCommentsRef.current
        if (optimistic.length > 0) {
          const fetchedIds = new Set(fetched.map((comment) => comment.id))
          fetched = [...fetched, ...optimistic.filter((comment) => !fetchedIds.has(comment.id))]
        }
        setComments(fetched)
      } catch (error) {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setCommentsError(error instanceof Error ? error.message : 'Failed to load comments.')
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setCommentsLoading(false)
        }
      }
    },
    [mountedRef, providerSettings]
  )

  useEffect(() => {
    if (!issue) {
      hydratedIssueKeyRef.current = null
      setFullIssue(null)
      setIssueLoading(false)
      setComments([])
      setCommentsError(null)
      setEditState(null)
      hasEditedRef.current = false
      optimisticCommentsRef.current = []
      return
    }

    const issueKey = `${sourceContext?.hostId ?? settings?.activeRuntimeEnvironmentId ?? 'local'}:${issue.workspaceId ?? 'selected'}:${issue.id}`
    if (hydratedIssueKeyRef.current === issueKey) {
      return
    }
    hydratedIssueKeyRef.current = issueKey

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    hasEditedRef.current = false
    optimisticCommentsRef.current = []
    setFullIssue(issue)
    setEditState(initLinearIssueEditState(issue))
    setComments([])
    setCommentsError(null)
    setIssueLoading(true)

    // Why: issue hydration and comments are separate surfaces; a comments
    // failure should not blank the issue detail the user selected.
    void linearGetIssue(providerSettings, issue.id, issue.workspaceId)
      .then((issueResult) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return
        }
        if (issueResult) {
          const fetched = issueResult as LinearIssue
          setFullIssue((prev) => {
            if (!hasEditedRef.current || !prev) {
              return fetched
            }
            // Why: late hydration can carry pre-edit field data; keep the
            // optimistic fields while accepting fresh non-field detail data.
            return {
              ...fetched,
              state: prev.state,
              title: prev.title,
              description: prev.description,
              priority: prev.priority,
              assignee: prev.assignee,
              estimate: prev.estimate,
              labelIds: prev.labelIds,
              labels: prev.labels
            }
          })
          if (!hasEditedRef.current) {
            setEditState(initLinearIssueEditState(fetched))
          }
        }
      })
      .catch(() => {
        /* The list issue remains useful if detail hydration is temporarily unavailable. */
      })
      .finally(() => {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setIssueLoading(false)
        }
      })

    void loadComments(issue, requestId)
  }, [issue, loadComments, mountedRef, providerSettings, settings, sourceContext?.hostId])

  const displayed = fullIssue ?? issue

  const handleUseIssue = useCallback((): void => {
    if (!displayed) {
      return
    }
    onUse(displayed)
  }, [displayed, onUse])

  const handleCommentAdded = useCallback((comment: LinearLocalComment) => {
    const newComment: LinearComment = {
      id: comment.id || createBrowserUuid(),
      body: comment.body,
      createdAt: comment.createdAt,
      user: { displayName: 'You' }
    }
    optimisticCommentsRef.current.push(newComment)
    setComments((prev) => [...prev, newComment])
  }, [])

  const handleProjectChanged = useCallback((project: LinearProjectSummary) => {
    setFullIssue((prev) => (prev ? { ...prev, project } : prev))
  }, [])

  const actionItems = useMemo(() => {
    if (!displayed) {
      return []
    }
    return [
      {
        label: translate('auto.components.LinearIssueWorkspace.9a9a884236', 'Copy URL'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.url, 'URL')
      },
      {
        label: translate('auto.components.LinearIssueWorkspace.30c1242f3a', 'Copy identifier'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.identifier, 'Identifier')
      },
      {
        label: translate(
          'auto.components.LinearIssueWorkspace.5d670ec8dc',
          'Copy suggested branch name'
        ),
        icon: GitBranch,
        action: () =>
          void copyTextToClipboard(buildLinearIssueBranchName(displayed), 'Suggested branch name')
      },
      {
        label: translate('auto.components.LinearIssueWorkspace.f6c6381593', 'Copy prompt'),
        icon: Clipboard,
        action: () => {
          const renderedText = buildLinearIssueContextSnapshot(displayed, comments)
          const prompt =
            buildContainedLinkedContextBlock({
              provider: 'linear',
              version: 1,
              renderedText
            }) ?? renderedText
          void copyTextToClipboard(prompt, 'Prompt')
        }
      }
    ]
  }, [comments, displayed])

  const content = (
    <LinearIssueWorkspaceContent
      displayed={displayed}
      variant={variant}
      backLabel={backLabel}
      issueLoading={issueLoading}
      onClose={onClose}
      onUseIssue={handleUseIssue}
      onOpenIssue={onOpenIssue}
      sourceContext={sourceContext}
      handleIssueTextChange={handleIssueTextChange}
      SubIssueButton={LinearIssueSubIssueButton}
      IssueAvatar={LinearIssueAvatar}
      commentsError={commentsError}
      loadComments={loadComments}
      requestIdRef={requestIdRef}
      commentsLoading={commentsLoading}
      comments={comments}
      handleCommentAdded={handleCommentAdded}
      editState={editState}
      handleEditStateChange={handleEditStateChange}
      handleProjectChanged={handleProjectChanged}
      actionItems={actionItems}
    />
  )
  if (variant === 'page') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
        {content}
      </div>
    )
  }

  return (
    <Sheet open={issue !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,1180px)] bg-background p-0 sm:max-w-[1180px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>
            {displayed?.title ??
              translate('auto.components.LinearIssueWorkspace.61f424f8ca', 'Linear issue')}
          </SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            {translate(
              'auto.components.LinearIssueWorkspace.ad5dec37b7',
              'Preview, edit, and start work from the selected issue.'
            )}
          </SheetDescription>
        </VisuallyHidden.Root>

        {content}
      </SheetContent>
    </Sheet>
  )
}
