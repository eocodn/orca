import { randomUUID, type CreateWorktreeResult, getRepoExecutionHostId, getProjectHostSetupWorktreeMeta, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, isWindowsAbsolutePathLike, listWorktrees, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, resolveWorktreeSharedDirectories, getWorktreeCreationLayout, mergeWorktree, shouldSetDisplayName, findCreatedWorktree, ownerSurfacing} from './orca-runtime-symbols'
import type { OrcaRuntimeCreateManagedWorktreePart53 } from './orca-runtime-create-managed-worktree-part-53'

type ManagedWorktreeCreateArgs = Parameters<OrcaRuntimeCreateManagedWorktreePart53['createManagedWorktree']>[0]

export async function completeManagedWorktreeCreation(
  runtime: any,
  context: Record<string, any>
): Promise<any> {
  const {
    args,
    repo,
    lineageInput,
    lineageResolution,
    effectiveStartup,
    effectiveStartupFollowup,
    effectiveCreatedWithAgent,
    effectiveDraftPaste,
    settings,
    localWorktreeGitOptions,
    hasLocalWorktreeGitOptions,
    effectiveRequestedName,
    requestedDisplayName,
    effectiveSanitizedName,
    baseBranch,
    branchName,
    checkoutExistingBranch,
    worktreePath,
    remoteTrackingBase,
    sparseDirectories,
    addResult,
    preparedPushTarget,
    configuredPushTarget
  } = context
const gitWorktrees = hasLocalWorktreeGitOptions
  ? await listWorktrees(repo.path, localWorktreeGitOptions)
  : await listWorktrees(repo.path)
// Why: Git may canonicalize a symlinked create path; its exact branch identifies the listed row.
const created = findCreatedWorktree(gitWorktrees, worktreePath, branchName)
if (!created) {
  throw new Error('Worktree created but not found in listing')
}

const worktreeId = `${repo.id}::${created.path}`
const now = Date.now()
// Why: PR/MR-created worktrees can start from a head ref/SHA while Source
// Control must compare against the review target branch.
const metadataBaseRef = args.compareBaseRef ?? remoteTrackingBase?.ref ?? baseBranch
const displayNameMeta = requestedDisplayName
  ? { displayName: requestedDisplayName }
  : shouldSetDisplayName(effectiveRequestedName, branchName, effectiveSanitizedName)
    ? { displayName: effectiveRequestedName }
    : {}
const meta = runtime.store.setWorktreeMeta(worktreeId, {
  // Why: worktree IDs are path-derived. If a path is deleted outside Orca
  // and later recreated, creation must mint a fresh instance identity so
  // stale lineage records tied to the old occupant fail validation.
  instanceId: randomUUID(),
  ...getProjectHostSetupWorktreeMeta(runtime.store.getProjectHostSetups?.() ?? [], repo),
  lastActivityAt: now,
  // See createRemoteWorktree: createdAt grants the new worktree a grace
  // window in Recent sort so ambient PTY bumps in OTHER worktrees can't
  // push it down before the user has had a chance to notice it. Smart-sort
  // uses max(lastActivityAt, createdAt + CREATE_GRACE_MS).
  createdAt: now,
  orcaCreatedAt: now,
  orcaCreationSource: 'runtime',
  orcaCreationWorkspaceLayout: getWorktreeCreationLayout(repo, settings),
  ...displayNameMeta,
  baseRef: metadataBaseRef,
  ...(checkoutExistingBranch ? { preserveBranchOnDelete: true } : {}),
  ...(configuredPushTarget ? { pushTarget: configuredPushTarget } : {}),
  ...(sparseDirectories.length > 0
    ? {
        sparseDirectories,
        sparseBaseRef: metadataBaseRef,
        sparsePresetId: args.sparseCheckout?.presetId
      }
    : {}),
  ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
  ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
  ...(args.linkedLinearIssue !== undefined
    ? { linkedLinearIssue: args.linkedLinearIssue }
    : {}),
  ...(args.linkedLinearIssueWorkspaceId !== undefined
    ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
    : {}),
  ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
    ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
    : {}),
  ...(args.linkedGitLabIssue !== undefined
    ? { linkedGitLabIssue: args.linkedGitLabIssue }
    : {}),
  ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
  ...(args.linkedBitbucketPR !== undefined
    ? { linkedBitbucketPR: args.linkedBitbucketPR }
    : {}),
  ...(args.linkedAzureDevOpsPR !== undefined
    ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
    : {}),
  ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
  ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
  ...(args.linkedTaskSourceContext !== undefined
    ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
    : {}),
  ...(effectiveCreatedWithAgent ? { createdWithAgent: effectiveCreatedWithAgent } : {}),
  ...(args.pendingFirstAgentMessageRename === true && effectiveCreatedWithAgent
    ? { pendingFirstAgentMessageRename: true }
    : {}),
  ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
  ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {}),
  ...(args.comment !== undefined ? { comment: args.comment } : {}),
  ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
  ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {})
})
const worktree = {
  ...mergeWorktree(repo.id, created, meta),
  hostId: meta.hostId ?? getRepoExecutionHostId(repo)
}
const {
  lineage,
  workspaceLineage,
  warnings: lineageWarnings
} = runtime.recordCreatedWorktreeLineage(worktree, lineageResolution)

