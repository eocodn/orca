import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fork, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import {
  DaemonSpawner,
  getDaemonPidPath,
  getDaemonSocketPath,
  getDaemonTokenPath,
  serializeDaemonPidFile,
  unlinkOwnedDaemonPidFile,
  type DaemonLauncher,
  type DaemonProcessHandle
} from './daemon-spawner'
import { DaemonPtyAdapter, type DaemonRespawnReason } from './daemon-pty-adapter'
import { DaemonPtyRouter } from './daemon-pty-router'
import { DaemonClient } from './client'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  type ListSessionsResult
} from './types'
import {
  getMacDaemonSystemResolverHealth,
  getDaemonLaunchIdentity,
  checkDaemonHealth,
  isDaemonStaleForCurrentBundle,
  killStaleDaemon,
  parseDaemonPidFile
} from './daemon-health'
import {
  collectPinnedDaemonVersions,
  materializeRelocatedDaemonHost,
  pruneOldDaemonHosts
} from './daemon-host-relocation'
import { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'
import { trackDaemonReplaced, trackDaemonRetired } from './daemon-lifecycle-event'
import type { DaemonReplaceReason } from '../../shared/daemon-lifecycle-telemetry'
import {
  getLocalPtyProvider,
  setLocalPtyProvider,
  unbindLocalProviderListeners,
  rebindLocalProviderListeners
} from '../ipc/pty'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'
import { getDaemonLogFilePath } from '../observability/logs-directory'
import {
  confirmSeededClaudeLivePtys,
  hasSeededUnconfirmedClaudePtys
} from '../claude-accounts/live-pty-gate'
import { parseDaemonReadyIdentity } from './daemon-ready-identity'

export function logDaemonMilestone(event: string, details: Record<string, unknown> = {}): void {
  if (isStartupDiagnosticsEnabled()) {
    logStartupDiagnostic(event, { t: Math.round(performance.now()), ...details })
  }
}

// Why: extra hello+listSessions probes (~5s each) giving a wedged-but-connectable daemon ~60s grace to answer and keep its live sessions before a permanent wedge (#8689) is replaced; raise only alongside the fail-open cap.
export const WEDGED_DAEMON_GRACE_RETRIES = 11
const DAEMON_SELF_SHUTDOWN_WAIT_MS = 5_000
const DAEMON_CHILD_TERMINATION_GRACE_MS = 5_000
const DAEMON_CHILD_FORCE_EXIT_WAIT_MS = 1_000

export function getRuntimeDir(): string {
  const dir = join(app.getPath('userData'), 'daemon')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getHistoryDir(): string {
  const dir = join(app.getPath('userData'), 'terminal-history')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDaemonEntryPath(): string {
  const appPath = app.getAppPath()
  // Why: packaged app.getAppPath() points at app.asar, so redirect to app.asar.unpacked where daemon-entry.js is fork-executable.
  const basePath = app.isPackaged ? appPath.replace('app.asar', 'app.asar.unpacked') : appPath
  const directEntryPath = join(basePath, 'daemon-entry.js')
  if (existsSync(directEntryPath)) {
    return directEntryPath
  }
  return join(basePath, 'out', 'main', 'daemon-entry.js')
}

// Why: pass a log-file arg so field failures are diagnosable, but honor the ORCA_DIAGNOSTICS_DISABLED privacy switch.
export function daemonLogArgs(): string[] {
  const disabled = (process.env.ORCA_DIAGNOSTICS_DISABLED ?? '').trim().toLowerCase()
  if (disabled === '1' || disabled === 'true') {
    return []
  }
  return ['--log-file', getDaemonLogFilePath()]
}

// Why: a socket that accepts a connection proves a daemon survived a previous app session and can be reused.
export function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && !existsSync(socketPath)) {
      resolve(false)
      return
    }
    const sock = connect({ path: socketPath })
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    function finish(alive: boolean, options?: { destroy?: boolean }): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      sock.removeListener('connect', onConnect)
      sock.removeListener('error', onError)
      if (options?.destroy) {
        sock.destroy()
      }
      resolve(alive)
    }

    function onConnect(): void {
      finish(true, { destroy: true })
    }

    function onError(): void {
      finish(false)
    }

    timer = setTimeout(() => {
      finish(false, { destroy: true })
    }, 1000)
    sock.on('connect', onConnect)
    sock.on('error', onError)
  })
}

export async function getAliveDaemonSessionCount(
  socketPath: string,
  tokenPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<number | null> {
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion })
  try {
    await client.ensureConnected()
    const result = await client.request<ListSessionsResult>('listSessions', undefined)
    return result.sessions.filter((session) => session.isAlive).length
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}

