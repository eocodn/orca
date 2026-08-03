import { getOrcaControlSocketPath, type SystemSshProcess } from './ssh-system-fallback'
import { resolveWithSshG } from './ssh-config-parser'
import { RECONNECT_BACKOFF_MS, isTransientError, isAuthError, isPassphraseError } from './ssh-connection-utils'
import { cloneResolvedConfig } from './ssh-connection-lifecycle-foundation'

export const SshConnectionMethods9 = {
  scheduleReconnect(this: any): void {
    if (this.disposed || this.reconnectTimer) {
      return
    }
    const attempt = this.state.reconnectAttempt
    if (attempt >= RECONNECT_BACKOFF_MS.length) {
      this.setState('reconnection-failed', 'Max reconnection attempts reached')
      return
    }
    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.disposed) {
        return
      }
      await this.runReconnectAttempt(attempt)
    }, RECONNECT_BACKOFF_MS[attempt])
  },
  async runReconnectAttempt(this: any, attempt: number): Promise<void> {
    try {
      // Why: reset before connecting so the 'connected' broadcast carries reconnectAttempt=0, which ssh.ts uses to trigger relay re-establishment.
      this.state.reconnectAttempt = 0
      await this.attemptConnect()
    } catch (err) {
      if (this.disposed) {
        return
      }
      const error = err instanceof Error ? err : new Error(String(err))
      if (isAuthError(error) || isPassphraseError(error)) {
        this.setState('auth-failed', error.message)
        return
      }
      if (!isTransientError(error)) {
        this.setState('error', error.message)
        return
      }
      this.state.reconnectAttempt = attempt + 1
      this.scheduleReconnect()
    }
  },
  closeTransportsForReconnect(this: any): void {
    this.connectGeneration += 1
    const client = this.client
    this.client = null
    try {
      client?.end()
      client?.destroy()
    } catch {
      /* best-effort transport teardown */
    }
    this.proxyProcess?.kill()
    this.proxyProcess = null
    this.systemOperationAbortController.abort()
    this.systemOperationAbortController = new AbortController()
    for (const channel of this.systemCommandChannels) {
      channel.close()
    }
    this.systemCommandChannels.clear()
    this.systemSsh?.kill()
    this.systemSsh = null
    this.systemSshResolvedConfig = null
    this.systemSshControlMasterDisabledForSession = false
    this.systemSshGssapiOnlyForSession = false
    this.useSystemSshTransport = false
  },
  async connectViaSystemSsh(this: any): Promise<SystemSshProcess> {
    if (this.disposed) {
      throw new Error('Connection disposed')
    }
    const connectGeneration = ++this.connectGeneration
    this.systemSsh?.kill()
    this.systemSsh = null
    this.systemSshResolvedConfig = null
    this.systemSshControlMasterDisabledForSession = false
    this.systemSshGssapiOnlyForSession = false
    this.useSystemSshTransport = false
    this.setState('connecting')
    try {
      const resolved = await resolveWithSshG(this.target.configHost || this.target.label).catch(
        () => null
      )
      if (!this.isCurrentConnectAttempt(connectGeneration)) {
        throw this.createCancelledConnectAttemptError()
      }
      this.systemSshResolvedConfig = cloneResolvedConfig(resolved)
      const controlPath = getOrcaControlSocketPath(this.target, {
        resolvedConfig: this.systemSshResolvedConfig
      })
      const proc = await this.spawnSystemSshWithControlMasterRetry(controlPath, connectGeneration)
      if (!this.isCurrentConnectAttempt(connectGeneration)) {
        if (this.systemSsh === proc) {
          this.systemSsh = null
        }
        proc.kill()
        throw this.createCancelledConnectAttemptError()
      }
      this.systemSsh = proc
      this.useSystemSshTransport = true
      this.setState('connected')
      // Why: register the reconnect handler only after handshake succeeds (the onExit above guards with `settled`).
      proc.onExit(() => {
        if (!this.disposed && this.systemSsh === proc) {
          this.systemSsh = null
          this.scheduleReconnect()
        }
      })
      return proc
    } catch (err) {
      if (!this.isCurrentConnectAttempt(connectGeneration)) {
        throw err
      }
      this.useSystemSshTransport = false
      this.systemSshResolvedConfig = null
      this.systemSshControlMasterDisabledForSession = false
      this.systemSshGssapiOnlyForSession = false
      this.setState('error', err instanceof Error ? err.message : String(err))
      throw err
    }
  }
}
export type SshConnectionMethods9Surface = typeof SshConnectionMethods9