const symlinkPaths = repo.symlinkPaths ?? []
if (symlinkPaths.length > 0) {
  await createWorktreeLinkedPaths(repo.path, created.path, symlinkPaths)
}

// Why: project-level `orca.yaml` shared directories add to (never replace) the
// per-user setting, so a repo's shared dirs reach every teammate (issue #10451).
const sharedDirectories = await resolveWorktreeSharedDirectories(
  repo.path,
  localWorktreeGitOptions
)
if (sharedDirectories.length > 0) {
  await createWorktreeSharedPaths(repo.path, created.path, sharedDirectories)
}

// Why: project-level `.worktreeinclude` travels with the repo (issue #7549); copy semantics
// (never symlink) so each worktree owns its files. Paths already linked above are skipped.
const worktreeIncludePaths = await resolveWorktreeIncludePaths(
  repo.path,
  localWorktreeGitOptions
)
let includeCopyWarning: string | undefined
if (worktreeIncludePaths.length > 0) {
  const skippedIncludePaths = await createWorktreeCopiedPaths(
    repo.path,
    created.path,
    worktreeIncludePaths
  )
  includeCopyWarning = formatWorktreeIncludeCopyWarning(skippedIncludePaths)
  if (includeCopyWarning) {
    console.warn(`[worktree-include] ${includeCopyWarning}`)
  }
}

let setup: CreateWorktreeResult['setup']
let warning: string | undefined = includeCopyWarning
// Why: CLI-created worktrees do not have a renderer preview to mismatch
// against. Trust is granted by the direct CLI invocation (`--run-hooks`),
// so loading the setup hook from the created worktree is intentional here.
const yamlHooks = loadHooks(worktreePath)
const hooks = getEffectiveHooks(repo, worktreePath)
// Why: setupDecision lets mobile/CLI callers control whether the setup
// script runs. 'skip' suppresses it, 'run' forces it, 'inherit' (default)
// defers to the repo's orca.yaml setupRunPolicy. runHooks === true maps
// to 'run' for backwards compatibility with the desktop create flow.
const effectiveDecision = args.runHooks ? 'run' : (args.setupDecision ?? 'inherit')
let defaultTabs: CreateWorktreeResult['defaultTabs']
try {
  defaultTabs = getDefaultTabsLaunch(yamlHooks, repo, effectiveDecision)
} catch (error) {
  console.warn(`[hooks] default tab commands skipped for ${worktreePath}:`, error)
  defaultTabs = yamlHooks?.defaultTabs
    ? { tabs: yamlHooks.defaultTabs, runCommands: false }
    : undefined
}
const shouldRunSetup = hooks?.scripts.setup && shouldRunSetupForCreate(repo, effectiveDecision)
if (shouldRunSetup && hooks?.scripts.setup) {
  const shouldUseSetupRunner = runtime.authoritativeWindowId !== null || Boolean(effectiveStartup)
  if (shouldUseSetupRunner) {
    try {
      // Why: setup+startup must share the terminal runner path even without
      // a renderer window, so the startup shell can wait on setup completion.
      setup = createSetupRunnerScript(
        repo,
        worktreePath,
        hooks.scripts.setup,
        runtime.getLocalGitExecutionOptionArgs(repo)[0]
      )
    } catch (error) {
      // Why: the git worktree is already real at this point. If runner
      // generation fails, keep creation successful and surface the problem in
      // logs rather than pretending the worktree was never created.
      console.error(`[hooks] Failed to prepare setup runner for ${worktreePath}:`, error)
    }
  } else {
    void runHook(
      'setup',
      worktreePath,
      repo,
      worktreePath,
      runtime.getLocalGitExecutionOptionArgs(repo)[0]
    ).then((result) => {
      if (!result.success) {
        console.error(`[hooks] setup hook failed for ${worktreePath}:`, result.output)
      }
    })
  }
} else if (hooks?.scripts.setup && effectiveDecision !== 'skip') {
  // Runtime RPC calls have no renderer trust prompt, so hooks require explicit CLI opt-in.
  const setupSkipped = `orca.yaml setup hook skipped for ${worktreePath}; pass --setup run to run it.`
  warning = warning ? `${warning} Also ${setupSkipped}` : setupSkipped
  console.warn(`[hooks] ${setupSkipped}`)
}

