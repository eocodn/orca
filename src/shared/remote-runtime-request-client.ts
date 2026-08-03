import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { PairingOffer } from './pairing'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from './e2ee-crypto'
import {
  isKeepaliveFrame,
  RuntimeRpcEnvelopeSchema,
  type RuntimeOrchestrationEnvelope,
  type RuntimeRpcResponse
} from './runtime-rpc-envelope'
import { SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY } from './protocol-version'
// Re-export so existing value importers of `RemoteRuntimeClientError` are
// unaffected; the class lives in a ws-free module so type-only consumers
// (and mobile's typecheck) don't compile this file's Node-only deps.
import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import {
  REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES,
  serializeRemoteRuntimePayload
} from './remote-runtime-memory-limits'
import {
  prepareRemoteRuntimeRequest,
  releaseRemoteRuntimePreparedRequest,
  takeRemoteRuntimePreparedRequest
} from './remote-runtime-prepared-request-admission'
import { parseRemoteRuntimeJsonText } from './remote-runtime-request-frames'
import { MAX_TIMER_DELAY_MS, isSafeTimerDelayMs } from './timer-delay'

export { RemoteRuntimeClientError } from './remote-runtime-client-error'

export type HandshakeState = 'awaiting_ready' | 'awaiting_authenticated' | 'ready'

export function ignoreSettledRemoteRuntimeSocketError(): void {}

export function formatRemoteRuntimeCloseMessage(code: number, reason: Buffer): string {
  const suffixParts: string[] = []
  if (code !== 1005 && code !== 1006) {
    suffixParts.push(String(code))
  }
  const reasonText = reason.toString().trim()
  if (reasonText) {
    suffixParts.push(reasonText)
  }
  return suffixParts.length > 0
    ? `Remote Orca runtime closed the connection (${suffixParts.join(': ')}).`
    : 'Remote Orca runtime closed the connection.'
}

export type RemoteRuntimeSubscription = {
  requestId: string
  close: () => void
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean
}

export type RemoteRuntimeSubscriptionCallbacks<TResult = unknown> = {
  onResponse: (response: RuntimeRpcResponse<TResult>) => void
  onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
  onError: (error: RemoteRuntimeClientError) => void
  onClose?: () => void
}

