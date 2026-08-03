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
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.agentSessionOwnerReconciliation = null
    ptyRuntimeState.agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  })

  afterEach(() => {
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
    unregisterSshPtyProvider('ssh-pane-state-race')
    ptyRuntimeState.sshProvidersByGeneration.clear()
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
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
      Array<{
        id: string
        incarnationId?: string
        cwd: string
        title: string
        agentSessionOwners?: AgentSessionOwnerBinding[]
      }>
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
})
