import * as net from 'node:net'
import { createHash } from 'node:crypto'
import { Client as SshClient } from 'ssh2'
import type { ChildProcess } from 'node:child_process'
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import type { SshTarget, SshConnectionState, SshConnectionStatus } from '../../shared/ssh-types'
import {
  getOrcaControlSocketPath,
  spawnSystemSsh,
  spawnSystemSshCommand,
  downloadFileViaSystemSsh,
  uploadDirectoryViaSystemSsh,
  uploadFileViaSystemSsh,
  writeBufferViaSystemSsh,
  writeFileViaSystemSsh,
  type SystemSshBuildArgsOptions,
  type SystemSshProcess
} from './ssh-system-fallback'
import { resolveWithSshG, type SshResolvedConfig } from './ssh-config-parser'
import { removeControlSocketPath } from './ssh-control-socket'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'
import {
  INITIAL_RETRY_ATTEMPTS,
  INITIAL_RETRY_DELAY_MS,
  RECONNECT_BACKOFF_MS,
  CONNECT_TIMEOUT_MS,
  isTransientError,
  isAuthError,
  isAgentFallbackError,
  isSystemSshFallbackError,
  isGssapiSystemSshFallbackCandidate,
  isPassphraseError,
  sleep,
  buildConnectConfig,
  resolveEffectiveProxy,
  spawnProxyCommand,
  wrapRemoteCommandForPosixShell,
  createSshOperationAbortError,
  type SshExecOptions,
  type SshConnectionCallbacks
} from './ssh-connection-utils'
import { getPassphrasePrivateKeyPath } from './ssh-private-key-authentication'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import {
  resolveSftpTransferPathIfMapped,
  type SftpNamespacePathMapping
} from './sftp-namespace-resolution'
import type { FileUploadSession } from '../providers/types'
import { isSshSessionLimitError } from './ssh-session-limit-error'
import {
  createLinkedSshFileTransferSignal,
  raceSftpFileTransferWithAbort
} from './ssh-file-transfer-abort'
import * as foundation from './ssh-connection-lifecycle-foundation'
const { ABORTED_CHANNEL_CLOSE_GRACE_MS, SESSION_LIMIT_OPEN_RETRIES, SESSION_LIMIT_OPEN_RETRY_DELAY_MS, cloneResolvedConfig, isGitHubRestrictedShellProbeSuccess } = foundation
type SshRemoteFileOptions = foundation.SshRemoteFileOptions

export const SshConnectionMethods8 = {
  getSystemSshBuildArgsOptions(this: any): SystemSshBuildArgsOptions {
    const options: SystemSshBuildArgsOptions = {}
    if (this.systemSshResolvedConfig) {
      options.resolvedConfig = this.systemSshResolvedConfig
    }
    if (this.systemSshControlMasterDisabledForSession) {
      options.disableControlMaster = true
    }
    if (this.systemSshGssapiOnlyForSession) {
      options.gssapiOnly = true
    }
    return options
  },
  respawnProxy(this: any,
    config: ConnectConfig,
    proxy: ReturnType<typeof resolveEffectiveProxy> | null | undefined
  ): void {
    if (!proxy) {
      return
    }
    this.proxyProcess?.kill()
    const p = spawnProxyCommand(proxy, config.host!, config.port!, config.username!)
    this.proxyProcess = p.process
    config.sock = p.sock
  },
  doSsh2Connect(this: any, config: ConnectConfig, connectGeneration: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const client = new SshClient()
      let settled = false

      // Why: the relay uses the negotiated server key to isolate shared-home
      // install locks without comparing PIDs from an unrelated SSH host.
      config.hostVerifier = (key: Buffer): boolean => {
        if (!this.disposed && connectGeneration === this.connectGeneration) {
          const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
          this.hostKeyFingerprint = `SHA256:${digest}`
        }
        return true
      }

      const cleanupStartupListeners = (): void => {
        client.off('ready', onReady)
        client.off('error', onStartupError)
      }
      const swallowLateStartupError = (): void => {
        // Why: ssh2 can emit another socket error while destroying a settled pre-handshake client.
      }
      const guardStartupDestroy = (): void => {
        client.on('error', swallowLateStartupError)
      }

      const onReady = (): void => {
        if (settled) {
          return
        }
        // Why: connect() completion races with disconnect(); a late ready must not resurrect a torn-down client after generation/disposed changes.
        if (this.disposed || connectGeneration !== this.connectGeneration) {
          settled = true
          guardStartupDestroy()
          cleanupStartupListeners()
          client.end()
          client.destroy()
          reject(new Error('SSH connection attempt was cancelled'))
          return
        }
        settled = true
        this.client = client
        this.proxyProcess = null
        this.setupDisconnectHandler(client)
        cleanupStartupListeners()
        // Why: ssh2 leaves Nagle on; enable TCP_NODELAY so keystrokes don't stack with delayed-ACK (~40ms each). No-op for proxy sockets.
        const sock = (client as unknown as { _sock?: { setNoDelay?: unknown } })._sock
        if (sock instanceof net.Socket) {
          console.warn(`[ssh] TCP_NODELAY enabled for ${this.target.label}`)
        } else {
          console.warn(`[ssh] TCP_NODELAY skipped for ${this.target.label} (proxy socket)`)
        }
        client.setNoDelay(true)
        this.setState('connected')
        resolve()
      }

      const onStartupError = (err: Error): void => {
        if (settled) {
          return
        }
        guardStartupDestroy()
        cleanupStartupListeners()
        settled = true
        client.destroy()
        reject(err)
      }

      client.on('ready', onReady)
      client.on('error', onStartupError)
      client.connect(config)
    })
  },
  setupDisconnectHandler(this: any, client: SshClient): void {
    const onDrop = () => {
      if (this.disposed || this.client !== client) {
        return
      }
      this.client = null
      this.scheduleReconnect()
    }
    client.on('end', onDrop)
    client.on('close', onDrop)
    client.on('error', (err) => {
      if (this.disposed || this.client !== client) {
        return
      }
      console.warn(`[ssh] Connection error for ${this.target.label}: ${err.message}`)
      this.client = null
      this.scheduleReconnect()
    })
  }
}
export type SshConnectionMethods8Surface = typeof SshConnectionMethods8