runtime.invalidateResolvedWorktreeCache()
runtime.invalidateWorktreeScanCacheForRepo(repo.id)
// Why: the filesystem-auth layer maintains a separate cache of registered
// worktree roots used by git IPC handlers (branchCompare, diff, status, etc.)
// to authorize paths. Without invalidating it here, CLI-created worktrees
// are not recognized and all git operations fail with "Access denied:
// unknown repository or worktree path".
invalidateAuthorizedRootsCache()

runtime.notifyWorktreesChanged(repo.id)
const shouldActivate = args.activate === true || args.runHooks === true
let didSpawnStartup = false
// Why: tracks whether runtime itself launched the setup script (via
// provisionManagedWorktreeTerminals). When true, renderer activation and the
// RPC return value must omit setup so the client does not spawn it a second
// time. Mirrors the wait-for-agent setup contract from #6298.
let didSpawnSetup = false
let setupTerminalHandle: string | null = null
let startupTerminalHandle: string | null = null
let startupTerminalTabId: string | null = null
let startupTerminalPaneKey: string | null = null
let startupTerminalPtyId: string | null = null

let sequencedStartup = effectiveStartup
let wrappedSetupCommandStr: string | undefined
if (effectiveStartup && setup?.waitForAgentStartup === true) {
  const platform = getSetupRunnerCommandPlatformForPath(
    setup.runnerScriptPath,
    process.platform === 'win32' ? 'windows' : 'posix'
  )
  const sequenced = createSequencedSetupAgentCommands({
    runnerScriptPath: setup.runnerScriptPath,
    startupCommand: effectiveStartup.command,
    platform
  })
  sequencedStartup = {
    ...effectiveStartup,
    command: sequenced.startupCommand,
    ...(sequenced.startupEnv
      ? { env: { ...effectiveStartup.env, ...sequenced.startupEnv } }
      : {})
  }
  wrappedSetupCommandStr = sequenced.setupCommand
}

