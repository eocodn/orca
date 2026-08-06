import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { HostPtyRequest, HostPtyResponse } from '../../../shared/host-pty-protocol'
import {
  FileRequestArgsSchema,
  FileResultSchema,
  GitResultSchema,
  GitWorktreeListArgsSchema,
  HostStatusArgsSchema,
  HostStatusSchema,
  RegisterWorkspaceArgsSchema,
  TerminalRequestSchema,
  TerminalResultSchema,
  type TauriClaimPtyWorkspaceArgs,
  type TauriFileRequestArgs,
  type TauriFileResult,
  type TauriGitWorktreeListArgs,
  type TauriGitWorktreeListResult,
  type TauriHostStatus,
  type TauriPtyHostStatus,
  type TauriPtyWorkspaceClaim,
  type TauriRegisterWorkspaceArgs,
  type TauriTerminalRequest,
  type TauriTerminalResult
} from './tauri-host-bridge-schemas'
import {
  TauriHostBridgeError,
  correlated,
  correlatedFile,
  correlatedTerminal,
  normalizeInvokeError,
  parseResponse,
  requestError,
  type TauriHostBridgeErrorCode
} from './tauri-host-bridge-response'
import { createTauriPtyBridge } from './tauri-host-pty-bridge'

export { TauriHostBridgeError, type TauriHostBridgeErrorCode }

export const TAURI_HOST_COMMANDS = Object.freeze({
  hostStatus: 'host_status',
  registerWorkspace: 'register_workspace',
  gitWorktreeList: 'git_worktree_list',
  fileRequest: 'file_request',
  terminalRequest: 'terminal_request',
  ptyHostStatus: 'pty_host_status',
  claimPtyWorkspace: 'claim_pty_workspace',
  ptyRequest: 'pty_request'
} as const)

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type TauriHostBridge = {
  hostStatus: (stateDb: string) => Promise<TauriHostStatus>
  registerWorkspace: (args: TauriRegisterWorkspaceArgs) => Promise<TauriHostStatus>
  gitWorktreeList: (args: TauriGitWorktreeListArgs) => Promise<TauriGitWorktreeListResult>
  fileRequest: (args: TauriFileRequestArgs) => Promise<TauriFileResult>
  terminalRequest: (request: TauriTerminalRequest) => Promise<TauriTerminalResult>
  ptyHostStatus: () => Promise<TauriPtyHostStatus>
  claimPtyWorkspace: (args: TauriClaimPtyWorkspaceArgs) => Promise<TauriPtyWorkspaceClaim>
  ptyRequest: (request: HostPtyRequest) => Promise<HostPtyResponse>
}

function withOptionalArgs<T extends Record<string, unknown>>(args: T): T {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as T
}

export function createTauriHostBridge(
  invoke: TauriInvoke = tauriInvoke as TauriInvoke
): TauriHostBridge {
  const invokeJson = async (
    command: string,
    args: Record<string, unknown>,
    requestId?: string
  ): Promise<unknown> => {
    try {
      return await invoke<string>(command, args)
    } catch (error) {
      throw normalizeInvokeError(command, error, requestId)
    }
  }
  const pty = createTauriPtyBridge(invokeJson, TAURI_HOST_COMMANDS)

  return {
    async hostStatus(stateDb) {
      const parsed = HostStatusArgsSchema.safeParse({ stateDb })
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.hostStatus, parsed.error)
      }
      return parseResponse(
        TAURI_HOST_COMMANDS.hostStatus,
        await invokeJson(TAURI_HOST_COMMANDS.hostStatus, parsed.data),
        HostStatusSchema
      )
    },

    async registerWorkspace(input) {
      const parsed = RegisterWorkspaceArgsSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.registerWorkspace, parsed.error)
      }
      const args = withOptionalArgs(parsed.data)
      return parseResponse(
        TAURI_HOST_COMMANDS.registerWorkspace,
        await invokeJson(TAURI_HOST_COMMANDS.registerWorkspace, args),
        HostStatusSchema
      )
    },

    async gitWorktreeList(input) {
      const parsed = GitWorktreeListArgsSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.gitWorktreeList, parsed.error)
      }
      const args = withOptionalArgs(parsed.data)
      const result = parseResponse(
        TAURI_HOST_COMMANDS.gitWorktreeList,
        await invokeJson(TAURI_HOST_COMMANDS.gitWorktreeList, args, parsed.data.requestId),
        GitResultSchema
      )
      return correlated(result, parsed.data.requestId, TAURI_HOST_COMMANDS.gitWorktreeList)
    },

    async fileRequest(input) {
      const bytes = input.bytes === undefined ? [] : Array.from(input.bytes)
      const parsed = FileRequestArgsSchema.safeParse({ ...input, bytes })
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.fileRequest, parsed.error)
      }
      const result = parseResponse(
        TAURI_HOST_COMMANDS.fileRequest,
        await invokeJson(TAURI_HOST_COMMANDS.fileRequest, parsed.data, parsed.data.requestId),
        FileResultSchema
      )
      return correlatedFile(result, parsed.data, TAURI_HOST_COMMANDS.fileRequest)
    },

    async terminalRequest(input) {
      const parsed = TerminalRequestSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.terminalRequest, parsed.error)
      }
      const result = parseResponse(
        TAURI_HOST_COMMANDS.terminalRequest,
        await invokeJson(
          TAURI_HOST_COMMANDS.terminalRequest,
          { request: parsed.data },
          parsed.data.envelope.request_id
        ),
        TerminalResultSchema
      )
      return correlatedTerminal(result, parsed.data, TAURI_HOST_COMMANDS.terminalRequest)
    },

    ...pty
  }
}
