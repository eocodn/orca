import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { GitLabItemDialogProps } from './gitlab-item-dialog-contracts'
import type { GitLabItemDialogState } from './gitlab-item-dialog-controller-state'

type MrAction = 'close' | 'reopen' | 'merge'

export function useGitLabItemDialogMrActions({
  item,
  state
}: {
  item: GitLabItemDialogProps['item']
  state: GitLabItemDialogState
}) {
  const { handleRefresh, mountedRef, repoSelector, setActionInFlight } = state

  const runAction = useCallback(async (action: MrAction): Promise<void> => {
    if (!item || !repoSelector || item.type !== 'mr') return
    setActionInFlight(action)
    try {
      const result = action === 'close'
        ? await window.api.gl.closeMR({ ...repoSelector, iid: item.number })
        : action === 'reopen'
          ? await window.api.gl.reopenMR({ ...repoSelector, iid: item.number })
          : await window.api.gl.mergeMR({ ...repoSelector, iid: item.number })
      if (!mountedRef.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
      const message = action === 'close'
        ? 'Closed MR !{{value0}}'
        : action === 'reopen'
          ? 'Reopened MR !{{value0}}'
          : 'Merged MR !{{value0}}'
      const translationKey = action === 'close'
        ? 'auto.components.GitLabItemDialog.9b11cd233f'
        : action === 'reopen'
          ? 'auto.components.GitLabItemDialog.865ea2703e'
          : 'auto.components.GitLabItemDialog.e089f62594'
      toast.success(translate(translationKey, message, { value0: item.number }))
      handleRefresh()
    } finally {
      if (mountedRef.current) setActionInFlight(null)
    }
  }, [handleRefresh, item, mountedRef, repoSelector, setActionInFlight])

  return {
    handleClose: useCallback(() => runAction('close'), [runAction]),
    handleMerge: useCallback(() => runAction('merge'), [runAction]),
    handleReopen: useCallback(() => runAction('reopen'), [runAction])
  }
}
