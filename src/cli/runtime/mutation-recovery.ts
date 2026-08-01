import { RuntimeClientError } from './types'

export function attachMutationRecovery(error: unknown, requestId: string | undefined): unknown {
  if (!requestId || !(error instanceof RuntimeClientError)) {
    return error
  }
  return new RuntimeClientError(
    error.code,
    `${error.message} Orchestration mutation request ID: ${requestId}.`,
    {
      ...(error.data && typeof error.data === 'object' ? error.data : {}),
      orchestrationRequestId: requestId
    }
  )
}
