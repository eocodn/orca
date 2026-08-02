import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { persistSetupHookTrustApproval } from '../tasks/setup-hook-trust'

type SetupTrustActionInput = {
  client: RpcClient | null
  setupTrustPrompt: any
  setupTrustActionInFlightRef: { current: boolean }
  createInFlightRef: { current: boolean }
  trustedOrcaHooks: any
  setTrustedOrcaHooks: (value: any) => void
  setSetupTrustPrompt: (value: any) => void
  setCreating: (value: boolean) => void
  setError: (value: string) => void
  transitionDrawer: (view: 'form') => void
  handleCreate: (options?: { setupOverride?: 'run' | 'skip'; approvedSetupContentHash?: string }) => Promise<void>
}

export function useNewWorktreeSetupTrustActions({
  client,
  setupTrustPrompt,
  setupTrustActionInFlightRef,
  createInFlightRef,
  trustedOrcaHooks,
  setTrustedOrcaHooks,
  setSetupTrustPrompt,
  setCreating,
  setError,
  transitionDrawer,
  handleCreate
}: SetupTrustActionInput) {
  const approveSetupTrust = useCallback(async (alwaysTrust: boolean): Promise<void> => {
    if (!client || !setupTrustPrompt || setupTrustActionInFlightRef.current || createInFlightRef.current) {
      return
    }
    setupTrustActionInFlightRef.current = true
    setCreating(true)
    try {
      const nextTrust = await persistSetupHookTrustApproval({
        client,
        trust: trustedOrcaHooks,
        repoId: setupTrustPrompt.repoId,
        contentHash: setupTrustPrompt.contentHash,
        alwaysTrust
      })
      setTrustedOrcaHooks(nextTrust)
      const approvedHash = setupTrustPrompt.contentHash
      setSetupTrustPrompt(null)
      transitionDrawer('form')
      await handleCreate({ setupOverride: 'run', approvedSetupContentHash: approvedHash })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trust setup script.')
    } finally {
      setupTrustActionInFlightRef.current = false
      if (!createInFlightRef.current) {
        setCreating(false)
      }
    }
  }, [client, setupTrustPrompt, setupTrustActionInFlightRef, createInFlightRef, trustedOrcaHooks, setTrustedOrcaHooks, setSetupTrustPrompt, setCreating, setError, transitionDrawer, handleCreate])

  const closeSetupTrust = useCallback((): void => {
    if (setupTrustActionInFlightRef.current || createInFlightRef.current) {
      return
    }
    setSetupTrustPrompt(null)
    transitionDrawer('form')
  }, [setupTrustActionInFlightRef, createInFlightRef, setSetupTrustPrompt, transitionDrawer])

  const skipSetupTrust = useCallback((): void => {
    if (setupTrustActionInFlightRef.current || createInFlightRef.current) {
      return
    }
    closeSetupTrust()
    void handleCreate({ setupOverride: 'skip' })
  }, [setupTrustActionInFlightRef, createInFlightRef, closeSetupTrust, handleCreate])

  return { approveSetupTrust, closeSetupTrust, skipSetupTrust }
}