export function createPreservedDaemonHandle(
  runtimeDir: string,
  protocolVersion = PROTOCOL_VERSION,
  mode?: 'degraded-new-pty-fallback'
): DaemonProcessHandle {
  const handle: DaemonProcessHandle = {
    shutdown: async () => {
      await cleanupDaemonForProtocol(runtimeDir, protocolVersion)
    }
  }
  if (mode) {
    handle.mode = mode
  }
  return handle
}

export async function holdDaemonAdoptionLease(
  handle: DaemonProcessHandle,
  socketPath: string,
  tokenPath: string,
  connectedClient?: DaemonClient
): Promise<DaemonProcessHandle> {
  const client = connectedClient ?? new DaemonClient({ socketPath, tokenPath })
  try {
    await client.ensureConnected()
  } catch (error) {
    client.disconnect()
    throw error
  }
  handle.releaseAdoptionLease = () => client.disconnect()
  return handle
}

export function releaseDaemonAdoptionLease(handle: DaemonProcessHandle | null): void {
  takeDaemonAdoptionLeaseRelease(handle)?.()
}

export function takeDaemonAdoptionLeaseRelease(
  handle: DaemonProcessHandle | null
): (() => void) | undefined {
  const release = handle?.releaseAdoptionLease
  if (!release || !handle) {
    return undefined
  }
  delete handle.releaseAdoptionLease
  return release
}

export async function cleanupFailedDaemonAdoption(
  failedSpawner: DaemonSpawner,
  current: DaemonPtyAdapter,
  legacy: DaemonPtyAdapter[] = []
): Promise<void> {
  const handle = failedSpawner.getHandle()
  const results = await Promise.allSettled([
    Promise.resolve().then(() => releaseDaemonAdoptionLease(handle)),
    ...legacy.map((entry) => entry.disconnectOnly()),
    (async () => {
      try {
        // Why: other authenticated clients may win, so only daemon-side shutdownIfIdle can prove a failed adoption is killable.
        await current.disconnectOnly()
      } catch (error) {
        current.dispose()
        throw error
      }
    })()
  ])
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Daemon adoption cleanup failed')
  }
}

export async function terminateLaunchedDaemonChild(child: ChildProcess): Promise<void> {
  try {
    if (
      (child.exitCode !== null && child.exitCode !== undefined) ||
      (child.signalCode !== null && child.signalCode !== undefined)
    ) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      let gracefulTimer: ReturnType<typeof setTimeout>
      let forcedTimer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(gracefulTimer)
        if (forcedTimer) {
          clearTimeout(forcedTimer)
        }
        child.off('exit', onExit)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      const onExit = (): void => finish()
      child.on('exit', onExit)
      gracefulTimer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL')
          } catch (error) {
            finish(isNoSuchProcessError(error) ? undefined : error)
            return
          }
        }
        if (!settled) {
          forcedTimer = setTimeout(
            () => finish(new Error('Daemon did not exit after SIGKILL')),
            DAEMON_CHILD_FORCE_EXIT_WAIT_MS
          )
        }
      }, DAEMON_CHILD_TERMINATION_GRACE_MS)
      if (child.pid) {
        try {
          process.kill(child.pid, 'SIGTERM')
        } catch (error) {
          finish(isNoSuchProcessError(error) ? undefined : error)
        }
      } else {
        finish()
      }
    })
  } finally {
    if (child.connected) {
      child.disconnect()
    }
    child.unref()
  }
}

export function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

