import { useCallback } from 'react'
import { toast } from 'sonner'
import { openHttpLink } from '@/lib/http-link-routing'
import { normalizeHostedReviewHeadRef } from '../../../../shared/hosted-review-refs'
import { stripBaseRef } from './useCreatePullRequestDialogFields'
import { clearPullRequestGenerationRequiresPushBeforeCreate } from '@/store/slices/pull-request-generation'
import { formatCreateError } from './create-pull-request-review-copy'
import { translate } from '@/i18n/i18n'
import type { ChecksPanelCreateKey } from './checks-panel-create-types'
export function useChecksPanelCreateAction<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelCreateKey]: K extends keyof T ? T[K] : never }): () => Promise<void> {
  const {
    activePullRequestGenerationKey,
    activeWorktreeId,
    activeWorktreePath,
    branch,
    createComposerOpen,
    createHostedReview,
    createPrInFlightRef,
    createPrPushFirst,
    hostedReviewCreateCopy,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    panelContextKey,
    panelContextKeyRef,
    prCreationDefaults,
    repo,
    setCreatePrError,
    setGitStatusRefreshNonce,
    setIsCreatingPr,
    updatePullRequestGenerationRecord,
  } = context
  return useCallback(async (): Promise<void> => {
  if (!repo || !branch || !createComposerOpen || prGenerating || createPrInFlightRef.current) {
    return
  }

  const requestContextKey = panelContextKey
  const isCurrentCreateRequest = (): boolean =>
    panelContextKeyRef.current === requestContextKey &&
    createPrInFlightRef.current === requestContextKey
  const base = stripBaseRef(prBase).trim()
  const title = prTitle.trim()
  const worktreePath = activeWorktreePath ?? repo.path
  if (!title) {
    setCreatePrError(
      translate(
        'auto.components.right.sidebar.SourceControl.f3a8b2c1d0e5',
        'Enter a {{value0}} title.',
        {
          value0: hostedReviewCreateCopy.reviewLabel
        }
      )
    )
    return
  }
  if (!base || stripBaseRef(base).toLowerCase() === stripBaseRef(branch).toLowerCase()) {
    setCreatePrError(
      translate(
        'auto.components.right.sidebar.SourceControl.ae743199cd',
        'Choose a different base branch before creating a {{value0}}.',
        { value0: hostedReviewCreateCopy.reviewLabel }
      )
    )
    return
  }

  createPrInFlightRef.current = requestContextKey
  setIsCreatingPr(true)
  setCreatePrError(null)
  let pushed = false
  try {
    const shouldPushBeforeCreate =
      createPrPushFirst || hostedReviewCreation?.blockedReason === 'needs_push'
    if (shouldPushBeforeCreate) {
      const ok = await pushBeforeCreatePullRequest()
      if (!isCurrentCreateRequest()) {
        return
      }
      if (!ok) {
        setCreatePrError('Push failed. Resolve the push error, then try again.')
        return
      }
      pushed = true
    }
    const result = await createHostedReview(repo.path, {
      repoId: repo.id,
      provider: hostedReviewCreateProvider,
      base,
      head: normalizeHostedReviewHeadRef(branch),
      title,
      body: prBody,
      draft: prDraft,
      worktreePath,
      useTemplate: prCreationDefaults.useTemplate
    })
    if (!isCurrentCreateRequest()) {
      return
    }
    if (result.ok) {
      await handlePullRequestCreated({
        provider: hostedReviewCreateProvider,
        number: result.number,
        url: result.url
      })
      if (prCreationDefaults.openAfterCreate) {
        openHttpLink(result.url, { worktreeId: activeWorktreeId })
      }
      if (activePullRequestGenerationKey) {
        updatePullRequestGenerationRecord(
          activePullRequestGenerationKey,
          clearPullRequestGenerationRequiresPushBeforeCreate
        )
      }
      return
    }
    if (result.existingReview?.url) {
      const number = result.existingReview.number
      toast.success(
        number
          ? translate(
              'auto.components.right.sidebar.ChecksPanel.b6ce28da5b',
              '{{value0}} #{{value1}} is already open',
              { value0: hostedReviewCreateCopy.titleLabel, value1: number }
            )
          : translate(
              'auto.components.right.sidebar.ChecksPanel.cf9e69f3be',
              '{{value0}} is already open',
              { value0: hostedReviewCreateCopy.titleLabel }
            ),
        {
          action: {
            label: translate(
              'auto.components.right.sidebar.ChecksPanel.192e686e57',
              'Open on {{value0}}',
              { value0: hostedReviewCreateCopy.providerName }
            ),
            onClick: () => window.api.shell.openUrl(result.existingReview!.url)
          }
        }
      )
      if (number) {
        await handlePullRequestCreated({
          provider: hostedReviewCreateProvider,
          number,
          url: result.existingReview.url
        })
        if (activePullRequestGenerationKey) {
          updatePullRequestGenerationRecord(
            activePullRequestGenerationKey,
            clearPullRequestGenerationRequiresPushBeforeCreate
          )
        }
        return
      }
    }
    setCreatePrError(formatCreateError(result, pushed, hostedReviewCreateCopy.shortLabel))
  } catch (error) {
    if (!isCurrentCreateRequest()) {
      return
    }
    setCreatePrError(
      error instanceof Error
        ? error.message
        : translate(
            'auto.components.right.sidebar.SourceControl.e2b7a1c0d9f4',
            'Failed to create {{value0}}',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
    )
  } finally {
    if (createPrInFlightRef.current === requestContextKey) {
      createPrInFlightRef.current = null
      setIsCreatingPr(false)
      setGitStatusRefreshNonce((value) => value + 1)
    }
  }
}, [
  activeWorktreePath,
  activeWorktreeId,
  activePullRequestGenerationKey,
  branch,
  createComposerOpen,
  createHostedReview,
  createPrPushFirst,
  handlePullRequestCreated,
  hostedReviewCreateCopy.providerName,
  hostedReviewCreateCopy.reviewLabel,
  hostedReviewCreateCopy.shortLabel,
  hostedReviewCreateCopy.titleLabel,
  hostedReviewCreateProvider,
  hostedReviewCreation?.blockedReason,
  panelContextKey,
  prBase,
  prBody,
  prCreationDefaults.openAfterCreate,
  prCreationDefaults.useTemplate,
  prDraft,
  prGenerating,
  prTitle,
  pushBeforeCreatePullRequest,
  repo,
  updatePullRequestGenerationRecord
])

}
