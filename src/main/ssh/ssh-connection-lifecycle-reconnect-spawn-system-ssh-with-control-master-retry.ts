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

export const SshConnectionMethods6 = {
  async reconnect(this: any): Promise<void> {
    if (this.disposed || this.state.status === 'connecting') {
      return
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Why: OS sleep/wake can leave ssh2 thinking a dead TCP socket is still connected; tear down and reconnect so the relay can reattach remote PTYs.
    this.closeTransportsForReconnect()
    this.state.reconnectAttempt = 0
    this.setState('reconnecting')
    await this.runReconnectAttempt(0)
  }
  async doSystemSshProbe(this: any, connectGeneration: number): Promise<void> {
    this.useSystemSshTransport = true
    this.client = null
    this.proxyProcess?.kill()
    this.proxyProcess = null

    // Why: this probe runs before remote platform detection; a raw echo works under POSIX shells, cmd.exe, and PowerShell, but `/bin/sh` wrapping does not.
    const channel = this.spawnTrackedSystemSshCommand('echo ORCA-SYSTEM-SSH-OK', {
      wrapCommand: false
    })
    try {
      await new Promise<void>((resolve, reject) => {
        let stdout = ''
        let stderr = ''
        let settled = false
        const cleanup = (): void => {
          clearTimeout(timeout)
          channel.off('data', onStdoutData)
          channel.stderr.off('data', onStderrData)
          channel.off('error', onError)
          channel.off('close', onClose)
          this.systemCommandChannels.delete(channel)
        }
        const settle = (callback: () => void): void => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          callback()
        }
        const onStdoutData = (data: Buffer): void => {
          stdout += data.toString('utf-8')
        }
        const onStderrData = (data: Buffer): void => {
          stderr += data.toString('utf-8')
        }
        const onError = (err: Error): void => {
          settle(() => reject(err))
        }
        const onClose = (code: number | null): void => {
          settle(() => {
            if (this.disposed || connectGeneration !== this.connectGeneration) {
              reject(new Error('SSH connection attempt was cancelled'))
              return
            }
            if (
              (code === 0 && stdout.includes('ORCA-SYSTEM-SSH-OK')) ||
              isGitHubRestrictedShellProbeSuccess(
                this.target,
                this.systemSshResolvedConfig,
                code,
                stderr
              )
            ) {
              this.setState('connected')
              resolve()
              return
            }
            reject(
              new Error(
                `System SSH probe failed${code != null ? ` (exit ${code})` : ''}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`
              )
            )
          })
        }
        const timeout = setTimeout(() => {
          settle(() => {
            channel.close()
            reject(new Error('System SSH connection timed out'))
          })
        }, CONNECT_TIMEOUT_MS)

        channel.on('data', onStdoutData)
        channel.stderr.on('data', onStderrData)
        channel.on('error', onError)
        channel.on('close', onClose)
      })
    } catch (err) {
      this.useSystemSshTransport = false
      this.systemSshResolvedConfig = null
      throw err
    }
  }
  async doSystemSshProbeWithControlMasterRetry(this: any,
    connectGeneration: number,
    resolved: SshResolvedConfig | null,
    gssapiOnly = false
  ): Promise<void> {
    this.systemSshResolvedConfig = cloneResolvedConfig(resolved)
    this.systemSshControlMasterDisabledForSession = false
    this.systemSshGssapiOnlyForSession = gssapiOnly
    const controlPath = getOrcaControlSocketPath(this.target, {
      resolvedConfig: this.systemSshResolvedConfig,
      gssapiOnly: this.systemSshGssapiOnlyForSession
    })
    try {
      await this.doSystemSshProbe(connectGeneration)
    } catch (err) {
      if (!controlPath || this.disposed || connectGeneration !== this.connectGeneration) {
        throw err
      }
      removeControlSocketPath(controlPath)
      this.systemSshResolvedConfig = cloneResolvedConfig(resolved)
      this.systemSshControlMasterDisabledForSession = true
      try {
        await this.doSystemSshProbe(connectGeneration)
      } catch (retryErr) {
        this.systemSshControlMasterDisabledForSession = false
        throw retryErr
      }
    }
  }
  async spawnSystemSshWithControlMasterRetry(this: any,
    controlPath: string | null,
    connectGeneration: number
  ): Promise<SystemSshProcess> {
    try {
      return await this.spawnAndWaitForSystemSsh(connectGeneration)
    } catch (err) {
      if (!this.isCurrentConnectAttempt(connectGeneration)) {
        throw this.createCancelledConnectAttemptError()
      }
      if (!controlPath) {
        throw err
      }
      removeControlSocketPath(controlPath)
      this.systemSshControlMasterDisabledForSession = true
      if (!this.isCurrentConnectAttempt(connectGeneration)) {
        throw this.createCancelledConnectAttemptError()
      }
      try {
        return await this.spawnAndWaitForSystemSsh(connectGeneration)
      } catch (retryErr) {
        if (this.isCurrentConnectAttempt(connectGeneration)) {
          this.systemSshControlMasterDisabledForSession = false
        }
        throw retryErr
      }
    }
  }
}
export type SshConnectionMethods6Surface = typeof SshConnectionMethods6
