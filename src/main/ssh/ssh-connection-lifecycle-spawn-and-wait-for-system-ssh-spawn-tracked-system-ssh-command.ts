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

export const SshConnectionMethods7 = {
  async spawnAndWaitForSystemSsh(this: any, connectGeneration: number): Promise<SystemSshProcess> {
    if (!this.isCurrentConnectAttempt(connectGeneration)) {
      throw this.createCancelledConnectAttemptError()
    }
    const proc = spawnSystemSsh(this.target, this.getSystemSshBuildArgsOptions())
    this.systemSsh = proc
    let settled = false
    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>
      const clearCurrentProcess = (): void => {
        if (this.systemSsh === proc) {
          this.systemSsh = null
        }
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        proc.stdout.off('data', onReady)
      }
      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const cancelStartup = (): void => {
        clearCurrentProcess()
        proc.kill()
        reject(this.createCancelledConnectAttemptError())
      }
      const onReady = (): void => {
        // Why: direct system SSH has the same late-ready race as ssh2; disconnect/reconnect must own the generation before state flips.
        if (!this.isCurrentConnectAttempt(connectGeneration)) {
          settle(cancelStartup)
          return
        }
        settle(resolve)
      }
      timeout = setTimeout(() => {
        settle(() => {
          clearCurrentProcess()
          proc.kill()
          reject(new Error('System SSH connection timed out'))
        })
      }, CONNECT_TIMEOUT_MS)
      proc.stdout.once('data', onReady)
      proc.onExit((code) => {
        if (settled) {
          return
        }
        settle(() => {
          clearCurrentProcess()
          if (!this.isCurrentConnectAttempt(connectGeneration)) {
            reject(this.createCancelledConnectAttemptError())
            return
          }
          reject(
            new Error(
              code !== 0
                ? `System SSH exited with code ${code}`
                : 'System SSH exited before producing output'
            )
          )
        })
      })
    })
    if (!this.isCurrentConnectAttempt(connectGeneration)) {
      if (this.systemSsh === proc) {
        this.systemSsh = null
      }
      proc.kill()
      throw this.createCancelledConnectAttemptError()
    }
    return proc
  }
  isCurrentConnectAttempt(this: any, connectGeneration: number): boolean {
    return !this.disposed && connectGeneration === this.connectGeneration
  }
  createCancelledConnectAttemptError(this: any): Error {
    return new Error('SSH connection attempt was cancelled')
  }
  spawnTrackedSystemSshCommand(this: any, command: string, options?: SshExecOptions): ClientChannel {
    if (options?.signal?.aborted) {
      throw createSshOperationAbortError()
    }
    const buildArgsOptions = this.getSystemSshBuildArgsOptions()
    const commandOptions =
      options === undefined && Object.keys(buildArgsOptions).length === 0
        ? undefined
        : { ...options, ...buildArgsOptions }
    const channel =
      commandOptions === undefined
        ? spawnSystemSshCommand(this.target, command)
        : spawnSystemSshCommand(this.target, command, commandOptions)
    this.systemCommandChannels.add(channel)
    const onAbort = (): void => {
      channel.close()
    }
    const cleanup = (): void => {
      options?.signal?.removeEventListener('abort', onAbort)
      this.systemCommandChannels.delete(channel)
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    channel.once('close', cleanup)
    channel.once('error', cleanup)
    return channel
  }
}
export type SshConnectionMethods7Surface = typeof SshConnectionMethods7