export async function sendRemoteRuntimeRequest<TResult>(
  pairing: PairingOffer,
  method: string,
  params: unknown,
  timeoutMs: number,
  envelope?: RuntimeOrchestrationEnvelope
): Promise<RuntimeRpcResponse<TResult>> {
  if (!isSafeTimerDelayMs(timeoutMs)) {
    throw new RemoteRuntimeClientError(
      'invalid_argument',
      `Runtime request timeout must be an integer between 0 and ${MAX_TIMER_DELAY_MS}ms.`
    )
  }
  const requestId = randomUUID()
  const serializedAuth = serializeRemoteRuntimePayload({
    type: 'e2ee_auth',
    deviceToken: pairing.deviceToken,
    clientCapabilities: [SESSION_TAB_CLOSE_INTENT_RUNTIME_CAPABILITY]
  })
  const pendingRequest = {
    preparedRequest: prepareRemoteRuntimeRequest(new Map(), () =>
      serializeRemoteRuntimePayload({
        id: requestId,
        deviceToken: pairing.deviceToken,
        method,
        params,
        orchestrationCapability: envelope?.orchestrationCapability,
        orchestrationContractVersion: envelope?.orchestrationContractVersion,
        orchestrationRequestId: envelope?.orchestrationRequestId,
        compatibilityInvocationId: envelope?.compatibilityInvocationId,
        orchestrationCompatibilityEvidence: envelope?.orchestrationCompatibilityEvidence
      })
    )
  }
  let serializedRequest = takeRemoteRuntimePreparedRequest(pendingRequest)
  return await new Promise<RuntimeRpcResponse<TResult>>((resolve, reject) => {
    const keyPair = generateKeyPair()
    const serverPublicKey = publicKeyFromBase64(pairing.publicKeyB64)
    const sharedKey = deriveSharedKey(keyPair.secretKey, serverPublicKey)
    let state: HandshakeState = 'awaiting_ready'
    let settled = false
    let ws: WebSocket | null = null
    const getPairingStage = (): 'connect' | 'host-identity' | 'runtime' =>
      state === 'awaiting_ready'
        ? 'connect'
        : state === 'awaiting_authenticated'
          ? 'host-identity'
          : 'runtime'

    const cleanupSocketListeners = (): void => {
      const socket = ws
      if (!socket) {
        return
      }
      socket.off('open', onOpen)
      socket.off('error', onError)
      socket.off('close', onClose)
      socket.off('message', onMessage)
      // Why: the settled one-shot no longer needs Orca callbacks, but a ws
      // can still report a late transport error after close is requested.
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.on('error', ignoreSettledRemoteRuntimeSocketError)
      }
    }

    let timeout = setTimeout(onTimeout, timeoutMs)

    function onTimeout(): void {
      finish({
        ok: false,
        error: new RemoteRuntimeClientError(
          'runtime_timeout',
          'Timed out waiting for the remote Orca runtime to respond.',
          { pairingStage: getPairingStage() }
        )
      })
    }

    function refreshTimeout(): void {
      const refreshableTimeout = timeout as { refresh?: () => void }
      if (typeof refreshableTimeout.refresh === 'function') {
        refreshableTimeout.refresh()
        return
      }
      // Mobile's DOM timer type has no refresh().
      clearTimeout(timeout)
      timeout = setTimeout(onTimeout, timeoutMs)
    }

    const finish = (
      result: { ok: true; response: RuntimeRpcResponse<TResult> } | { ok: false; error: Error }
    ): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      try {
        cleanupSocketListeners()
        ws?.close()
      } catch {
        // ignore best-effort close
      }
      if (result.ok === false) {
        reject(result.error)
      } else {
        resolve(result.response)
      }
    }

    try {
      ws = new WebSocket(pairing.endpoint, { maxPayload: REMOTE_RUNTIME_MAX_WEBSOCKET_FRAME_BYTES })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finish({
        ok: false,
        error: new RemoteRuntimeClientError(
          'invalid_argument',
          `Invalid remote endpoint: ${message}`
        )
      })
      return
    }

    function onOpen(): void {
      ws?.send(
        JSON.stringify({
          type: 'e2ee_hello',
          publicKeyB64: publicKeyToBase64(keyPair.publicKey)
        })
      )
    }

    function onError(): void {
      finish({
        ok: false,
        error: new RemoteRuntimeClientError(
          'remote_runtime_unavailable',
          'Could not connect to the remote Orca runtime.',
          { pairingStage: getPairingStage() }
        )
      })
    }

    function onClose(code: number, reason: Buffer): void {
      if (!settled) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'remote_runtime_unavailable',
            formatRemoteRuntimeCloseMessage(code, reason),
            {
              pairingStage: getPairingStage(),
              closeCode: code
            }
          )
        })
      }
    }

    function onMessage(data: WebSocket.RawData, isBinary: boolean): void {
      if (settled) {
        return
      }
      if (isBinary) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an unexpected binary frame.',
            {
              pairingStage: state === 'awaiting_ready' ? 'host-identity' : getPairingStage()
            }
          )
        })
        return
      }

      const frame = data.toString()
      if (state === 'awaiting_ready') {
        handleReadyFrame(frame)
        return
      }

      const plaintext = decrypt(frame, sharedKey)
      if (plaintext === null) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an undecryptable frame.',
            {
              pairingStage: state === 'awaiting_authenticated' ? 'host-identity' : getPairingStage()
            }
          )
        })
        return
      }

      if (state === 'awaiting_authenticated') {
        handleAuthenticatedFrame(plaintext)
        return
      }

      handleRpcFrame(plaintext)
    }

    ws.once('open', onOpen)
    ws.once('error', onError)
    ws.on('close', onClose)
    ws.on('message', onMessage)

    function handleReadyFrame(frame: string): void {
      let ready: unknown
      try {
        ready = parseRemoteRuntimeJsonText(frame)
      } catch {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an invalid E2EE handshake frame.',
            { pairingStage: 'host-identity' }
          )
        })
        return
      }
      if (
        typeof ready !== 'object' ||
        ready === null ||
        (ready as { type?: unknown }).type !== 'e2ee_ready'
      ) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an unexpected E2EE handshake frame.',
            { pairingStage: 'host-identity' }
          )
        })
        return
      }
      state = 'awaiting_authenticated'
      ws?.send(encrypt(serializedAuth, sharedKey))
    }

    function handleAuthenticatedFrame(plaintext: string): void {
      let authenticated: unknown
      try {
        authenticated = parseRemoteRuntimeJsonText(plaintext)
      } catch {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an invalid E2EE auth frame.',
            { pairingStage: 'host-identity' }
          )
        })
        return
      }
      const type = (authenticated as { type?: unknown }).type
      if (type !== 'e2ee_authenticated') {
        const code =
          typeof authenticated === 'object' &&
          authenticated !== null &&
          (authenticated as { error?: { code?: unknown } }).error?.code === 'unauthorized'
            ? 'unauthorized'
            : 'invalid_runtime_response'
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            code,
            'Remote Orca runtime rejected the pairing token.',
            { pairingStage: code === 'unauthorized' ? 'access-grant' : 'host-identity' }
          )
        })
        return
      }
      state = 'ready'
      const request = serializedRequest
      serializedRequest = null
      if (request === null) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'remote_runtime_unavailable',
            'Remote Orca runtime request was released before it could be sent.'
          )
        })
        return
      }
      ws?.send(encrypt(request, sharedKey))
    }

    function handleRpcFrame(plaintext: string): void {
      let raw: unknown
      try {
        raw = parseRemoteRuntimeJsonText(plaintext)
      } catch {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an invalid response frame.',
            { pairingStage: 'runtime' }
          )
        })
        return
      }
      if (isKeepaliveFrame(raw)) {
        refreshTimeout()
        return
      }
      const parsed = RuntimeRpcEnvelopeSchema.safeParse(raw)
      if (!parsed.success || '_keepalive' in parsed.data) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned an invalid response frame.',
            { pairingStage: 'runtime' }
          )
        })
        return
      }
      const response = parsed.data as RuntimeRpcResponse<TResult>
      if (response.id !== requestId) {
        finish({
          ok: false,
          error: new RemoteRuntimeClientError(
            'invalid_runtime_response',
            'Remote Orca runtime returned a mismatched response id.',
            { pairingStage: 'runtime' }
          )
        })
        return
      }
      finish({ ok: true, response })
    }
  }).finally(() => releaseRemoteRuntimePreparedRequest(pendingRequest))
}