if (sequencedStartup && runtime.ptyController?.spawn) {
  try {
    // Why: automation startup must not depend on a renderer TerminalPane
    // mounting. Runtime-spawned PTYs run immediately and the UI adopts the
    // session later, matching `orca terminal create` background semantics.
    const startupTrustAgent = effectiveDraftPaste?.agent ?? effectiveCreatedWithAgent
    if (startupTrustAgent) {
      runtime.markLocalWorkspaceTrustedForAgent(startupTrustAgent, worktreePath)
    }
    const terminal = await runtime.createTerminal(`id:${worktree.id}`, {
      command: sequencedStartup.command,
      ...(setup && effectiveStartup
        ? { claudeAgentTeamsSourceCommand: effectiveStartup.command }
        : {}),
      env: sequencedStartup.env,
      ...(sequencedStartup.launchConfig ? { launchConfig: sequencedStartup.launchConfig } : {}),
      ...(effectiveCreatedWithAgent ? { launchAgent: effectiveCreatedWithAgent } : {}),
      ...(sequencedStartup.viewMode ? { viewMode: sequencedStartup.viewMode } : {}),
      startupCommandDelivery: sequencedStartup.startupCommandDelivery,
      telemetry: sequencedStartup.telemetry,
      ...ownerSurfacing(shouldActivate)
    })
    if (effectiveDraftPaste) {
      runtime.pasteStartupDraftWhenReady(terminal.handle, effectiveDraftPaste)
    }
    if (effectiveStartupFollowup) {
      runtime.sendStartupFollowupWhenReady(terminal.handle, effectiveStartupFollowup)
    }
    didSpawnStartup = true
    startupTerminalHandle = terminal.handle
    startupTerminalTabId = terminal.tabId ?? null
    startupTerminalPaneKey = terminal.paneKey ?? null
    startupTerminalPtyId = terminal.ptyId ?? null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warning = warning
      ? `${warning} Also failed to create the startup terminal for ${worktreePath}: ${message}`
      : `Failed to create the startup terminal for ${worktreePath}: ${message}`
    console.warn(`[worktree-create] ${warning}`)
  }
}
if (shouldActivate) {
  // Why: plain CLI creates should not steal the user's current workspace.
  // Explicit activation and hook-running still use renderer activation so
  // the user can watch prompts/output in a visible pane.
  const runtimeWillProvisionTerminals = didSpawnStartup && Boolean(setup || defaultTabs)
  if (runtimeWillProvisionTerminals) {
    // Why: once runtime spawned the startup PTY, renderer activation may see
    // an existing terminal and skip setup/default tabs. Await provisioning so
    // a failed setup spawn falls back to renderer activation (which still
    // carries the wrapped command for retry); #6298's wait-for-setup
    // guarantee is enforced by the shell marker, not by spawn timing.
    const provisioned = await runtime.provisionManagedWorktreeTerminals({
      worktreeSelector: `id:${worktree.id}`,
      worktreeId: worktree.id,
      worktreePath,
      ...(setup ? { setup } : {}),
      ...(defaultTabs ? { defaultTabs } : {}),
      primaryTerminalHandle: startupTerminalHandle,
      hasStartupTerminal: didSpawnStartup,
      setupCommandPlatform: setup
        ? isWindowsAbsolutePathLike(setup.runnerScriptPath)
          ? 'windows'
          : 'posix'
        : 'posix',
      observeSetupCompletion: args.observeSetupCompletion,
      // Why: carry the wait-for-agent wrapped setup command (#6298) so the
      // Setup tab runs the same script the sequenced agent waits on.
      ...(wrappedSetupCommandStr ? { wrappedSetupCommand: wrappedSetupCommandStr } : {})
    })
    didSpawnSetup = provisioned.setupSpawned
    setupTerminalHandle = provisioned.setupTerminalHandle
  }
  // Why: when runtime spawned setup, omit it from activation. When setup
  // spawn failed, fall through with the wrapped command so renderer
  // activation retries it.
  const activationSetup = didSpawnSetup
    ? undefined
    : setup
      ? {
          ...setup,
          ...(didSpawnStartup && wrappedSetupCommandStr
            ? { command: wrappedSetupCommandStr }
            : {})
        }
      : undefined
  const activationDefaultTabs = runtimeWillProvisionTerminals ? undefined : defaultTabs
  if (effectiveStartup && !didSpawnStartup) {
    runtime.notifyActivateWorktree(
      repo.id,
      worktree.id,
      activationSetup,
      effectiveStartup,
      activationDefaultTabs
    )
  } else {
    runtime.notifyActivateWorktree(
      repo.id,
      worktree.id,
      activationSetup,
      undefined,
      activationDefaultTabs
    )
  }
} else if (runtime.ptyController?.spawn && (setup || defaultTabs || didSpawnStartup)) {
  // Why: inactive terminal materialization matches normal worktree creation,
  // but setup/default tab failures must not gate automation dispatch.
  const provisioning = runtime.provisionManagedWorktreeTerminals({
    worktreeSelector: `id:${worktree.id}`,
    worktreeId: worktree.id,
    worktreePath,
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    primaryTerminalHandle: startupTerminalHandle,
    hasStartupTerminal: didSpawnStartup,
    setupCommandPlatform: setup
      ? isWindowsAbsolutePathLike(setup.runnerScriptPath)
        ? 'windows'
        : 'posix'
      : 'posix',
    observeSetupCompletion: args.observeSetupCompletion,
    ...(wrappedSetupCommandStr ? { wrappedSetupCommand: wrappedSetupCommandStr } : {}),
    surfaceOwner: false
  })
  // Why: runtime owns setup spawning here, so the RPC result must omit setup
  // to keep the headless/mobile caller from launching it a second time.
  if (args.awaitTerminalProvisioning) {
    const provisioned = await provisioning
    didSpawnSetup = provisioned.setupSpawned
    setupTerminalHandle = provisioned.setupTerminalHandle
  } else {
    void provisioning
    if (setup) {
      didSpawnSetup = true
    }
  }
} else if (runtime.ptyController?.spawn) {
  try {
    await runtime.createTerminal(`id:${worktree.id}`, { surfaceOwner: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warning = warning
      ? `${warning} Also failed to create the initial terminal for ${worktreePath}: ${message}`
      : `Failed to create the initial terminal for ${worktreePath}: ${message}`
    console.warn(`[worktree-create] ${warning}`)
  }
}
const returnedSetup = didSpawnSetup
  ? undefined
  : setup
    ? {
        ...setup,
        ...(didSpawnStartup && wrappedSetupCommandStr
          ? { command: wrappedSetupCommandStr }
          : {})
      }
    : undefined
runtime.emitWorktreeLifecycle({
  kind: 'created',
  worktreeId: worktree.id,
  path: worktree.path,
  branch: worktree.branch
})
return {
  worktree: {
    ...worktree,
    parentWorktreeId: lineage?.parentWorktreeId ?? null,
    childWorktreeIds: [],
    lineage,
    workspaceLineage,
    git: created
  },
  ...(lineageInput ? { lineage, workspaceLineage, warnings: lineageWarnings } : {}),
  ...(returnedSetup ? { setup: returnedSetup } : {}),
  ...(args.awaitTerminalProvisioning
    ? {
        setupReceipt: {
          requested: effectiveDecision,
          hookFound: Boolean(hooks?.scripts.setup),
          startupPolicy: setup?.waitForAgentStartup
            ? ('wait-for-setup' as const)
            : ('start-immediately' as const),
          state: !hooks?.scripts.setup
            ? ('not_configured' as const)
            : effectiveDecision === 'skip' || !shouldRunSetup
              ? ('skipped' as const)
              : didSpawnSetup
                ? ('running' as const)
                : ('spawn_failed' as const),
          ...(setupTerminalHandle ? { terminalHandle: setupTerminalHandle } : {})
        }
      }
    : {}),
  ...(defaultTabs ? { defaultTabs } : {}),
  ...(warning ? { warning } : {}),
  ...(addResult.localBaseRefRefresh
    ? { localBaseRefRefresh: addResult.localBaseRefRefresh }
    : {}),
  ...(addResult.localBaseRefUpdateSuggestion
    ? { localBaseRefUpdateSuggestion: addResult.localBaseRefUpdateSuggestion }
    : {}),
  ...(didSpawnStartup && startupTerminalHandle
    ? {
        startupTerminal: {
          spawned: true,
          handle: startupTerminalHandle,
          ...(startupTerminalTabId ? { tabId: startupTerminalTabId } : {}),
          ...(startupTerminalPaneKey ? { paneKey: startupTerminalPaneKey } : {}),
          ...(startupTerminalPtyId ? { ptyId: startupTerminalPtyId } : {}),
          surface: 'background' as const
        }
      }
    : {})
}
}
