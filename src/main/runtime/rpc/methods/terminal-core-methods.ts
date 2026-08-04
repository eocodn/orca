
import { TERMINAL_DISPLAY_MODE_METHODS } from './terminal-display-mode-methods'

import {
  InvalidArgumentError,
  defineMethod,
  type RpcAnyMethod
} from '../core'









import { isTerminalQueryReply } from '../../../../shared/terminal-query-reply'


import { assertTerminalAgentSendable } from '../terminal-agent-send-guard'
import {
  navigationTargetsHost,
  resolveRuntimeNavigationTarget
} from '../../../../shared/runtime-navigation'








import type {
  MobileInputFloorClaimHolder} from './terminal-stream-state';
import {
  assertTerminalSendTextWithinLimit,
  isTerminalInputLockedForClient,
  resolveMobileFloorClientId,
  commitMobileInputFloorClaim,
  getTerminalSendGuardRefusedReason,
  isTerminalSendGuardNotWritable,
  assertTerminalSendExactPtyBinding
} from './terminal-stream-state'
import { updateViewportForClient } from './terminal-snapshot-support'
import {
  TerminalHandle,
  TerminalFocus,
  TerminalListParams,
  TerminalResolveActive,
  TerminalResolvePane,
  TerminalRecoverPane,
  TerminalRead,
  TerminalResize,
  TerminalRename,
  TerminalSend,
  TerminalWait,
  TerminalCreateParams,
  TerminalSplit,
  TerminalStop,
  TerminalSleep,
  TerminalStopExact,
  AgentTeamsTmuxCompat,
  AgentTeamsPrepareLaunch,
  TerminalResizeForClient
} from './terminal-schemas'

