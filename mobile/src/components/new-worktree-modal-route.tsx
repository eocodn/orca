import { useState, useEffect, useMemo, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { useNewWorktreeDrawerNavigation } from './use-new-worktree-drawer-navigation'
import { getSuggestedCreatureName } from './worktree-name-suggestion'
import { deriveWorkspaceSshGate, workspaceSshStatusLabel } from '../tasks/workspace-ssh-gate'
import {
  isSetupHookTrusted,
  normalizeSetupHookTrust,
  persistSetupHookTrustApproval,
  wasSetupHookPreviouslyApproved,
  type SetupHookTrust
} from '../tasks/setup-hook-trust'
import { isMobileTuiAgentEnabled } from '../tasks/mobile-tui-agents'
import type { PersistedTrustedOrcaHooks, TuiAgent } from '../../../src/shared/types'
import type { SshConnectionState } from '../../../src/shared/ssh-types'
import {
  NEW_WORKTREE_AGENT_OPTIONS as AGENT_OPTIONS,
  NEW_WORKTREE_BLANK_AGENT as BLANK_TERMINAL,
  pickPreferredNewWorktreeAgent,
  resolveNewWorktreeAgentSelection,
  type NewWorktreeAgentOption as AgentOption
} from './new-worktree-agent-selection'
import { getCachedRepos, setCachedRepos } from '../cache/repo-cache'
import { useLastVisitedWorktreeRepoId } from '../worktree/use-last-visited-worktree-repo'
import {
  getMobileNewWorkspaceDialogEligibleRepos,
  refreshMobileNewWorkspaceDialogSelectedRepo,
  resolveMobileNewWorkspaceDialogRepoId
} from '../worktree/new-workspace-dialog-repo-selection'
import { createBlankWorkspace } from '../tasks/blank-workspace-create'
import { createWorkspaceFromComposerSource } from '../tasks/source-workspace-create'
import { useNewWorktreeRuntimeCapabilities } from '../tasks/worktree-create-capability'
import { normalizeWorkspaceAgent } from '../tasks/workspace-agent-selection'
import {
  filterAvailableTaskProviders,
  normalizeVisibleTaskProviders,
  type TaskProvider
} from '../tasks/mobile-task-providers'
import { useMobileComposerSource } from '../tasks/use-mobile-composer-source'
import type { SmartModeAvailabilityInput } from '../tasks/mobile-smart-source-modes'
import { deriveRepoSlug, type PasteRepoCandidate } from '../tasks/smart-source-paste-intent'
import { getComposerRepoWorktreeBranches } from '../../../src/shared/composer-branch-selection'
import type { SetupTrustPrompt } from './SetupHookTrustDrawer'
import { NewWorktreeModalView } from './NewWorktreeModalView'
import { useNewWorktreeRepoSelection } from './use-new-worktree-repo-selection'
import { useNewWorktreeSetupTrustActions } from './use-new-worktree-setup-trust'
import {
  repoBadgeColor,
  type CreateOptions,
  type DetectedAgentIdsState,
  type Props,
  type Repo,
  type RepoHooksResponse,
  type RuntimeSettings,
  type SetupDecision,
  type SetupHookDetails,
  type SetupRunPolicy
} from './new-worktree-modal-contract'

// ── Main modal ──────────────────────────────────────────────────────

export function NewWorktreeModalContent({
  visible,
  client,
  hostId,
  existingWorktreePaths,
  existingWorktrees,
  onCreated,
  onClose
}: Props) {
  const [initialRepos] = useState(() => (hostId ? (getCachedRepos(hostId) as Repo[] | null) : null))
  const [repos, setRepos] = useState<Repo[]>(initialRepos ?? [])
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const { drawerView, formSheetVisible, formSheetInteractive, transitionDrawer, openSourceDrawer } =
    useNewWorktreeDrawerNavigation(visible)
  const createInFlightRef = useRef(false)
  const setupTrustActionInFlightRef = useRef(false)
  const [selectedAgentState, setSelectedAgent] = useState<AgentOption>(AGENT_OPTIONS[0]!)
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null)
  const [detectedAgentIdsState, setDetectedAgentIdsState] = useState<DetectedAgentIdsState | null>(
    null
  )
  const [agentOverriddenState, setAgentOverridden] = useState(false)
  const [sshState, setSshState] = useState<SshConnectionState | null>(null)
  const [sshConnectingTargetId, setSshConnectingTargetId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [availableProviders, setAvailableProviders] = useState<TaskProvider[]>([])
  const { tasksSupported, getWorktreeCreateCutoverSupport } = useNewWorktreeRuntimeCapabilities(
    client,
    visible
  )
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [setupHookDetails, setSetupHookDetails] = useState<SetupHookDetails | null>(null)
  const [trustedOrcaHooks, setTrustedOrcaHooks] = useState<PersistedTrustedOrcaHooks>({})
  const [setupTrustPrompt, setSetupTrustPrompt] = useState<SetupTrustPrompt | null>(null)
  const [setupDecisionChoice, setSetupDecisionChoice] = useState<Exclude<
    SetupDecision,
    'inherit'
  > | null>(null)
  const [runSetup, setRunSetup] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(initialRepos == null)
  const lastVisitedRepo = useLastVisitedWorktreeRepoId(hostId, visible)
  const selectedRepoWorktreeBranches = useMemo(
    () => getComposerRepoWorktreeBranches(existingWorktrees ?? [], selectedRepo?.id ?? null),
    [existingWorktrees, selectedRepo]
  )

  const composer = useMobileComposerSource({
    client,
    selectedRepoId: selectedRepo?.id ?? null,
    worktreeBranches: selectedRepoWorktreeBranches,
    onError: setError
  })

  const selectedRepoConnectionId = selectedRepo?.connectionId ?? null
  const sshGate = deriveWorkspaceSshGate({
    connectionId: selectedRepoConnectionId,
    state: sshState,
    connecting: sshConnectingTargetId === selectedRepoConnectionId
  })
  const detectedAgentIds =
    detectedAgentIdsState?.connectionId === selectedRepoConnectionId &&
    (selectedRepoConnectionId === null || sshGate.status === 'connected')
      ? detectedAgentIdsState.ids
      : null
  const activeSetupHookDetails =
    selectedRepo && setupHookDetails?.repoId === selectedRepo.id ? setupHookDetails : null
  const setupCommand = activeSetupHookDetails?.command ?? null
  const setupSource = activeSetupHookDetails?.source ?? null
  const setupTrust = activeSetupHookDetails?.trust ?? null
  const setupRunPolicy = activeSetupHookDetails?.runPolicy ?? 'run-by-default'
  const selectedAgentResolution = resolveNewWorktreeAgentSelection({
    visible,
    selectedAgent: selectedAgentState,
    agentOverridden: agentOverriddenState,
    runtimeSettings,
    detectedAgentIds
  })
  // Why: agent preference repair is pure render dataflow; doing it here
  // avoids a stale selected-agent commit while preserving user overrides.
  if (
    selectedAgentState.id !== selectedAgentResolution.selectedAgent.id ||
    agentOverriddenState !== selectedAgentResolution.agentOverridden
  ) {
    setSelectedAgent(selectedAgentResolution.selectedAgent)
    setAgentOverridden(selectedAgentResolution.agentOverridden)
  }
  const selectedAgent = selectedAgentResolution.selectedAgent

  const selectedRepoIsGit = selectedRepo ? selectedRepo.kind !== 'folder' : true
  const sourceAvailability: SmartModeAvailabilityInput = {
    textOnly: selectedRepo != null && !selectedRepoIsGit,
    tasksSupported,
    hasRepo: selectedRepo != null,
    githubAvailable: availableProviders.includes('github'),
    gitlabAvailable: availableProviders.includes('gitlab'),
    linearAvailable: availableProviders.includes('linear')
  }
  const pasteRepos = useMemo<PasteRepoCandidate[]>(
    () =>
      repos.map((repo) => ({
        id: repo.id,
        displayName: repo.displayName,
        slug: deriveRepoSlug(repo)
      })),
    [repos]
  )

  useEffect(() => {
    if (!visible || !lastVisitedRepo.loaded || selectedRepo || repos.length === 0) {
      return
    }
    const eligibleRepos = getMobileNewWorkspaceDialogEligibleRepos(repos)
    const preferredRepoId = resolveMobileNewWorkspaceDialogRepoId({
      eligibleRepos,
      activeRepoId: lastVisitedRepo.repoId
    })
    const preferredRepo = repos.find((repo) => repo.id === preferredRepoId) ?? null
    if (preferredRepo) {
      setSelectedRepo(preferredRepo)
    }
  }, [lastVisitedRepo.loaded, lastVisitedRepo.repoId, repos, selectedRepo, visible])

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    let stale = false

    if (repos.length === 0) {
      setLoading(true)
    }

    void client
      .sendRequest('repo.list')
      .then((repoResponse) => {
        if (stale) {
          return
        }
        if (repoResponse.ok) {
          const result = (repoResponse as RpcSuccess).result as { repos: Repo[] }
          setRepos(result.repos)
          if (hostId) {
            setCachedRepos(hostId, result.repos)
          }
          setSelectedRepo((current) => {
            // Why: the optimistic cache can include repos removed before the
            // fresh repo.list returns; never create against a stale repo id.
            return refreshMobileNewWorkspaceDialogSelectedRepo(result.repos, current)
          })
        }
      })
      .catch(() => {
        if (!stale) {
          setRepos([])
        }
      })
      .finally(() => {
        if (!stale) {
          setLoading(false)
        }
      })

    void (async () => {
      // Why: settle each RPC independently so a flaky availability probe (e.g. a
      // linear.status timeout, which rejects rather than resolving {ok:false})
      // can't discard the already-resolved critical settings/ui results.
      const probes = Promise.allSettled([
        client.sendRequest('preflight.check'),
        client.sendRequest('linear.status')
      ])
      const okResult = (entry: PromiseSettledResult<RpcResponse>): RpcSuccess | null =>
        entry.status === 'fulfilled' && entry.value.ok ? (entry.value as RpcSuccess) : null
      // Why: hydrate settings/trust the moment their own RPCs settle — gating them
      // on the probes (a first-open preflight.check can take seconds) widens the
      // window where an already-trusted setup hook spuriously re-prompts on create.
      const [settingsRes, uiRes] = await Promise.allSettled([
        client.sendRequest('settings.get'),
        client.sendRequest('ui.get')
      ])
      if (stale) {
        return
      }

      const settingsResult = okResult(settingsRes)
      const settingsValue = settingsResult
        ? (
            settingsResult.result as {
              settings: RuntimeSettings & { visibleTaskProviders?: unknown }
            }
          ).settings
        : null
      if (settingsValue) {
        setRuntimeSettings(settingsValue)
      }
      const uiResult = okResult(uiRes)
      if (uiResult) {
        const ui = (uiResult.result as { ui?: { trustedOrcaHooks?: PersistedTrustedOrcaHooks } }).ui
        setTrustedOrcaHooks(ui?.trustedOrcaHooks ?? {})
      }

      const [preflightRes, linearRes] = await probes
      if (stale) {
        return
      }
      const glabInstalled =
        (okResult(preflightRes)?.result as { glab?: { installed?: boolean } } | undefined)?.glab
          ?.installed === true
      const linearConnected =
        (okResult(linearRes)?.result as { connected?: boolean } | undefined)?.connected === true
      const visibleProviders = normalizeVisibleTaskProviders(settingsValue?.visibleTaskProviders)
      setAvailableProviders(
        // Drop filterAvailableTaskProviders' forced 'github' fallback when the user
        // hid GitHub; the Branch tab always guarantees at least one tab remains.
        filterAvailableTaskProviders(visibleProviders, {
          gitlabInstalled: glabInstalled,
          linearConnected
        }).filter((provider) => visibleProviders.includes(provider))
      )
    })()
    return () => {
      stale = true
    }
  }, [visible, client, hostId])

  useEffect(() => {
    if (!visible || !client || !selectedRepoConnectionId) {
      return
    }
    let stale = false
    void client
      .sendRequest('ssh.getState', { targetId: selectedRepoConnectionId })
      .then((response) => {
        if (stale) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error.message)
        }
        const state = (response as RpcSuccess).result as { state?: SshConnectionState | null }
        setSshState(
          state.state ?? {
            targetId: selectedRepoConnectionId,
            status: 'disconnected',
            error: null,
            reconnectAttempt: 0
          }
        )
      })
      .catch((err) => {
        if (!stale) {
          setSshState({
            targetId: selectedRepoConnectionId,
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to read SSH connection state.',
            reconnectAttempt: 0
          })
        }
      })
    return () => {
      stale = true
    }
  }, [client, selectedRepoConnectionId, visible])

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    if (selectedRepoConnectionId && sshGate.status !== 'connected') {
      return
    }
    let stale = false
    void (async () => {
      try {
        const response = selectedRepoConnectionId
          ? await client.sendRequest('preflight.detectRemoteAgents', {
              connectionId: selectedRepoConnectionId
            })
          : await client.sendRequest('preflight.detectAgents')
        if (stale) {
          return
        }
        setDetectedAgentIdsState({
          connectionId: selectedRepoConnectionId,
          ids: response.ok ? new Set((response as RpcSuccess).result as string[]) : new Set()
        })
      } catch {
        if (!stale) {
          setDetectedAgentIdsState({ connectionId: selectedRepoConnectionId, ids: new Set() })
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [client, selectedRepoConnectionId, sshGate.status, visible])

  useEffect(() => {
    if (!client || !selectedRepo) {
      return
    }
    let stale = false
    void (async () => {
      try {
        const response = await client.sendRequest('repo.hooks', {
          repo: `id:${selectedRepo.id}`
        })
        if (stale) {
          return
        }
        if (response.ok) {
          const result = (response as RpcSuccess).result as RepoHooksResponse
          const cmd = result.hooks?.scripts?.setup?.trim() || null
          const policy = result.setupRunPolicy ?? 'run-by-default'
          setSetupHookDetails({
            repoId: selectedRepo.id,
            command: cmd,
            source: result.source,
            trust: normalizeSetupHookTrust(result.setupTrust),
            runPolicy: policy
          })
          setSetupDecisionChoice(null)
          setRunSetup(policy !== 'skip-by-default')
          if (cmd && policy === 'ask') {
            setShowAdvanced(true)
          }
        }
      } catch {
        if (!stale) {
          setSetupHookDetails({
            repoId: selectedRepo.id,
            command: null,
            source: null,
            trust: null,
            runPolicy: 'run-by-default'
          })
          setSetupDecisionChoice(null)
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [client, selectedRepo])

  async function connectSelectedSshRepo(): Promise<void> {
    if (!client || !selectedRepoConnectionId) {
      return
    }
    setSshConnectingTargetId(selectedRepoConnectionId)
    setSshState({
      targetId: selectedRepoConnectionId,
      status: 'connecting',
      error: null,
      reconnectAttempt: 0
    })
    try {
      const response = await client.sendRequest(
        'ssh.connect',
        { targetId: selectedRepoConnectionId },
        { timeoutMs: 120_000 }
      )
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      const result = (response as RpcSuccess).result as { state?: SshConnectionState | null }
      setSshState(
        result.state ?? {
          targetId: selectedRepoConnectionId,
          status: 'connected',
          error: null,
          reconnectAttempt: 0
        }
      )
    } catch (err) {
      setSshState({
        targetId: selectedRepoConnectionId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to connect to SSH repository.',
        reconnectAttempt: 0
      })
    } finally {
      setSshConnectingTargetId((current) => (current === selectedRepoConnectionId ? null : current))
    }
  }

  async function handleCreate(options: CreateOptions = {}) {
    if (!client || !selectedRepo || createInFlightRef.current) {
      return
    }
    createInFlightRef.current = true
    setCreating(true)
    setError('')

    try {
      if (sshGate.requiresConnection) {
        setError(`Connect ${selectedRepo.displayName} before creating a workspace.`)
        return
      }
      let latestRuntimeSettings = runtimeSettings
      try {
        const settingsResponse = await client.sendRequest('settings.get')
        if (settingsResponse.ok) {
          const result = (settingsResponse as RpcSuccess).result as { settings: RuntimeSettings }
          latestRuntimeSettings = result.settings
          setRuntimeSettings(result.settings)
        }
      } catch {
        // Best-effort refresh; the runtime validates the same setting before spawning.
      }
      if (
        selectedAgent.id !== '__blank__' &&
        !isMobileTuiAgentEnabled(selectedAgent.id, latestRuntimeSettings?.disabledTuiAgents)
      ) {
        setSelectedAgent(pickPreferredNewWorktreeAgent(latestRuntimeSettings, detectedAgentIds))
        setAgentOverridden(false)
        setError('Selected agent is disabled. Choose an enabled agent before creating.')
        return
      }

      // Why: blank name field — match desktop behavior by computing the
      // next available marine-creature name at submit time and passing it
      // to the server. The server's worktree.create rejects empty/invalid
      // names, so we must generate one client-side rather than letting the
      // server invent one. The pre-flight basename dedupe is only a hint;
      // the authoritative collision is checked server-side against git
      // branches/remotes/PRs, so we also retry-with-suffix on conflict.
      const trimmedName = composer.name.trim()
      const baseName = trimmedName || getSuggestedCreatureName(existingWorktreePaths ?? [])

      let setupDecision: SetupDecision = 'inherit'
      if (setupCommand) {
        if (options.setupOverride) {
          setupDecision = options.setupOverride
        } else if (setupRunPolicy === 'ask') {
          if (!setupDecisionChoice) {
            setError('Choose whether to run the setup script.')
            return
          }
          setupDecision = setupDecisionChoice
        } else {
          setupDecision = runSetup ? 'run' : 'skip'
        }
      }
      if (
        setupDecision === 'run' &&
        setupTrust &&
        setupTrust.contentHash !== options.approvedSetupContentHash &&
        !isSetupHookTrusted(trustedOrcaHooks, selectedRepo.id, setupTrust.contentHash)
      ) {
        // Why: desktop prompts before running repo-owned orca.yaml setup hooks.
        // Mobile stores the same trust hash so approvals carry across surfaces.
        setSetupTrustPrompt({
          repoId: selectedRepo.id,
          repoName: selectedRepo.displayName,
          scriptContent: setupTrust.scriptContent,
          contentHash: setupTrust.contentHash,
          previouslyApproved: wasSetupHookPreviouslyApproved(trustedOrcaHooks, selectedRepo.id)
        })
        transitionDrawer('trust')
        return
      }

      const createdWithAgentId = selectedAgent.id !== '__blank__' ? selectedAgent.id : undefined
      const trimmedNote = note.trim() || undefined
      const createSelection = composer.createSelection
      const result = createSelection
        ? await createWorkspaceFromComposerSource({
            client,
            selection: createSelection,
            targetRepoId: selectedRepo.id,
            setupDecision,
            agent: { choice: normalizeWorkspaceAgent(selectedAgent.id) ?? 'blank' },
            workspaceName: trimmedName || undefined,
            note: trimmedNote,
            nameIsAutoManaged: composer.isNameAutoManaged,
            supportsIdempotentCutoverRetry: getWorktreeCreateCutoverSupport()
          })
        : await createBlankWorkspace({
            client,
            repoId: selectedRepo.id,
            baseName,
            createdWithAgentId,
            comment: trimmedNote,
            setupDecision,
            supportsIdempotentCutoverRetry: getWorktreeCreateCutoverSupport()
          })
      if ('error' in result) {
        setError(result.error)
        return
      }
      onClose()
      onCreated(result.worktreeId, result.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace')
    } finally {
      createInFlightRef.current = false
      setCreating(false)
    }
  }

  const needsSetupChoice = Boolean(setupCommand) && setupRunPolicy === 'ask'
  const canCreate =
    selectedRepo != null &&
    !creating &&
    !sshGate.requiresConnection &&
    (!needsSetupChoice || setupDecisionChoice != null)
  const { pickerAgentOptions, repoPickerItems, prepareSelectionPickerOpen, handleRepoSelected } = useNewWorktreeRepoSelection({
    repos,
    selectedRepo,
    setSelectedRepo,
    composer,
    detectedAgentIds,
    runtimeSettings
  })

  const { approveSetupTrust, closeSetupTrust, skipSetupTrust } = useNewWorktreeSetupTrustActions({
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
  })

  return <NewWorktreeModalView {...{visible, drawerView, onClose, closeSetupTrust, transitionDrawer, formSheetVisible, formSheetInteractive, loading, repos, selectedRepo, repoBadgeColor, prepareSelectionPickerOpen, composer, selectedRepoIsGit, sshGate, setError, openSourceDrawer, selectedRepoConnectionId, workspaceSshStatusLabel, connectSelectedSshRepo, selectedAgent, setShowAdvanced, showAdvanced, note, setNote, setupCommand, setupSource, setupRunPolicy, setupDecisionChoice, setSetupDecisionChoice, runSetup, setRunSetup, canCreate, handleCreate, creating, sourceAvailability, client, pasteRepos, repoPickerItems, handleRepoSelected, pickerAgentOptions, setAgentOverridden, setSelectedAgent, setupTrustPrompt, approveSetupTrust, skipSetupTrust}} />

