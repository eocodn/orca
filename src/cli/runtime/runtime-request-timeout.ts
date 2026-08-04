export function getTimeoutMsParam(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || !('timeoutMs' in params)) {
    return undefined
  }
  return (params as { timeoutMs?: unknown }).timeoutMs
}
