import type { IPtyProvider } from '../providers/types'

export type FallbackSessionIdentity = {
  id: string
  incarnationId?: string
}

export type DegradedFallbackShutdownResult = {
  killedCount: number
  retired: FallbackSessionIdentity[]
  retryable: FallbackSessionIdentity[]
}

export async function shutdownDegradedFallbackSessions<T extends IPtyProvider>(
  sessionProviders: Map<string, T>,
  fallback: T,
  resolveIncarnation?: (id: string) => string | undefined
): Promise<DegradedFallbackShutdownResult> {
  const ids = [...sessionProviders]
    .filter(([, provider]) => provider === fallback)
    .map(([id]) => id)
  const retired: FallbackSessionIdentity[] = []
  const retryable: FallbackSessionIdentity[] = []
  let killedCount = 0

  await Promise.all(
    ids.map(async (id) => {
      const incarnationId = resolveIncarnation?.(id)
      const identity = {
        id,
        ...(incarnationId ? { incarnationId } : {})
      }
      try {
        await fallback.shutdown(id, { immediate: true })
        sessionProviders.delete(id)
        killedCount++
      } catch (error) {
        // Only a provider-authoritative absence permits synthetic retirement. A live or
        // unverified PTY must remain mapped so restart can transfer it to a retry owner.
        let liveness: boolean | null = null
        try {
          liveness = (await fallback.probePtyLiveness?.(id)) ?? null
        } catch (probeError) {
          console.warn(
            `[daemon] Failed to verify fallback PTY ${id} after shutdown failure`,
            probeError
          )
        }
        if (liveness === false) {
          sessionProviders.delete(id)
          retired.push(identity)
          killedCount++
        } else {
          retryable.push(identity)
        }
        console.warn(
          `[daemon] Failed to shut down local fallback PTY ${id} during daemon restart`,
          error
        )
      }
    })
  )

  if (retryable.length > 0) {
    console.warn(
      `[daemon] ${retryable.length} local fallback PTY session(s) remain retryable during daemon restart`
    )
  }
  return { killedCount, retired, retryable }
}
