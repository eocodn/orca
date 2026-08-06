import { useCallback } from 'react'
import { toast } from 'sonner'
import { getBrokenChecks, getCheckDetailsPromptKey, buildFixBrokenChecksPrompt } from '../pr-checks-fix-prompt'
import { startFixChecksAgent } from '@/lib/fix-checks-agent-launch'
import { translate } from '@/i18n/i18n'
import type { ChecksPanelFixKey } from './checks-panel-ai-fix-types'
import type { PRCheckRunDetails } from '../../../../shared/types'
export function useChecksPanelFixChecks<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelFixKey]: K extends keyof T ? T[K] : never }): () => Promise<void> {
  const {
    activeReview,
    activeWorktreeId,
    fetchPRCheckDetails,
    isCurrentAsyncResult,
    pr,
    repo,
    setIsFixingChecksWithAI,
    sourceControlAiActionsVisible,
    stateRequestKey,
  } = context
  return useCallback = useCallback(async (): Promise<void> => {
  if (
    !sourceControlAiActionsVisible ||
    isFixingChecksWithAI ||
    !activeWorktreeId ||
    !activeReview ||
    !repo
  ) {
    return
  }
  const broken = getBrokenChecks(checks)
  if (broken.length === 0) {
    toast.message(
      translate(
        'auto.components.right.sidebar.ChecksPanel.5594400d73',
        'No broken checks to fix.'
      )
    )
    return
  }
  const requestKey = stateRequestKey
  setIsFixingChecksWithAI(true)
  try {
    const checkRunDetailsByCheckKey: Record<string, PRCheckRunDetails> = {}
    if (activeReview.provider !== 'gitlab' && repo) {
      await Promise.all(
        broken.slice(0, 5).map(async (check, index) => {
          if (!check.checkRunId && !check.workflowRunId && !check.url) {
            return
          }
          try {
            const details = await fetchPRCheckDetails(
              repo.path,
              {
                checkRunId: check.checkRunId,
                workflowRunId: check.workflowRunId,
                checkName: check.name,
                url: check.url,
                prRepo: pr?.prRepo ?? null
              },
              { repoId: repo.id }
            )
            if (details) {
              checkRunDetailsByCheckKey[getCheckDetailsPromptKey(check, index)] = details
            }
          } catch (error) {
            console.warn('[ChecksPanel] failed to load check details for AI fix prompt', error)
          }
        })
      )
    }
    if (!isCurrentAsyncResult(requestKey)) {
      return
    }
    const basePrompt = buildFixBrokenChecksPrompt({
      reviewKind: activeReview.provider === 'gitlab' ? 'MR' : 'PR',
      reviewNumber: activeReview.number,
      reviewTitle: activeReview.title,
      reviewUrl: activeReview.url,
      checks,
      checkRunDetailsByCheckKey
    })
    const started = await startFixChecksAgent({
      repoId: repo.id,
      basePrompt,
      worktreeId: activeWorktreeId,
      groupId: activeWorktreeId,
      launchSource: 'task_page'
    })
    if (started) {
      toast.success(
        translate(
          'auto.components.right.sidebar.ChecksPanel.2ef90c9819',
          'Started an AI agent for the broken checks.'
        )
      )
    }
  } finally {
    setIsFixingChecksWithAI(false)
  }
}, [
  activeReview,
  activeWorktreeId,
  checks,
  fetchPRCheckDetails,
  isCurrentAsyncResult,
  isFixingChecksWithAI,
  pr?.prRepo,
  repo,
  sourceControlAiActionsVisible,
  stateRequestKey
])

}
