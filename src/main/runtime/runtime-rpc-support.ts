// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeTransportMetadata } from '../../shared/runtime-bootstrap'
import type { OrcaRuntimeService } from './orca-runtime'



import type { RpcRequest, RpcResponse } from './rpc/core'






import type { DeviceRegistry} from './device-registry';
import { type DeviceScope } from './device-registry'
import type { E2EEKeypair } from './e2ee-keypair'

import type {
  MobileSocketTransportMetadata
} from './rpc/mobile-socket-wiring'
import type { PairingRelay } from '../../shared/mobile-relay-pairing-offer'
import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type {
  MobileRelayMintFailure
} from '../../shared/mobile-relay-mint-failure'
import type {
  RelayDeviceBinding,
  RelayRevokeOutboxItem
} from './relay/relay-revoke-outbox'
import type {
  DeviceCredentialInstalled,
  PairingGetEndpointsParams,
  PairingGetEndpointsResult,
  PairingProvisionRelayParams
} from '../../shared/mobile-relay-credential-contract'




export const DEFAULT_WS_PORT = 6768

export type OrcaRuntimeRpcServerOptions = {
  runtime: OrcaRuntimeService
  userDataPath: string
  pid?: number
  platform?: NodeJS.Platform
  enableWebSocket?: boolean
  wsPort?: number
  // Why: true when the caller pinned a port (`orca serve --port`) so bind order prefers it over a stale STA-1511 fallback (#8535).
  preferPinnedWsPort?: boolean
  webClientRoot?: string
  // Why: test-only overrides for the two constants below; production must not pass these (defaults set by §3.1).
  keepaliveIntervalMs?: number
  longPollCap?: number
  // Why: test-only override for the ownership reclaim cadence.
  metadataOwnershipPollMs?: number
}

export type PairingOfferUnavailableReason =
  | 'websocket_unavailable'
  | 'device_registry_unavailable'
  | 'e2ee_key_unavailable'
  | 'invalid_advertised_endpoint'
  | 'relay_mint_failed'

export type PairingOfferUnavailable = {
  available: false
  reason: PairingOfferUnavailableReason
  guidance: string
  /** Present when an Anywhere mint refused to silently fall back to LAN-only. */
  relayFailure?: MobileRelayMintFailure
}

export type MobilePairingOfferAvailable = {
  available: true
  pairingUrl: string
  endpoint: string
  deviceId: string
  webClientUrl: string | null
  /** Mode the offer actually encodes. */
  connectionMode: MobilePairingConnectionMode
}

export type MobilePairingOffer = PairingOfferUnavailable | MobilePairingOfferAvailable

export type PairingIdentityInitialization =
  | { ok: true; deviceRegistry: DeviceRegistry; e2eeKeypair: E2EEKeypair }
  | { ok: false; failure: PairingOfferUnavailable }

export function pairingUnavailable(
  reason: PairingOfferUnavailableReason,
  guidance: string
): PairingOfferUnavailable {
  return { available: false, reason, guidance }
}

export const DEVICE_REGISTRY_UNAVAILABLE_GUIDANCE =
  'The pairing registry is unavailable. Verify that the Orca data directory is writable.'
export const E2EE_KEY_UNAVAILABLE_GUIDANCE =
  'The E2EE identity is unavailable. Verify that the Orca data directory is writable.'

export type MobileRelayPairingProvider = {
  createPairingRelay(
    relayDeviceId: string
  ): Promise<{ relay: PairingRelay; binding: RelayDeviceBinding }>
  onDeviceRevokeQueued(item: RelayRevokeOutboxItem): void
  onDemandStateChanged?(): void
  getEndpoints(
    context: MobilePairingConnectionContext,
    params: PairingGetEndpointsParams
  ): Promise<PairingGetEndpointsResult>
  provisionRelay(
    context: MobilePairingConnectionContext,
    params: PairingProvisionRelayParams
  ): Promise<DeviceCredentialInstalled>
}

