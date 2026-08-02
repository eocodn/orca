import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { GitLabPipelineJob } from '../../../shared/types'
import type { GitLabItemDialogProps } from './gitlab-item-dialog-contracts'
import type { GitLabItemDialogState } from './gitlab-item-dialog-controller-state'

export function useGitLabItemDialogPipelineActions({
  item,
  state
}: {
  item: GitLabItemDialogProps['item']
  state: GitLabItemDialogState
}) {
  const {
    details,
    expandedJobId,
    handleRefresh,
    jobTraceById,
    mountedRef,
    repoSelector,
    setDetails,
    setExpandedJobId,
    setJobTraceById,
    setRetryingJobId,
    retryingJobId
  } = state

  const handleToggleJobTrace = useCallback(
    async (job: GitLabPipelineJob): Promise<void> => {
      if (expandedJobId === job.id) {
        setExpandedJobId(null)
        return
      }
      setExpandedJobId(job.id)
      if (!repoSelector || !item || jobTraceById[job.id]?.trace || jobTraceById[job.id]?.error) return
      setJobTraceById((current) => ({ ...current, [job.id]: { loading: true } }))
      try {
        const result = await window.api.gl.jobTrace({
          ...repoSelector,
          jobId: job.id,
          projectRef: details?.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) return
        setJobTraceById((current) => ({
          ...current,
          [job.id]: result.ok
            ? { loading: false, trace: result.trace }
            : { loading: false, error: result.error }
        }))
      } catch (reason) {
        if (mountedRef.current) {
          setJobTraceById((current) => ({
            ...current,
            [job.id]: { loading: false, error: reason instanceof Error ? reason.message : String(reason) }
          }))
        }
      }
    }, [details?.item.projectRef, expandedJobId, item, jobTraceById, mountedRef, repoSelector, setExpandedJobId, setJobTraceById]
  )

  const handleRetryJob = useCallback(
    async (job: GitLabPipelineJob): Promise<void> => {
      if (!repoSelector || !item) return
      setRetryingJobId(job.id)
      try {
        const result = await window.api.gl.retryJob({
          ...repoSelector,
          jobId: job.id,
          projectRef: details?.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) return
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(translate('auto.components.GitLabItemDialog.f7cb495a12', 'Retried {{value0}}', { value0: job.name }))
        if (result.job) {
          setDetails((current) =>
            current
              ? { ...current, pipelineJobs: (current.pipelineJobs ?? []).map((existing) => existing.id === job.id ? result.job! : existing) }
              : current
          )
        }
        handleRefresh()
      } finally {
        if (mountedRef.current) setRetryingJobId(null)
      }
    }, [details?.item.projectRef, handleRefresh, item, mountedRef, repoSelector, setDetails, setRetryingJobId]
  )

  return { handleRetryJob, handleToggleJobTrace, retryingJobId }
}
