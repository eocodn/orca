import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import {
  jiraAddIssueComment,
  jiraGetIssue,
  jiraIssueComments,
  jiraListAssignableUsers,
  jiraListPriorities,
  jiraListTransitions,
  jiraUpdateIssue
} from '@/runtime/runtime-jira-client'
import type {
  JiraComment,
  JiraIssue,
  JiraPriority,
  JiraTransition,
  JiraUser
} from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'

type JiraIssueWorkspaceControllerProps = {
  issue: JiraIssue | null
  providerSettings: Parameters<typeof jiraGetIssue>[0]
  sourceContext?: TaskSourceContext | null
  patchJiraIssue: (
    key: string,
    issue: Partial<JiraIssue>,
    options?: { sourceContext?: TaskSourceContext | null }
  ) => void
}

export function useJiraIssueWorkspaceController({
  issue,
  providerSettings,
  sourceContext,
  patchJiraIssue
}: JiraIssueWorkspaceControllerProps) {
  const [fullIssue, setFullIssue] = useState<JiraIssue | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [comments, setComments] = useState<JiraComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [transitions, setTransitions] = useState<JiraTransition[]>([])
  const [priorities, setPriorities] = useState<JiraPriority[]>([])
  const [users, setUsers] = useState<JiraUser[]>([])
  const [pendingField, setPendingField] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [labelsDraft, setLabelsDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const requestIdRef = useRef(0)
  const optimisticCommentsRef = useRef<JiraComment[]>([])

  const displayed = fullIssue ?? issue
  const siteId = displayed?.siteId ?? undefined

  const loadComments = useCallback(
    async (targetIssue: JiraIssue, requestId: number): Promise<void> => {
      setCommentsLoading(true)
      setCommentsError(null)
      try {
        let fetched = await jiraIssueComments(providerSettings, targetIssue.key, targetIssue.siteId)
        if (requestId !== requestIdRef.current) {
          return
        }
        const optimistic = optimisticCommentsRef.current
        if (optimistic.length > 0) {
          const fetchedIds = new Set(fetched.map((comment) => comment.id))
          fetched = [...fetched, ...optimistic.filter((comment) => !fetchedIds.has(comment.id))]
        }
        setComments(fetched)
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setCommentsError(error instanceof Error ? error.message : 'Failed to load comments.')
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setCommentsLoading(false)
        }
      }
    },
    [providerSettings]
  )

  useEffect(() => {
    if (!issue) {
      setFullIssue(null)
      setIssueLoading(false)
      setComments([])
      setCommentsError(null)
      setTransitions([])
      setPriorities([])
      setUsers([])
      setCommentDraft('')
      optimisticCommentsRef.current = []
      return
    }

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    optimisticCommentsRef.current = []
    setFullIssue(issue)
    setTitleDraft(issue.title)
    setLabelsDraft(issue.labels.join(', '))
    setComments([])
    setCommentsError(null)
    setIssueLoading(true)

    void jiraGetIssue(providerSettings, issue.key, issue.siteId)
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        if (result) {
          setFullIssue(result)
          setTitleDraft(result.title)
          setLabelsDraft(result.labels.join(', '))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIssueLoading(false)
        }
      })

    void Promise.all([
      jiraListTransitions(providerSettings, issue.key, issue.siteId),
      jiraListPriorities(providerSettings, issue.siteId),
      jiraListAssignableUsers(providerSettings, issue.key, undefined, issue.siteId)
    ])
      .then(([nextTransitions, nextPriorities, nextUsers]) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        setTransitions(nextTransitions)
        setPriorities(nextPriorities)
        setUsers(nextUsers)
      })
      .catch(() => {})

    void loadComments(issue, requestId)
  }, [issue, loadComments, providerSettings])

  const refreshIssue = useCallback(async (): Promise<void> => {
    if (!displayed) {
      return
    }
    try {
      const latest = await jiraGetIssue(providerSettings, displayed.key, displayed.siteId)
      if (latest) {
        setFullIssue(latest)
        patchJiraIssue(latest.key, latest, { sourceContext })
      }
    } catch {
      // Keep the visible issue snapshot if refresh fails.
    }
  }, [displayed, patchJiraIssue, providerSettings, sourceContext])

  const mutateIssue = useCallback(
    async (
      field: string,
      updates: Parameters<typeof jiraUpdateIssue>[2],
      optimistic?: Partial<JiraIssue>
    ): Promise<void> => {
      if (!displayed || pendingField) {
        return
      }
      setPendingField(field)
      const previous = displayed
      try {
        if (optimistic) {
          setFullIssue({ ...displayed, ...optimistic })
          patchJiraIssue(displayed.key, optimistic, { sourceContext })
        }
        const result = await jiraUpdateIssue(providerSettings, displayed.key, updates, siteId)
        if (!result.ok) {
          throw new Error(result.error)
        }
        await refreshIssue()
      } catch (error) {
        setFullIssue(previous)
        patchJiraIssue(previous.key, previous, { sourceContext })
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.JiraIssueWorkspace.ea21952aa3',
                'Failed to update Jira issue.'
              )
        )
      } finally {
        setPendingField(null)
      }
    },
    [displayed, patchJiraIssue, pendingField, refreshIssue, providerSettings, siteId, sourceContext]
  )

  const handleSaveTitle = useCallback(() => {
    if (!displayed) {
      return
    }
    const title = titleDraft.trim()
    if (!title || title === displayed.title) {
      setTitleDraft(displayed.title)
      return
    }
    void mutateIssue('title', { title }, { title })
  }, [displayed, mutateIssue, titleDraft])

  const handleSaveLabels = useCallback(() => {
    if (!displayed) {
      return
    }
    const labels = labelsDraft
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
    void mutateIssue('labels', { labels }, { labels })
  }, [displayed, labelsDraft, mutateIssue])

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    if (!displayed || commentSubmitting) {
      return
    }
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.JiraIssueWorkspace.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setCommentSubmitting(true)
    try {
      const result = await jiraAddIssueComment(
        providerSettings,
        displayed.key,
        bodyState.body,
        displayed.siteId
      )
      if (!result.ok) {
        throw new Error(result.error)
      }
      const comment: JiraComment = {
        id: result.id || createBrowserUuid(),
        body: bodyState.body,
        createdAt: new Date().toISOString(),
        user: { accountId: 'local', displayName: 'You' }
      }
      optimisticCommentsRef.current.push(comment)
      setComments((prev) => [...prev, comment])
      setCommentDraft('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.components.JiraIssueWorkspace.fa132c8aed', 'Failed to add comment.')
      )
    } finally {
      setCommentSubmitting(false)
    }
  }, [commentDraft, commentSubmitting, displayed, providerSettings])
  const canSubmitComment = hasBoundedCommentBodyText(commentDraft)


  return {
    canSubmitComment,
    commentDraft,
    commentSubmitting,
    comments,
    commentsError,
    commentsLoading,
    displayed,
    fullIssue,
    handleSaveLabels,
    handleSaveTitle,
    handleSubmitComment,
    issueLoading,
    labelsDraft,
    loadComments,
    mutateIssue,
    pendingField,
    priorities,
    requestIdRef,
    refreshIssue,
    setCommentDraft,
    setLabelsDraft,
    setTitleDraft,
    siteId,
    titleDraft,
    transitions,
    users
  }
}