export type MobilePairingConnectionContext = Readonly<{
  deviceId: string
  connectionId: string
  transport: MobileSocketTransportMetadata
}>

// Why: keepalive frames count as socket activity, resetting both idle timers so long-polls outlive the 30s/60s idle caps. See §3.1.
export const KEEPALIVE_INTERVAL_MS = 10_000

// Why: cap long-polls at half the 32-slot connection budget so they can't starve short RPCs; overflow → runtime_busy. See §7 risk #2.
export const LONG_POLL_CAP = 16

export function createWebClientUrl(endpoint: string, pairingUrl: string): string {
  const url = new URL(endpoint)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = webClientPathForEndpoint(url.pathname)
  url.search = ''
  // Why: pairing URLs carry full credentials; the fragment keeps them out of proxy logs and Referer headers.
  url.hash = `pairing=${encodeURIComponent(pairingUrl)}`
  return url.toString()
}

export function webClientPathForEndpoint(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/web-index.html'
  }
  return `${pathname.replace(/\/$/, '')}/web-index.html`
}

export const MOBILE_RPC_METHOD_ALLOWLIST = new Set([
  'accounts.list',
  'accounts.consumeCodexResetCredit',
  'accounts.selectClaude',
  'accounts.selectCodex',
  'accounts.selectCodexForTarget',
  'accounts.subscribe',
  'accounts.unsubscribe',
  'aiVault.listSessions',
  'aiVault.prepareSessionResume',
  'browser.back',
  'browser.dialogAccept',
  'browser.dialogDismiss',
  'browser.forward',
  'browser.goto',
  'browser.keyboardInsertText',
  'browser.keypress',
  'browser.mouseDown',
  'browser.mouseClick',
  'browser.mouseMove',
  'browser.mouseUp',
  'browser.mouseWheel',
  'browser.reload',
  'browser.screencast',
  'browser.screencast.unsubscribe',
  'browser.tabCreate',
  'browser.viewport',
  'clipboard.abortImageUpload',
  'clipboard.appendImageUploadChunk',
  'clipboard.commitImageUpload',
  'clipboard.saveImageAsTempFile',
  'clipboard.startImageUpload',
  'diagnostics.memory',
  'files.browseServerDir',
  'files.createFile',
  'files.list',
  'files.open',
  'files.openDiff',
  'files.read',
  'files.readChunk',
  'files.readDir',
  'files.readPreview',
  'files.readTerminalArtifact',
  'files.readTerminalArtifactPreview',
  'files.resolveTerminalPath',
  'files.searchPaths',
  'files.writeTerminalArtifact',
  'folderWorkspace.list',
  'git.abortMerge',
  'git.abortRebase',
  'git.bulkStage',
  'git.bulkUnstage',
  'git.branchCompare',
  'git.branchDiff',
  'git.cancelGenerateCommitMessage',
  'git.cancelGeneratePullRequestFields',
  'git.checkout',
  'git.commit',
  'git.commitCompare',
  'git.commitDiff',
  'git.discard',
  'git.discoverCommitMessageModels',
  'git.diff',
  'git.fetch',
  'git.forkSync',
  'git.fastForward',
  'git.generateCommitMessage',
  'git.generatePullRequestFields',
  'git.history',
  'git.localBranches',
  'git.pull',
  'git.push',
  'git.rebaseFromBase',
  'git.stage',
  'git.status',
  'git.unstage',
  'git.upstreamStatus',
  'github.createIssue',
  'github.addIssueComment',
  'github.addPRReviewComment',
  'github.addPRReviewCommentReply',
  'github.countWorkItems',
  'github.listAssignableUsers',
  'github.listLabels',
  'github.listWorkItems',
  'github.mergePR',
  'github.setPRAutoMerge',
  'github.requestPRReviewers',
  'github.removePRReviewers',
  'github.project.listAccessible',
  'github.project.listAssignableUsersBySlug',
  'github.project.listIssueTypesBySlug',
  'github.project.listLabelsBySlug',
  'github.project.listViews',
  'github.project.resolveRef',
  'github.project.addIssueCommentBySlug',
  'github.project.updateIssueCommentBySlug',
  'github.project.deleteIssueCommentBySlug',
  'github.project.clearItemField',
  'github.project.updateIssueBySlug',
  'github.project.updateIssueTypeBySlug',
  'github.project.updateItemField',
  'github.project.updatePullRequestBySlug',
  'github.project.viewTable',
  'github.project.workItemDetailsBySlug',
  'github.prForBranch',
  'github.prFileContents',
  'github.prChecks',
  'github.prCheckDetails',
  'github.rerunPRChecks',
  'github.resolveReviewThread',
  'github.setPRFileViewed',
  'github.updateIssue',
  'github.updatePR',
  'github.updatePRTitle',
  'github.updatePRState',
  'github.repoSlug',
  'github.workItem',
  // Cross-repo lookup: lets the mobile Smart picker resolve a pasted github.com URL for a different repo.
  'github.workItemByOwnerRepo',
  'github.workItemDetails',
  'gitlab.createIssue',
  'gitlab.addIssueComment',
  'gitlab.addMRComment',
  'gitlab.listWorkItems',
  // Mobile Smart picker: resolve a pasted GitLab URL to an exact issue/MR (MR listing reuses gitlab.listWorkItems).
  'gitlab.workItemByPath',
  'gitlab.mergeMR',
  'gitlab.resolveMRDiscussion',
  'gitlab.todos',
  'gitlab.updateIssue',
  'gitlab.updateMR',
  'gitlab.updateMRState',
  'gitlab.workItemDetails',
  'host.gitBash.isAvailable',
  'host.platform',
  'host.pwsh.isAvailable',
  'host.wsl.isAvailable',
  'host.wsl.listDistros',
  'hostedReview.create',
  'hostedReview.forBranch',
  'hostedReview.getCreationEligibility',
  'linear.getCustomView',
  'linear.getIssue',
  'linear.getProject',
  'linear.agentSearchIssues',
  'linear.issueContext',
  'linear.resolveCurrentIssue',
  'linear.addIssueComment',
  'linear.connect',
  'linear.createIssue',
  'linear.createProject',
  'linear.issueComments',
  'linear.listCustomViewIssues',
  'linear.listCustomViewProjects',
  'linear.listCustomViews',
  'linear.listIssues',
  'linear.mcpListIssues',
  'linear.listProjectIssues',
  'linear.listProjects',
  'linear.teamLabels',
  'linear.teamMembers',
  'linear.listTeams',
  'linear.searchIssues',
  'linear.selectWorkspace',
  'linear.status',
  'linear.teamStates',
  'linear.updateIssue',
  'markdown.readTab',
  'markdown.saveTab',
  'notifications.getMissedSince',
  'notifications.subscribe',
  'notifications.unsubscribe',
  'pairing.getEndpoints',
  'pairing.provisionRelay',
  'preflight.check',
  'preflight.detectAgents',
  'preflight.detectRemoteAgents',
  'projectGroup.list',
  'repo.baseRefDefault',
  'repo.gitAvailable',
  'repo.hooks',
  'repo.list',
  'repo.saveSparsePreset',
  'repo.searchRefs',
  'repo.sparsePresets',
  'repo.update',
  'runtime.clientEvents.subscribe',
  'runtime.clientEvents.unsubscribe',
  'session.tabs.activate',
  'session.tabs.close',
  'session.tabs.closeLifecycle',
  'session.tabs.createTerminal',
  'session.tabs.list',
  'session.tabs.listAll',
  'session.tabs.move',
  'session.tabs.subscribe',
  'session.tabs.subscribeAll',
  'session.tabs.unsubscribe',
  'session.tabs.unsubscribeAll',
  'settings.get',
  'settings.getTerminalQuickCommands',
  'settings.update',
  'settings.updateTerminalQuickCommands',
  'ssh.connect',
  'ssh.getState',
  'ssh.listRemovedTargetLabels',
  'ssh.listTargets',
  'ssh.listTargetSummaries',
  'speech.dictation.cancel',
  'speech.dictation.chunk',
  'speech.dictation.finish',
  'speech.dictation.setup',
  'speech.dictation.start',
  'speech.models.delete',
  'speech.models.download',
  'speech.models.list',
  'stats.summary',
  'status.get',
  'agentTeams.prepareLaunch',
  'agentTeams.tmuxCompat',
  'terminal.clearBuffer',
  'terminal.close',
  'terminal.closeTab',
  'terminal.create',
  'terminal.createAgentSession',
  'terminal.ensureAgentSession',
  'terminal.focus',
  'terminal.agentStatus',
  'terminal.adoptOrphans',
  'terminal.getAutoRestoreFit',
  'terminal.isRunningAgent',
  'terminal.list',
  'terminal.multiplex',
  'terminal.read',
  'terminal.rename',
  'terminal.send',
  'terminal.setAutoRestoreFit',
  'terminal.setDisplayMode',
  'terminal.subscribe',
  'terminal.unsubscribe',
  'terminal.updateViewport',
  'terminal.wait',
  'ui.get',
  'ui.recordFeatureInteraction',
  'ui.set',
  'worktree.activate',
  'worktree.create',
  'worktree.forceDeleteBranch',
  'worktree.prefetchCreateBase',
  'worktree.ps',
  'worktree.show',
  'worktree.resolveMrBase',
  'worktree.resolvePrBase',
  'worktree.rm',
  'worktree.set',
  'worktree.sleep'
])