export const TERMINAL_CORE_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'terminal.list',
    params: TerminalListParams,
    handler: async (params, { runtime }) =>
      runtime.listTerminals(params.worktree, params.limit, {
        handles: params.handles,
        requireFreshPtyLiveness: params.requireFreshPtyLiveness
      })
  }),
  defineMethod({
    name: 'terminal.resolveActive',
    params: TerminalResolveActive,
    handler: async (params, { runtime }) => ({
      handle: await runtime.resolveActiveTerminal(params.worktree)
    })
  }),
  defineMethod({
    name: 'terminal.resolvePane',
    params: TerminalResolvePane,
    handler: async (params, { runtime }) => ({
      terminal: runtime.resolveTerminalPane(params.paneKey, params.worktreeId)
    })
  }),
  defineMethod({
    name: 'terminal.recoverPane',
    params: TerminalRecoverPane,
    handler: async (params, { runtime }) => ({
      terminal: await runtime.recoverTerminalPane(
        params.paneKey,
        params.worktreeId,
        params.expectedTerminal
      )
    })
  }),
  defineMethod({
    name: 'terminal.show',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      terminal: await runtime.showTerminal(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.inspect',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      terminal: await runtime.inspectTerminal(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.resize',
    params: TerminalResize,
    handler: async (params, { runtime }) => ({
      resize: await runtime.resizeTerminal(
        params.terminal,
        params.incarnation,
        params.cols,
        params.rows
      )
    })
  }),
  defineMethod({
    name: 'terminal.read',
    params: TerminalRead,
    handler: async (params, { runtime }) => ({
      terminal: await runtime.readTerminal(params.terminal, {
        cursor: params.cursor,
        limit: params.limit
      })
    })
  }),
  defineMethod({
    name: 'terminal.inspectProcess',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      process: await runtime.inspectTerminalProcess(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.isRunningAgent',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      isRunningAgent: await runtime.isTerminalRunningAgent(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.agentStatus',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      agentStatus: await runtime.getTerminalAgentStatus(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.rename',
    params: TerminalRename,
    handler: async (params, { runtime }) => ({
      rename: await runtime.renameTerminal(params.terminal, params.title || null)
    })
  }),
  defineMethod({
    name: 'terminal.clearBuffer',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      clear: await runtime.clearTerminalBuffer(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.send',
    params: TerminalSend,
    handler: async (params, { runtime, clientId }) => {
      await assertTerminalSendTextWithinLimit(params.text)
      await assertTerminalSendTextWithinLimit(params.resolvedLaunchDraft?.text)
      const queryReplyClientId = clientId ?? params.client?.id
      if (
        params.inputKind === 'query-reply' &&
        (!params.text ||
          !isTerminalQueryReply(params.text) ||
          params.enter === true ||
          params.interrupt === true ||
          params.requireAgentStatus !== undefined ||
          params.client?.type !== 'mobile' ||
          !queryReplyClientId ||
          (clientId !== undefined && params.client.id !== clientId))
      ) {
        throw new InvalidArgumentError('Invalid terminal query reply')
      }
      // Why: a stale handle must fail with terminal_handle_stale, not evaluate driver/lock state against the wrong PTY (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      const driver = leaf?.ptyId ? runtime.getDriver(leaf.ptyId) : null
      if (
        params.inputKind === 'query-reply' &&
        leaf?.ptyId &&
        !runtime.isMobileTerminalQueryReplyAuthority(leaf.ptyId, queryReplyClientId!)
      ) {
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      if (leaf?.ptyId && isTerminalInputLockedForClient(runtime, leaf.ptyId, params.client)) {
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      if (
        leaf?.ptyId &&
        params.client?.type === 'desktop' &&
        params.claimViewport === true &&
        params.viewport
      ) {
        const claim = await updateViewportForClient(
          runtime,
          leaf.ptyId,
          `send:${params.client.id}`,
          params.client,
          params.viewport,
          'desktop',
          'refresh',
          true
        )
        // Why: a stream-less request can't safely create ownership, so never write at stale geometry.
        if (!claim.updated || isTerminalInputLockedForClient(runtime, leaf.ptyId, params.client)) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0
            }
          }
        }
      }
      const hasText = typeof params.text === 'string' && params.text.length > 0
      const hasSuffix = params.enter === true || params.interrupt === true
      if (params.requireAgentStatus === 'sendable' && hasText && hasSuffix) {
        // Why: guarded sends are two-phase; reject combined payload + submit so a guard flip can't cause partial delivery.
        return {
          send: {
            handle: params.terminal,
            accepted: false,
            bytesWritten: 0
          }
        }
      }
      // Why: recheck permission/no-agent state immediately before accepting the PTY write.
      const assertSendPreconditions =
        params.requireAgentStatus === 'sendable'
          ? async (ptyId?: string): Promise<void> => {
              await assertTerminalAgentSendable({
                runtime,
                handle: params.terminal,
                assertWritable: () => {
                  assertTerminalSendExactPtyBinding(runtime, params.terminal, ptyId)
                  if (ptyId && isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
                    throw new Error('terminal_guard_not_writable')
                  }
                }
              })
            }
          : undefined
      if (params.requireAgentStatus === 'sendable') {
        try {
          await assertSendPreconditions?.(leaf?.ptyId ?? undefined)
        } catch (error) {
          if (isTerminalSendGuardNotWritable(error)) {
            return {
              send: {
                handle: params.terminal,
                accepted: false,
                bytesWritten: 0
              }
            }
          }
          const refusedReason = getTerminalSendGuardRefusedReason(error)
          if (!refusedReason) {
            throw error
          }
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0,
              refusedReason
            }
          }
        }
      }
      const mobileFloorClientId = resolveMobileFloorClientId(driver, params.client)
      const mobileFloorClaim: MobileInputFloorClaimHolder = { current: null }
      const beforeWrite = assertSendPreconditions
      const reserveWrite =
        params.inputKind !== 'query-reply' && leaf?.ptyId && mobileFloorClientId
          ? (ptyId: string): void => {
              const claim = runtime.beginMobileInputFloor(ptyId, mobileFloorClientId)
              if (!claim) {
                throw new Error('mobile_input_floor_unavailable')
              }
              mobileFloorClaim.current = claim
            }
          : undefined
      let result
      try {
        result = await runtime.sendTerminal(
          params.terminal,
          {
            text: params.text,
            enter: params.enter === true,
            interrupt: params.interrupt === true
          },
          {
            beforeWrite,
            ...(reserveWrite ? { reserveWrite } : {}),
            ...(params.inputKind !== 'query-reply' && mobileFloorClientId
              ? { afterWrite: () => commitMobileInputFloorClaim(mobileFloorClaim) }
              : {})
          }
        )
      } catch (error) {
        mobileFloorClaim.current?.rollback()
        const refusedReason = getTerminalSendGuardRefusedReason(error)
        if (refusedReason) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0,
              refusedReason
            }
          }
        }
        if (isTerminalSendGuardNotWritable(error)) {
          return {
            send: {
              handle: params.terminal,
              accepted: false,
              bytesWritten: 0
            }
          }
        }
        throw error
      }
      if (result.accepted !== true) {
        mobileFloorClaim.current?.rollback()
      }
      // Why: deliberate mobile input takes the floor (drives `* → mobile{clientId}`); clientless sends fall back to the current mobile driver.
      return { send: result }
    }
  }),
  defineMethod({
    name: 'terminal.wait',
    params: TerminalWait,
    handler: async (params, { runtime, signal }) => ({
      wait: await runtime.waitForTerminal(params.terminal, {
        condition: params.for,
        timeoutMs: params.timeoutMs,
        signal
      })
    })
  }),
  defineMethod({
    name: 'terminal.create',
    params: TerminalCreateParams,
    handler: async (params, { runtime, pairedDeviceId, clientId }) => ({
      terminal: await runtime.dedupeTerminalCreate(
        pairedDeviceId ?? clientId ?? 'local',
        params.worktree,
        params.clientMutationId,
        params.reconcileExisting === true,
        (canonicalWorktreeSelector, preAllocatedHandle) =>
          runtime.createTerminal(canonicalWorktreeSelector, {
            command: params.command,
            startupCommandDelivery: params.startupCommandDelivery,
            env: params.env,
            envToDelete: params.envToDelete,
            ...(params.launchConfig ? { launchConfig: params.launchConfig } : {}),
            ...(params.resumeProviderSession
              ? { resumeProviderSession: params.resumeProviderSession }
              : {}),
            ...(params.launchToken ? { launchToken: params.launchToken } : {}),
            ...(params.launchAgent ? { launchAgent: params.launchAgent } : {}),
            ...(params.terminalColorQueryReplies
              ? { terminalColorQueryReplies: params.terminalColorQueryReplies }
              : {}),
            title: params.title,
            focus: params.focus === true,
            rendererBacked: params.rendererBacked === true,
            activate: params.activate === true,
            presentation: params.presentation,
            tabId: params.tabId,
            leafId: params.leafId,
            ...(preAllocatedHandle ? { preAllocatedHandle } : {})
          })
      )
    })
  }),
  defineMethod({
    name: 'terminal.split',
    params: TerminalSplit,
    handler: async (params, { runtime }) => ({
      split: await runtime.splitTerminal(params.terminal, {
        direction: params.direction,
        command: params.command,
        env: params.env,
        telemetrySource: params.telemetrySource
      })
    })
  }),
  defineMethod({
    name: 'terminal.stop',
    params: TerminalStop,
    handler: async (params, { runtime }) => runtime.stopTerminalsForWorktree(params.worktree)
  }),
  defineMethod({
    name: 'terminal.sleep',
    params: TerminalSleep,
    handler: async (params, { runtime }) => runtime.sleepTerminalsForWorktree(params.worktree)
  }),
  defineMethod({
    name: 'terminal.stopExact',
    params: TerminalStopExact,
    handler: async (params, { runtime }) =>
      runtime.stopExactTerminalsForWorktree(params.worktree, params.expectedPtyIds, {
        keepHistory: params.keepHistory,
        targetOnly: params.targetOnly
      })
  }),
  defineMethod({
    name: 'terminal.resizeForClient',
    params: TerminalResizeForClient,
    handler: async (params, { runtime }) => {
      // Why: a stale handle must fail with terminal_handle_stale, not resize the wrong PTY (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      if (!leaf?.ptyId) {
        throw new Error('no_connected_pty')
      }
      const result = await runtime.resizeForClient(
        leaf.ptyId,
        params.mode,
        params.clientId,
        params.mode === 'mobile-fit' ? params.cols : undefined,
        params.mode === 'mobile-fit' ? params.rows : undefined
      )
      return {
        terminal: {
          handle: params.terminal,
          ...result
        }
      }
    }
  }),
  defineMethod({
    name: 'terminal.focus',
    params: TerminalFocus,
    handler: async (params, { runtime, clientKind }) => ({
      focus: await runtime.focusTerminal(params.terminal, {
        navigateHost: navigationTargetsHost(
          resolveRuntimeNavigationTarget({ navigation: params.navigation, clientKind })
        )
      })
    })
  }),
  defineMethod({
    name: 'terminal.close',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      close: await runtime.closeTerminal(params.terminal)
    })
  }),
  defineMethod({
    name: 'terminal.closeTab',
    params: TerminalHandle,
    handler: async (params, { runtime }) => ({
      close: await runtime.closeTerminalTab(params.terminal)
    })
  }),
  defineMethod({
    name: 'agentTeams.tmuxCompat',
    params: AgentTeamsTmuxCompat,
    handler: async (params, { runtime }) => ({
      tmux: await runtime.handleAgentTeamsTmuxCompat(params)
    })
  }),
  defineMethod({
    name: 'agentTeams.prepareLaunch',
    params: AgentTeamsPrepareLaunch,
    handler: async (params, { runtime }) => ({
      launch: await runtime.prepareClaudeAgentTeamsLeader({
        paneKey: params.paneKey,
        baseEnv: params.env
      })
    })
  }),
  ...TERMINAL_DISPLAY_MODE_METHODS,
  // Why: one streaming RPC owns the binary socket and routes many panes by streamId; legacy subscribe stays as fallback.
]
