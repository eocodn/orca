import {
  validateHostPtyRequest,
  validateHostPtyResponse,
  type HostPtyRequest,
  type HostPtyResponse
} from '../../../shared/host-pty-protocol'
import {
  ClaimPtyWorkspaceArgsSchema,
  PtyHostStatusSchema,
  PtyWorkspaceClaimSchema,
  type TauriClaimPtyWorkspaceArgs,
  type TauriPtyHostStatus,
  type TauriPtyWorkspaceClaim
} from './tauri-host-bridge-schemas'
import {
  TauriHostBridgeError,
  correlated,
  parseJsonResponse,
  parseResponse,
  requestError
} from './tauri-host-bridge-response'

export type TauriPtyCommandNames = {
  ptyHostStatus: string
  claimPtyWorkspace: string
  ptyRequest: string
}

export type TauriPtyBridge = {
  ptyHostStatus: () => Promise<TauriPtyHostStatus>
  claimPtyWorkspace: (args: TauriClaimPtyWorkspaceArgs) => Promise<TauriPtyWorkspaceClaim>
  ptyRequest: (request: HostPtyRequest) => Promise<HostPtyResponse>
}

export type TauriInvokeJson = (
  command: string,
  args: Record<string, unknown>,
  requestId?: string
) => Promise<unknown>

export function createTauriPtyBridge(
  invokeJson: TauriInvokeJson,
  commands: TauriPtyCommandNames
): TauriPtyBridge {
  return {
    async ptyHostStatus() {
      return parseResponse(
        commands.ptyHostStatus,
        await invokeJson(commands.ptyHostStatus, {}),
        PtyHostStatusSchema
      )
    },

    async claimPtyWorkspace(input) {
      const parsed = ClaimPtyWorkspaceArgsSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(commands.claimPtyWorkspace, parsed.error)
      }
      const result = parseResponse(
        commands.claimPtyWorkspace,
        await invokeJson(commands.claimPtyWorkspace, parsed.data, parsed.data.requestId),
        PtyWorkspaceClaimSchema
      )
      if (
        result.workspace_id !== parsed.data.workspaceId ||
        result.state !== 'owned' ||
        result.worker_incarnation <= 0
      ) {
        throw new TauriHostBridgeError(
          'correlation_mismatch',
          'Tauri PTY claim response does not match the requested workspace.',
          commands.claimPtyWorkspace,
          parsed.data.requestId
        )
      }
      return correlated(result, parsed.data.requestId, commands.claimPtyWorkspace)
    },

    async ptyRequest(input) {
      const validatedRequest = validateHostPtyRequest(input)
      const requestId = input?.envelope?.request_id
      if (!validatedRequest.ok) {
        throw requestError(commands.ptyRequest, validatedRequest.reason, requestId)
      }
      const raw = await invokeJson(
        commands.ptyRequest,
        { request: validatedRequest.request },
        requestId
      )
      const validatedResponse = validateHostPtyResponse(parseJsonResponse(commands.ptyRequest, raw))
      if (!validatedResponse.ok) {
        throw new TauriHostBridgeError(
          'malformed_response',
          validatedResponse.reason,
          commands.ptyRequest,
          requestId
        )
      }
      return correlatePtyResponse(validatedResponse.response, validatedRequest.request, commands)
    }
  }
}

function correlatePtyResponse(
  response: HostPtyResponse,
  request: HostPtyRequest,
  commands: TauriPtyCommandNames
): HostPtyResponse {
  const requestId = request.envelope.request_id
  const generationMatches =
    request.session_generation === null
      ? response.session_generation > 0
      : response.session_generation === request.session_generation
  if (
    response.envelope.request_id !== requestId ||
    response.workspace_id !== request.workspace_id ||
    response.worker_id !== request.worker_id ||
    response.session_id !== request.session_id ||
    response.operation !== request.operation.type ||
    !generationMatches
  ) {
    throw new TauriHostBridgeError(
      'correlation_mismatch',
      'Tauri PTY response does not match the request identity.',
      commands.ptyRequest,
      requestId
    )
  }
  return response
}