export type LongPollClass = 'wait'

// Why: single classifier for long-poll requests (handlers that block on an external event), shared by counter/abort/keepalive. See §3.1.
export function longPollClassOf(request: RpcRequest): LongPollClass | null {
  if (request.method === 'terminal.wait') {
    return 'wait'
  }
  return null
}

// Why: status.get has no per-connection context in the dispatcher, so stamp the scope here at the transport boundary.
export function injectDeviceScope(response: string, scope: DeviceScope): string {
  try {
    const parsed = JSON.parse(response) as RpcResponse
    if (parsed.ok !== true || typeof parsed.result !== 'object' || parsed.result === null) {
      return response
    }
    ;(parsed.result as Record<string, unknown>).deviceScope = scope
    return JSON.stringify(parsed)
  } catch {
    return response
  }
}

/** Why: keep stale socket cleanup and endpoint naming together as one transport contract. */
export const RUNTIME_SOCKET_NAME_REGEX = /^o-(\d+)-[A-Za-z0-9_-]+\.sock$/

export function sweepOrphanedRuntimeSockets(userDataPath: string, ownPid: number): void {
  let entries: string[]
  try {
    entries = readdirSync(userDataPath)
  } catch {
    return
  }
  for (const entry of entries) {
    const match = RUNTIME_SOCKET_NAME_REGEX.exec(entry)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    if (!Number.isFinite(pid) || pid === ownPid) {
      continue
    }
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        try {
          rmSync(join(userDataPath, entry), { force: true })
        } catch {
          // A later start or reboot can clean an unremovable stale socket.
        }
      }
    }
  }
}

export function createRuntimeTransportMetadata(
  userDataPath: string,
  pid: number,
  platform: NodeJS.Platform,
  runtimeId = 'runtime'
): RuntimeTransportMetadata {
  const endpointSuffix = runtimeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 4) || 'rt'
  if (platform === 'win32') {
    return {
      kind: 'named-pipe',
      endpoint: `\\\\.\\pipe\\orca-${pid}-${endpointSuffix}`
    }
  }
  return {
    kind: 'unix',
    endpoint: join(userDataPath, `o-${pid}-${endpointSuffix}.sock`)
  }
}