export async function shouldPreserveDaemonWithLiveSessions(
  socketPath: string,
  tokenPath: string,
  replacementLabel: string
): Promise<boolean> {
  const liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
  if (liveSessionCount === 0) {
    return false
  }
  console.warn(
    liveSessionCount === null
      ? `[daemon] Preserving daemon ${replacementLabel} because live session state could not be verified`
      : `[daemon] Preserving daemon ${replacementLabel} because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
  )
  return true
}

// Why: the adapter decides a runtime resolver replacement, but the launcher completes it — and by
// then the daemon has usually self-retired (dropping its last authenticated client is enough), so
// there is nothing left to kill and the launcher's own confirmed-kill gate would report nothing.
// The adapter hands the reason across so the launch it triggers reports what actually drove it.
let attributedReplaceReason: DaemonReplaceReason | null = null

export function createOutOfProcessLauncher(
  runtimeDir: string,
  macosLoginSessionWatch = false
): DaemonLauncher {
  return async (socketPath, tokenPath, suppliedPidPath, suppliedLaunchNonce) => {
    const entryPath = getDaemonEntryPath()
    const pidPath = suppliedPidPath ?? getDaemonPidPath(runtimeDir)
    const launchNonce = suppliedLaunchNonce ?? randomUUID()
    // One-shot: whichever launch consumes it owns the attribution, so a later unrelated launch can't
    // reuse it. The write in the respawn closure reaches here without an intervening await, which is
    // what makes a bare module-scoped slot safe — keep it that way or a concurrent launch can steal it.
    const attributedReason = attributedReplaceReason
    attributedReplaceReason = null
    let pendingReplacement:
      | {
          reason: Parameters<typeof trackDaemonReplaced>[0]
          liveSessionCount: number | null
        }
      | undefined
    let confirmedReplacement = false
    let adoptionClient: DaemonClient | null = new DaemonClient({ socketPath, tokenPath })
    try {
      // Why: acquire the full pair before control-only probes so an expired inherited deadline can't fire in the probe-to-adoption gap.
      await adoptionClient.ensureConnected()
    } catch {
      adoptionClient.disconnect()
      adoptionClient = null
    }
    const preserveDaemon = async (
      mode?: 'degraded-new-pty-fallback'
    ): Promise<DaemonProcessHandle> => {
      const connectedClient = adoptionClient ?? undefined
      adoptionClient = null
      return holdDaemonAdoptionLease(
        createPreservedDaemonHandle(runtimeDir, PROTOCOL_VERSION, mode),
        socketPath,
        tokenPath,
        connectedClient
      )
    }
    try {
      const health = await checkDaemonHealth(socketPath, tokenPath)
      if (health === 'healthy') {
        const resolverHealth = await getMacDaemonSystemResolverHealth(socketPath, tokenPath)
        if (resolverHealth === 'unhealthy') {
          const liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
          if (liveSessionCount !== 0) {
            console.warn(
              liveSessionCount === null
                ? '[daemon] Preserving daemon with unavailable macOS system resolver because live session state could not be verified'
                : `[daemon] Preserving daemon with unavailable macOS system resolver because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
            )
            return preserveDaemon()
          }
          console.warn('[daemon] Replacing daemon with unavailable macOS system resolver')
          pendingReplacement = { reason: 'unhealthy_resolver', liveSessionCount }
          confirmedReplacement = (await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION))
            .cleaned
        } else {
          // Why: a protocol-healthy daemon can outlive its launching app bundle (dev worktree rebuild, or packaged update replacing the app path).
          const identity = await getDaemonLaunchIdentity(
            runtimeDir,
            socketPath,
            tokenPath,
            entryPath
          )
          const stalePackagedBundle =
            app.isPackaged &&
            (await isDaemonStaleForCurrentBundle(
              runtimeDir,
              socketPath,
              tokenPath,
              app.getVersion()
            ))
          if (identity === 'mismatch' || stalePackagedBundle) {
            // Why: replacing a healthy daemon kills its child PTYs; defer code freshness until no live sessions would be lost.
            const replacementLabel = stalePackagedBundle
              ? 'launched before the current app bundle was installed'
              : 'launched from a different app path'
            if (
              await shouldPreserveDaemonWithLiveSessions(socketPath, tokenPath, replacementLabel)
            ) {
              return preserveDaemon()
            }
            console.warn(
              stalePackagedBundle
                ? '[daemon] Replacing daemon launched before the current app bundle was installed'
                : '[daemon] Replacing daemon launched from a different app path'
            )
            // liveSessionCount is 0: shouldPreserveDaemonWithLiveSessions() only falls through at exactly 0.
            pendingReplacement = {
              reason: stalePackagedBundle ? 'stale_bundle' : 'different_app_path',
              liveSessionCount: 0
            }
            confirmedReplacement = (await cleanupDaemonForProtocol(runtimeDir, PROTOCOL_VERSION))
              .cleaned
          } else {
            // Why: healthy daemon from a previous session answered a protocol ping — safe to reuse.
            return preserveDaemon()
          }
        }
      } else {
        // Why: a busy machine can time out the health check on a live daemon; re-verify with a session list before killing its sessions.
        let liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
        // Why: a wedged-but-connectable daemon (Windows update relaunch) may still own live sessions, so grace-retry before replacing; a permanent wedge (#8689) exhausts the grace, and 'rejected' skips it (handshake refused = never adoptable).
        let graceRetry = 0
        while (
          liveSessionCount === null &&
          health !== 'rejected' &&
          graceRetry < WEDGED_DAEMON_GRACE_RETRIES &&
          (await probeSocket(socketPath))
        ) {
          liveSessionCount = await getAliveDaemonSessionCount(socketPath, tokenPath)
          graceRetry++
        }
        if (liveSessionCount !== null && liveSessionCount > 0) {
          if (health === 'pty-spawn-unhealthy') {
            console.warn(
              `[daemon] DEGRADED MODE: preserving daemon that failed the PTY spawn health check because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}. Existing sessions keep working; fresh terminals run on the local provider WITHOUT daemon persistence until you restart the daemon (Manage Sessions → Restart).`
            )
            return preserveDaemon('degraded-new-pty-fallback')
          }
          console.warn(
            `[daemon] Preserving daemon that failed the health check because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
          )
          return preserveDaemon()
        }
        // Why: the sibling replace branches announce themselves, but this one used
        // to kill a daemon silently — leaving no way to tell a replacement apart
        // from an adoption after the fact. A cold start also lands here with
        // nothing to replace, so only speak up once something actually answered:
        // a probe that returned a count, a socket that survived a grace retry, or
        // a refused hello.
        if (liveSessionCount !== null || graceRetry > 0 || health === 'rejected') {
          console.warn(
            `[daemon] Replacing daemon that failed the health check (health=${health}, liveSessions=${liveSessionCount ?? 'unverifiable'}, graceRetries=${graceRetry})`
          )
        }
        // Why: unlike the log above, telemetry gates on confirmedReplacement below — the
        // post-kill truth — so a cold start that killed nothing never reports a replacement.
        pendingReplacement = { reason: 'failed_health_check', liveSessionCount }
      }

      // Why: a raw socket can outlive a broken daemon; kill by PID before respawn so the new daemon doesn't race the stale one.
      adoptionClient?.disconnect()
      adoptionClient = null
      confirmedReplacement =
        (await killStaleDaemon(runtimeDir, socketPath, tokenPath)) || confirmedReplacement
      // Why: rank by how well each reason is evidenced. A confirmed kill whose reason positively
      // identified the daemon outranks the attribution, so a stale bundle caught here is not billed
      // to the resolver. failed_health_check is the residual "couldn't tell" bucket though — it also
      // absorbs wedges and crashes — so the adapter's attribution beats it. That case is not exotic:
      // the same dead login session that fails the resolver also fails the PTY spawn probe, and with
      // zero live sessions that lands here rather than in the degraded preserve above.
      const identifiedReplacement =
        pendingReplacement &&
        confirmedReplacement &&
        pendingReplacement.reason !== 'failed_health_check'
          ? pendingReplacement
          : null
      if (identifiedReplacement) {
        trackDaemonReplaced(identifiedReplacement.reason, identifiedReplacement.liveSessionCount)
      } else if (attributedReason) {
        trackDaemonReplaced(attributedReason, 0)
      } else if (pendingReplacement && confirmedReplacement) {
        trackDaemonReplaced(pendingReplacement.reason, pendingReplacement.liveSessionCount)
      }

      const userDataPath = app.getPath('userData')
      // Why: on win32 packaged, stage a daemon-host copy in userData so its image escapes the NSIS updater's kill zone; lazy so it's off first-paint. Fail-open: null → in-dir host.
      const relocatedHost = materializeRelocatedDaemonHost()
      // Fork the relocated entry when available; otherwise the install-dir entry.
      const forkEntryPath = relocatedHost ? relocatedHost.entryPath : entryPath
      const child = fork(
        forkEntryPath,
        [
          '--socket',
          socketPath,
          '--token',
          tokenPath,
          '--pid-record',
          pidPath,
          '--launch-nonce',
          launchNonce,
          ...(macosLoginSessionWatch ? ['--login-session-watch'] : []),
          ...daemonLogArgs()
        ],
        {
          // Why: detached daemons outlive dev worktrees; userData keeps process.cwd() valid after a repo/worktree is deleted.
          cwd: userDataPath,
          // Why: detached+unref outlives Electron; stdout 'ignore' (else blocks exit), stderr 'pipe' captures startup crashes lost in v1.4.129-rc.1.
          detached: true,
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          // Why: run the byte-identical relocated Orca.exe so the image path sits outside the updater's kill zone.
          ...(relocatedHost ? { execPath: relocatedHost.execPath } : {}),
          // Why: run the fork as plain Node so Electron's GPU/display init can't interfere with node-pty's posix_spawn of the spawn-helper.
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            // Why: the detached plain-Node daemon can't call app.getPath(), but shell rcfiles must live outside swept tmp.
            ORCA_USER_DATA_PATH: userDataPath
          }
        }
      )

      // Why: keep only the startup-window stderr tail so a crash cause is visible without unbounded memory.
      const STARTUP_STDERR_MAX_BYTES = 8192
      let startupStderr = ''
      let collectingStderr = true
      const onStartupStderr = (chunk: Buffer): void => {
        if (!collectingStderr) {
          return
        }
        startupStderr += chunk.toString('utf8')
        if (startupStderr.length > STARTUP_STDERR_MAX_BYTES) {
          startupStderr = startupStderr.slice(-STARTUP_STDERR_MAX_BYTES)
        }
      }
      child.stderr?.on('data', onStartupStderr)
      // Why: release the detached daemon's stderr once up/failed — a live piped stream refs the parent loop and blocks Electron exit.
      const releaseStderr = (): void => {
        collectingStderr = false
        child.stderr?.off('data', onStartupStderr)
        child.stderr?.destroy()
      }

      // Wait for the daemon to signal readiness via IPC
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let settled = false
        function cleanupStartupListeners(): void {
          if (timer) {
            clearTimeout(timer)
          }
          child.off('message', onReadyMessage)
          child.off('error', onStartupError)
          child.off('exit', onStartupExit)
        }
        async function fail(error: Error): Promise<void> {
          if (settled) {
            return
          }
          settled = true
          cleanupStartupListeners()
          // Why: attach the captured stderr tail to the thrown error and log it so a startup crash isn't just "exited with code 1".
          const stderrTail = startupStderr.trim()
          if (stderrTail) {
            console.warn(`[daemon] startup failed; captured stderr tail:\n${stderrTail}`)
          }
          releaseStderr()
          const startupError = stderrTail
            ? new Error(`${error.message}\nDaemon stderr (tail):\n${stderrTail}`)
            : error
          try {
            await terminateLaunchedDaemonChild(child)
          } catch (cleanupError) {
            reject(
              new AggregateError(
                [startupError, cleanupError],
                'Daemon startup and child cleanup both failed'
              )
            )
            return
          }
          reject(startupError)
        }
        function onReadyMessage(msg: unknown): void {
          if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ready') {
            if (settled) {
              return
            }
            const readyIdentity = parseDaemonReadyIdentity(msg)
            if (!Number.isSafeInteger(child.pid) || (child.pid as number) <= 0 || !readyIdentity) {
              void fail(new Error('Daemon readiness identity is incomplete'))
              return
            }
            try {
              // Why: pid record shares the daemon's self time and nonce so cleanup can identify this exact process incarnation.
              writeFileSync(
                pidPath,
                serializeDaemonPidFile({
                  pid: child.pid as number,
                  ...readyIdentity,
                  entryPath,
                  appVersion: app.getVersion(),
                  launchNonce
                }),
                { mode: 0o600, flag: 'wx' }
              )
            } catch (error) {
              void fail(error instanceof Error ? error : new Error(String(error)))
              return
            }
            settled = true
            // Why: daemon is detached after readiness; detach startup listeners so the launch promise closure isn't retained.
            cleanupStartupListeners()
            // Why: release IPC/stderr and unref so Electron can exit without waiting; the daemon keeps running detached.
            releaseStderr()
            child.disconnect()
            child.unref()
            resolve()
          }
        }

        function onStartupError(err: Error): void {
          void fail(err)
        }

        function onStartupExit(code: number | null): void {
          void fail(new Error(`Daemon exited during startup with code ${code}`))
        }

        timer = setTimeout(() => {
          void fail(new Error('Daemon startup timed out'))
        }, 10000)

        child.on('message', onReadyMessage)
        child.on('error', onStartupError)
        child.on('exit', onStartupExit)
      })

      try {
        return await holdDaemonAdoptionLease(
          {
            shutdown: () => terminateLaunchedDaemonChild(child)
          },
          socketPath,
          tokenPath
        )
      } catch (error) {
        // Why: another client may have adopted this live process; keep its pid record until exit, but remove one published after an early exit.
        let pidRecordRemoved = false
        const removeExitedPidRecord = (): void => {
          if (pidRecordRemoved) {
            return
          }
          pidRecordRemoved = true
          unlinkOwnedDaemonPidFile(pidPath, child.pid as number, launchNonce)
        }
        child.once('exit', removeExitedPidRecord)
        if (
          (child.exitCode !== null && child.exitCode !== undefined) ||
          (child.signalCode !== null && child.signalCode !== undefined)
        ) {
          child.off('exit', removeExitedPidRecord)
          removeExitedPidRecord()
        }
        throw error
      }
    } catch (error) {
      adoptionClient?.disconnect()
      throw error
    }
  }
}
