import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { GitLabAssignableUser, GitLabMRUpdate } from '../../../shared/types'
import {
  dedupeGitLabUsers,
  formatGitLabLabelDraft,
  normalizeGitLabLabels,
  parseGitLabLabelDraft
} from './gitlab-item-dialog-content'
import type { GitLabItemDialogProps } from './gitlab-item-dialog-contracts'
import type { GitLabItemDialogState } from './gitlab-item-dialog-controller-state'

export function useGitLabItemDialogDetailsActions({
  item,
  state
}: {
  item: GitLabItemDialogProps['item']
  state: GitLabItemDialogState
}) {
  const {
    details,
    labelOptions,
    labelOptionsLoading,
    mountedRef,
    repoSelector,
    reviewerOptions,
    reviewerOptionsLoading,
    setBodyDraft,
    setDetails,
    setDetailsSaving,
    setEditingDetails,
    setLabelDraft,
    setLabelOptions,
    setLabelOptionsLoading,
    setReviewerDraftId,
    setReviewerOptions,
    setReviewerOptionsLoading,
    setReviewerUpdating,
    setTitleDraft,
    titleDraft,
    bodyDraft,
    labelDraft
  } = state

  const loadGitLabLabelOptions = useCallback(async (): Promise<void> => {
    if (!repoSelector || labelOptions !== null || labelOptionsLoading) {
      return
    }
    setLabelOptionsLoading(true)
    try {
      const labels = await window.api.gl.listLabels(repoSelector)
      if (mountedRef.current) {
        setLabelOptions(normalizeGitLabLabels(labels))
      }
    } catch {
      if (mountedRef.current) {
        setLabelOptions([])
      }
    } finally {
      if (mountedRef.current) {
        setLabelOptionsLoading(false)
      }
    }
  }, [labelOptions, labelOptionsLoading, mountedRef, repoSelector, setLabelOptions, setLabelOptionsLoading])

  const loadGitLabReviewerOptions = useCallback(async (): Promise<void> => {
    if (!repoSelector || reviewerOptions !== null || reviewerOptionsLoading) {
      return
    }
    setReviewerOptionsLoading(true)
    try {
      const users = await window.api.gl.listAssignableUsers(repoSelector)
      if (mountedRef.current) {
        setReviewerOptions(dedupeGitLabUsers(users))
      }
    } catch {
      if (mountedRef.current) {
        setReviewerOptions([])
      }
    } finally {
      if (mountedRef.current) {
        setReviewerOptionsLoading(false)
      }
    }
  }, [mountedRef, repoSelector, reviewerOptions, reviewerOptionsLoading, setReviewerOptions, setReviewerOptionsLoading])

  const handleStartDetailsEdit = useCallback((): void => {
    if (!item || !details || item.type !== 'mr') {
      return
    }
    setTitleDraft(details.item.title || item.title)
    setBodyDraft(details.body)
    setLabelDraft(formatGitLabLabelDraft(details.item.labels ?? item.labels))
    setEditingDetails(true)
    void loadGitLabLabelOptions()
  }, [details, item, loadGitLabLabelOptions, setBodyDraft, setEditingDetails, setLabelDraft, setTitleDraft])

  const handleCancelDetailsEdit = useCallback((): void => {
    setEditingDetails(false)
    setTitleDraft('')
    setBodyDraft('')
    setLabelDraft('')
  }, [setBodyDraft, setEditingDetails, setLabelDraft, setTitleDraft])

  const handleSaveDetails = useCallback(async (): Promise<void> => {
    if (!item || !details || !repoSelector || item.type !== 'mr') {
      return
    }
    const currentTitle = details.item.title || item.title
    const currentBody = details.body
    const currentLabels = normalizeGitLabLabels(details.item.labels ?? item.labels)
    const nextTitle = titleDraft.trim()
    const nextLabels = parseGitLabLabelDraft(labelDraft)
    if (!nextTitle) {
      toast.error(translate('auto.components.GitLabItemDialog.98718490e4', 'MR title is required.'))
      return
    }
    const currentKeys = new Set(currentLabels.map((label) => label.toLowerCase()))
    const nextKeys = new Set(nextLabels.map((label) => label.toLowerCase()))
    const updates: GitLabMRUpdate = {}
    if (nextTitle !== currentTitle) updates.title = nextTitle
    if (bodyDraft !== currentBody) updates.body = bodyDraft
    const addLabels = nextLabels.filter((label) => !currentKeys.has(label.toLowerCase()))
    const removeLabels = currentLabels.filter((label) => !nextKeys.has(label.toLowerCase()))
    if (addLabels.length > 0) updates.addLabels = addLabels
    if (removeLabels.length > 0) updates.removeLabels = removeLabels
    if (Object.keys(updates).length === 0) {
      handleCancelDetailsEdit()
      return
    }
    setDetailsSaving(true)
    try {
      const result = await window.api.gl.updateMR({ ...repoSelector, iid: item.number, updates })
      if (!mountedRef.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDetails((current) =>
        current
          ? { ...current, body: bodyDraft, item: { ...current.item, title: nextTitle, labels: nextLabels } }
          : current
      )
      setLabelOptions((current) => (current ? normalizeGitLabLabels([...current, ...nextLabels]) : current))
      handleCancelDetailsEdit()
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
    } finally {
      if (mountedRef.current) setDetailsSaving(false)
    }
  }, [bodyDraft, details, handleCancelDetailsEdit, item, labelDraft, mountedRef, repoSelector, setDetails, setDetailsSaving, setLabelOptions, titleDraft])

  const handleSetReviewers = useCallback(
    async (nextReviewers: GitLabAssignableUser[]): Promise<void> => {
      if (!repoSelector || !item || !details || item.type !== 'mr') return
      const reviewerIds = nextReviewers.map((reviewer) => reviewer.id).filter((id): id is number => typeof id === 'number')
      if (reviewerIds.length !== nextReviewers.length) {
        toast.error(translate('auto.components.GitLabItemDialog.ceaf7c30c7', 'Reviewer id is unavailable for this GitLab user.'))
        return
      }
      setReviewerUpdating(true)
      try {
        const result = await window.api.gl.updateMRReviewers({
          ...repoSelector,
          iid: item.number,
          reviewerIds,
          projectRef: details.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) return
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        setDetails((current) => (current ? { ...current, reviewers: dedupeGitLabUsers(result.reviewers) } : current))
        setReviewerDraftId('')
        setReviewerOptions((current) => (current ? dedupeGitLabUsers([...current, ...result.reviewers]) : current))
        useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
      } finally {
        if (mountedRef.current) setReviewerUpdating(false)
      }
    }, [details, item, mountedRef, repoSelector, setDetails, setReviewerDraftId, setReviewerOptions, setReviewerUpdating]
  )

  return {
    handleCancelDetailsEdit,
    handleSaveDetails,
    handleSetReviewers,
    handleStartDetailsEdit,
    loadGitLabLabelOptions,
    loadGitLabReviewerOptions
  }
}
