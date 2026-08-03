import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../shared/repo-kind'
import type { SetupAgentStartupPolicy } from '../../../shared/types'
import { getRepoSetupAgentStartupPolicy, buildSetupAgentStartupHookSettings } from './composer-state-contracts'
import { translate } from '@/i18n/i18n'

export function useComposerSetupPolicy(context: any) {
  const {
    repoId,
    selectedRepo,
    updateRepo,
    setupAgentStartupPolicy,
    setSetupAgentStartupPolicy,
    setupAgentStartupPolicyRef,
    setupAgentStartupPolicySaveRef,
    setupAgentStartupPolicyDraftRef
  } = context
const persistedSetupAgentStartupPolicy = getRepoSetupAgentStartupPolicy(selectedRepo)
  useEffect(() => {
    const draft = setupAgentStartupPolicyDraftRef.current
    if (draft?.repoId === repoId && draft.policy !== persistedSetupAgentStartupPolicy) {
      return
    }
    setupAgentStartupPolicyRef.current = persistedSetupAgentStartupPolicy
    setSetupAgentStartupPolicy(persistedSetupAgentStartupPolicy)
  }, [repoId, persistedSetupAgentStartupPolicy])

  const persistSetupAgentStartupPolicy = useCallback(
    async (
      policy: SetupAgentStartupPolicy = setupAgentStartupPolicyRef.current
    ): Promise<boolean> => {
      while (true) {
        const currentRepo = useAppStore.getState().repos.find((repo) => repo.id === repoId)
        if (!currentRepo || !isGitRepoKind(currentRepo)) {
          return true
        }
        const pendingSave = setupAgentStartupPolicySaveRef.current
        if (pendingSave?.repoId === currentRepo.id) {
          if (pendingSave.policy === policy) {
            const saved = await pendingSave.promise
            if (
              saved &&
              setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
              setupAgentStartupPolicyDraftRef.current.policy === policy
            ) {
              setupAgentStartupPolicyDraftRef.current = null
            }
            return saved
          }
          await pendingSave.promise
          continue
        }
        if (getRepoSetupAgentStartupPolicy(currentRepo) === policy) {
          if (
            setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
            setupAgentStartupPolicyDraftRef.current.policy === policy
          ) {
            setupAgentStartupPolicyDraftRef.current = null
          }
          return true
        }
        const promise = updateRepo(currentRepo.id, {
          hookSettings: buildSetupAgentStartupHookSettings(currentRepo.hookSettings, policy)
        }).finally(() => {
          if (setupAgentStartupPolicySaveRef.current?.promise === promise) {
            setupAgentStartupPolicySaveRef.current = null
          }
        })
        setupAgentStartupPolicySaveRef.current = { repoId: currentRepo.id, policy, promise }
        const saved = await promise
        if (
          saved &&
          setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
          setupAgentStartupPolicyDraftRef.current.policy === policy
        ) {
          setupAgentStartupPolicyDraftRef.current = null
        }
        return saved
      }
    },
    [repoId, updateRepo]
  )

  const handleSetupAgentStartupPolicyChange = useCallback(
    (policy: SetupAgentStartupPolicy) => {
      setupAgentStartupPolicyRef.current = policy
      if (repoId) {
        setupAgentStartupPolicyDraftRef.current = { repoId, policy }
      }
      setSetupAgentStartupPolicy(policy)
      void persistSetupAgentStartupPolicy(policy).then((saved) => {
        if (!saved) {
          toast.error(
            translate(
              'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
              'Failed to save setup startup behavior.'
            )
          )
        }
      })
    },
    [persistSetupAgentStartupPolicy, repoId]
  )

  return {
    persistedSetupAgentStartupPolicy,
    persistSetupAgentStartupPolicy,
    handleSetupAgentStartupPolicyChange
  }
}
