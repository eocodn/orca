import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import { makePaneKey } from '../../shared/stable-pane-id'
import {
  registerSshPtyProvider,
  unregisterSshPtyProvider
} from './pty-ipc-runtime-provider-lifecycle-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import {
  reconcileAgentSessionOwnerListings,
  rememberPaneKeyForPty
} from './pty-ipc-runtime-pane-state'

const PTY_ID = 'pty-pane-state'
const OLD_PANE_KEY = makePaneKey('tab-old', '11111111-1111-4111-8111-111111111111')
const NEW_PANE_KEY = makePaneKey('tab-new', '22222222-2222-4222-8222-222222222222')

function makeDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('pty pane state', () => {
  beforeEach(() => {
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
    ptyRuntimeState.sshProviders.clear()
    ptyRuntimeState.sshProvidersByGeneration.clear()
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.clearedPtyLifecycleIds.clear()
    ptyRuntimeState.agentSessionOwnerReconciliation = null
    ptyRuntimeState.agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  })

  afterEach(() => {
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
    unregisterSshPtyProvider('ssh-pane-state-race')
    unregisterSshPtyProvider('ssh-pane-state-same-generation')
    unregisterSshPtyProvider('ssh-pane-state-partial-listing')
    unregisterSshPtyProvider('ssh-pane-state-listing-error')
    unregisterSshPtyProvider('ssh-pane-state-addition-anchor')
    unregisterSshPtyProvider('ssh-pane-state-added-during-reconcile')
    ptyRuntimeState.sshProvidersByGeneration.clear()
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.clearedPtyLifecycleIds.clear()
    ptyRuntimeState.agentSessionOwnerReconciliation = null
    ptyRuntimeState.agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  })

  it('removes the old reverse mapping when a PTY is rebound to another pane', () => {
    expect(rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)).toBe(OLD_PANE_KEY)
    expect(rememberPaneKeyForPty(PTY_ID, NEW_PANE_KEY)).toBe(NEW_PANE_KEY)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBe(NEW_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBeUndefined()
    expect(ptyRuntimeState.paneKeyPtyId.get(NEW_PANE_KEY)).toBe(PTY_ID)
  })

  it('keeps the prior PTY forward mapping when another PTY claims its pane', () => {
    const replacementPtyId = 'pty-pane-replacement'
    rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)
    rememberPaneKeyForPty(replacementPtyId, OLD_PANE_KEY)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBe(OLD_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBe(replacementPtyId)
  })

  it('does not let an old SSH provider listing overwrite current ownership or state token', async () => {
    const connectionId = 'ssh-pane-state-race'
    const ptyId = `ssh:${connectionId}@@pty-current`
    const oldInventory = makeDeferred<
      {
        id: string
        incarnationId?: string
        cwd: string
        title: string
        agentSessionOwners?: AgentSessionOwnerBinding[]
      }[]
    >()
    const oldOwner = {
      claim: {
        digestVersion: 1,
        keyId: 'pane-state-race-key',
        identityDigest: 'pane-state-race-digest',
        worktreeScopeDigest: 'pane-state-race-worktree',
        agent: 'codex'
      },
      generation: 'old-owner-generation',
      phase: 'live',
      ptyId,
      surface: {
        worktreeId: 'worktree',
        tabId: 'tab-pane-state-race',
        leafId: '33333333-3333-4333-8333-333333333333',
        terminalHandle: 'term_pane_state_race'
      }
    } as AgentSessionOwnerBinding
    const oldProvider = {
      providerGeneration: 1,
      listProcesses: vi.fn(() => oldInventory.promise)
    }
    const currentProvider = {
      providerGeneration: 2,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn().mockResolvedValue([])
    }
    const currentToken = Symbol(ptyId)

    registerSshPtyProvider(connectionId, oldProvider as never)
    ptyRuntimeState.ptyOwnership.set(ptyId, null)
    ptyRuntimeState.ptyIncarnationById.set(ptyId, 'incarnation-current')
    ptyRuntimeState.ptyStateTokenById.set(ptyId, currentToken)

    const reconciliation = reconcileAgentSessionOwnerListings()
    registerSshPtyProvider(connectionId, currentProvider as never)
    oldInventory.resolve([
      {
        id: ptyId,
        incarnationId: 'incarnation-old',
        cwd: '/old',
        title: 'old',
        agentSessionOwners: [oldOwner]
      }
    ])

    await reconciliation

    expect(ptyRuntimeState.ptyOwnership.get(ptyId)).toBeNull()
    expect(ptyRuntimeState.ptyIncarnationById.get(ptyId)).toBe('incarnation-current')
    expect(ptyRuntimeState.ptyStateTokenById.get(ptyId)).toBe(currentToken)
  })

  it('does not let a same-generation listing overwrite a newer PTY incarnation', async () => {
    const connectionId = 'ssh-pane-state-same-generation'
    const ptyId = `ssh:${connectionId}@@pty-current`
    const inventory = makeDeferred<
      {
        id: string
        incarnationId?: string
        cwd: string
        title: string
        agentSessionOwners?: AgentSessionOwnerBinding[]
      }[]
    >()
    const owner = {
      claim: {
        digestVersion: 1,
        keyId: 'same-generation-key',
        identityDigest: 'same-generation-digest',
        worktreeScopeDigest: 'same-generation-worktree',
        agent: 'codex'
      },
      generation: 'same-generation-owner',
      phase: 'live',
      ptyId,
      surface: {
        worktreeId: 'worktree',
        tabId: 'tab-same-generation',
        leafId: '44444444-4444-4444-8444-444444444444',
        terminalHandle: 'term_same_generation'
      }
    } as AgentSessionOwnerBinding
    const provider = {
      providerGeneration: 7,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn(() => inventory.promise)
    }
    const oldToken = Symbol(ptyId)
    const currentToken = Symbol(ptyId)

    registerSshPtyProvider(connectionId, provider as never)
    ptyRuntimeState.ptyOwnership.set(ptyId, null)
    ptyRuntimeState.ptyIncarnationById.set(ptyId, 'incarnation-old')
    ptyRuntimeState.ptyStateTokenById.set(ptyId, oldToken)

    const reconciliation = reconcileAgentSessionOwnerListings()
    ptyRuntimeState.ptyIncarnationById.set(ptyId, 'incarnation-new')
    ptyRuntimeState.ptyStateTokenById.set(ptyId, currentToken)
    inventory.resolve([
      {
        id: ptyId,
        incarnationId: 'incarnation-old',
        cwd: '/old',
        title: 'old',
        agentSessionOwners: [owner]
      }
    ])

    await reconciliation

    expect(ptyRuntimeState.ptyOwnership.get(ptyId)).toBeNull()
    expect(ptyRuntimeState.ptyIncarnationById.get(ptyId)).toBe('incarnation-new')
    expect(ptyRuntimeState.ptyStateTokenById.get(ptyId)).toBe(currentToken)
  })

  it('keeps a newer live owner when a stale listing row is skipped', async () => {
    const connectionId = 'ssh-pane-state-partial-listing'
    const ptyId = `ssh:${connectionId}@@pty-current`
    const inventory = makeDeferred<
      {
        id: string
        incarnationId?: string
        cwd: string
        title: string
        agentSessionOwners?: AgentSessionOwnerBinding[]
      }[]
    >()
    const owner = {
      claim: {
        digestVersion: 1,
        keyId: 'partial-listing-key',
        identityDigest: 'partial-listing-digest',
        worktreeScopeDigest: 'partial-listing-worktree',
        agent: 'codex'
      },
      generation: 'new-owner-generation',
      phase: 'live',
      ptyId,
      surface: {
        worktreeId: 'worktree',
        tabId: 'tab-partial-listing',
        leafId: '55555555-5555-4555-8555-555555555555',
        terminalHandle: 'term_partial_listing'
      }
    } as AgentSessionOwnerBinding
    const provider = {
      providerGeneration: 8,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn(() => inventory.promise)
    }

    registerSshPtyProvider(connectionId, provider as never)
    ptyRuntimeState.ptyOwnership.set(ptyId, connectionId)
    ptyRuntimeState.ptyIncarnationById.set(ptyId, 'incarnation-old')
    ptyRuntimeState.agentSessionOwners.register(owner)

    const reconciliation = reconcileAgentSessionOwnerListings()
    ptyRuntimeState.ptyIncarnationById.set(ptyId, 'incarnation-new')
    inventory.resolve([
      {
        id: ptyId,
        incarnationId: 'incarnation-old',
        cwd: '/old',
        title: 'old'
      }
    ])

    await reconciliation

    expect(ptyRuntimeState.agentSessionOwners.listForPty(ptyId)).toEqual([owner])
  })

  it('keeps an owner for a provider registered while reconciliation is awaiting listings', async () => {
    const anchorConnectionId = 'ssh-pane-state-addition-anchor'
    const addedConnectionId = 'ssh-pane-state-added-during-reconcile'
    const addedPtyId = `ssh:${addedConnectionId}@@pty-added`
    const anchorInventory = makeDeferred<never[]>()
    const owner = {
      claim: {
        digestVersion: 1,
        keyId: 'provider-addition-key',
        identityDigest: 'provider-addition-digest',
        worktreeScopeDigest: 'provider-addition-worktree',
        agent: 'codex'
      },
      generation: 'provider-addition-owner-generation',
      phase: 'live',
      ptyId: addedPtyId,
      surface: {
        worktreeId: 'worktree',
        tabId: 'tab-provider-addition',
        leafId: '77777777-7777-4777-8777-777777777777',
        terminalHandle: 'term_provider_addition'
      }
    } as AgentSessionOwnerBinding
    const anchorProvider = {
      providerGeneration: 10,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn(() => anchorInventory.promise)
    }
    const addedProvider = {
      providerGeneration: 11,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn().mockResolvedValue([
        {
          id: addedPtyId,
          incarnationId: 'incarnation-added',
          cwd: '/added',
          title: 'added',
          agentSessionOwners: [owner]
        }
      ])
    }

    registerSshPtyProvider(anchorConnectionId, anchorProvider as never)
    ptyRuntimeState.ptyOwnership.set(addedPtyId, addedConnectionId)
    ptyRuntimeState.agentSessionOwners.register(owner)

    const reconciliation = reconcileAgentSessionOwnerListings()
    registerSshPtyProvider(addedConnectionId, addedProvider as never)
    anchorInventory.resolve([])

    await reconciliation

    expect(addedProvider.listProcesses).toHaveBeenCalled()
    expect(ptyRuntimeState.agentSessionOwners.listForPty(addedPtyId)).toEqual([owner])
  })

  it('keeps a live owner when an authoritative provider listing fails', async () => {
    const connectionId = 'ssh-pane-state-listing-error'
    const ptyId = `ssh:${connectionId}@@pty-current`
    const owner = {
      claim: {
        digestVersion: 1,
        keyId: 'listing-error-key',
        identityDigest: 'listing-error-digest',
        worktreeScopeDigest: 'listing-error-worktree',
        agent: 'codex'
      },
      generation: 'listing-error-owner-generation',
      phase: 'live',
      ptyId,
      surface: {
        worktreeId: 'worktree',
        tabId: 'tab-listing-error',
        leafId: '66666666-6666-4666-8666-666666666666',
        terminalHandle: 'term_listing_error'
      }
    } as AgentSessionOwnerBinding
    const provider = {
      providerGeneration: 9,
      providesAgentSessionOwnerListings: () => true,
      listProcesses: vi.fn(async () => {
        throw new Error('provider listing failed')
      })
    }

    registerSshPtyProvider(connectionId, provider as never)
    ptyRuntimeState.ptyOwnership.set(ptyId, connectionId)
    ptyRuntimeState.agentSessionOwners.register(owner)

    await expect(reconcileAgentSessionOwnerListings()).rejects.toThrow('provider listing failed')
    expect(ptyRuntimeState.agentSessionOwners.listForPty(ptyId)).toEqual([owner])
  })
})
