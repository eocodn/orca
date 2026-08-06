type FirstWindowStartupServices = {
  startDaemonPtyProvider: (signal: AbortSignal) => Promise<void>
  onDaemonError: (error: unknown) => void
}

type StartupService = {
  ready: Promise<void>
  reportTimeout: () => void
}

type FirstWindowStartupServicesResult = {
  firstWindowReady: Promise<void>
  localPtyReady: Promise<void>
  localPtyProviderReady: Promise<void>
}

export const FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS = 12_000
// Why: a slow (but succeeding) daemon start must not flip terminals to the
// LocalPtyProvider fallback — local PTYs are killed on quit, so panes bound to
// them lose their daemon sessions permanently (#5232). The PTY gate therefore
// waits for the daemon attempt itself and only fail-opens at a hard cap that
// exists solely as a deadlock backstop.
export const LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS = 60_000

function startService(
  label: string,
  start: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void
): StartupService {
  const abortController = new AbortController()
  let settled = false
  let reportedTimeout = false
  const ready = Promise.resolve()
    .then(() => start(abortController.signal))
    .catch((error) => {
      if (!reportedTimeout) {
        onError(error)
      }
    })
    .finally(() => {
      settled = true
    })

  return {
    ready,
    reportTimeout: () => {
      if (settled) {
        return
      }
      reportedTimeout = true
      abortController.abort()
      onError(new Error(`${label} startup timed out`))
    }
  }
}

/**
 * Starts the services that must be ready before restored terminal panes mount.
 */
export function startFirstWindowStartupServices({
  startDaemonPtyProvider,
  onDaemonError
}: FirstWindowStartupServices): FirstWindowStartupServicesResult {
  // Why: restored terminals require daemon authority. The first window fails
  // open quickly so the user sees the app; the local PTY gate waits for the
  // daemon attempt and only fails open at the hard cap.
  const daemon = startService('daemon PTY provider', startDaemonPtyProvider, onDaemonError)
  const allServicesReady = daemon.ready
  let windowTimeout: ReturnType<typeof setTimeout> | null = null
  let failOpenTimeout: ReturnType<typeof setTimeout> | null = null
  const servicesSettled = allServicesReady.finally(() => {
    if (windowTimeout) {
      clearTimeout(windowTimeout)
    }
    if (failOpenTimeout) {
      clearTimeout(failOpenTimeout)
    }
  })
  const failOpenReady = new Promise<void>((resolve) => {
    failOpenTimeout = setTimeout(() => {
      daemon.reportTimeout()
      resolve()
    }, LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS)
  })
  const firstWindowReady = Promise.race([
    servicesSettled,
    new Promise<void>((resolve) => {
      windowTimeout = setTimeout(resolve, FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS)
    })
  ])
  const localPtyReady = Promise.race([servicesSettled, failOpenReady])
  // Why: destructive routing only needs daemon authority. A stalled optional
  // hook server must not hold terminal close for the full fail-open window.
  const localPtyProviderReady = Promise.race([daemon.ready, failOpenReady])

  return { firstWindowReady, localPtyReady, localPtyProviderReady }
}
