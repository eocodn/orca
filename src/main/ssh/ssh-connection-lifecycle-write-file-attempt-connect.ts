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

export const SshConnectionMethods5 = {
  async writeFile(this: any,
    remotePath: string,
    contents: string,
    options?: SshRemoteFileOptions & { signal?: AbortSignal }
  ): Promise<void> {
    // Keep package/version writes under the same dual cancellation contract as uploads.
    const linkedSignal = createLinkedSshFileTransferSignal(
      [this.systemOperationAbortController.signal, options?.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined
      )
    )
    try {
      if (!this.useSystemSshTransport) {
        const sftp = await this.sftp(linkedSignal.signal)
        const swallowLateSftpError = (): void => {}
        let sftpEndRequested = false
        const endSftp = (): void => {
          if (!sftpEndRequested) {
            sftpEndRequested = true
            sftp.end()
          }
        }
        sftp.on('error', swallowLateSftpError)
        sftp.once('close', () => sftp.removeListener('error', swallowLateSftpError))
        try {
          // Why: resolve on the same session that writes — a later session is not authoritative for this one's namespace.
          const write = (async (): Promise<void> => {
            const targetPath = await resolveSftpTransferPathIfMapped(sftp, remotePath, options)
            linkedSignal.signal.throwIfAborted()
            const { writeStringViaSftp } = await import('./sftp-upload')
            await writeStringViaSftp(sftp, targetPath, contents)
          })()
          await raceSftpFileTransferWithAbort(write, linkedSignal.signal, (onClose) => {
            sftp.once('close', onClose)
            endSftp()
          })
        } finally {
          endSftp()
        }
        return
      }
      await writeFileViaSystemSsh(this.target, remotePath, contents, {
        signal: linkedSignal.signal,
        hostPlatform: options?.hostPlatform,
        ...this.getSystemSshBuildArgsOptions()
      })
    } finally {
      linkedSignal.dispose()
    }
  }
  async writeBuffer(this: any,
    remotePath: string,
    contents: Buffer,
    options?: SshRemoteFileOptions & { append?: boolean; exclusive?: boolean }
  ): Promise<void> {
    if (!this.useSystemSshTransport) {
      const sftp = await this.sftp()
      try {
        const { uploadBuffer } = await import('./sftp-upload')
        await uploadBuffer(sftp, contents, remotePath, options)
      } finally {
        sftp.end()
      }
      return
    }
    await writeBufferViaSystemSsh(this.target, remotePath, contents, {
      signal: this.systemOperationAbortController.signal,
      hostPlatform: options?.hostPlatform,
      append: options?.append,
      exclusive: options?.exclusive,
      ...this.getSystemSshBuildArgsOptions()
    })
  }
  async connect(this: any): Promise<void> {
    if (this.disposed) {
      throw new Error('Connection disposed')
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < INITIAL_RETRY_ATTEMPTS; attempt++) {
      try {
        await this.attemptConnect()
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // Why: a concurrent disconnect() already set 'disconnected'; a cancelled attempt's late error must not overwrite it with auth-failed/error.
        if (this.disposed) {
          throw lastError
        }

        if (isAuthError(lastError) || isPassphraseError(lastError)) {
          this.setState('auth-failed', lastError.message)
          throw lastError
        }

        if (!isTransientError(lastError)) {
          this.setState('error', lastError.message)
          throw lastError
        }

        if (attempt < INITIAL_RETRY_ATTEMPTS - 1) {
          await sleep(INITIAL_RETRY_DELAY_MS)
        }
      }
    }

    const finalError = lastError ?? new Error('Connection failed')
    this.setState('error', finalError.message)
    throw finalError
  }
  async attemptConnect(this: any): Promise<void> {
    this.setState('connecting')
    this.proxyProcess?.kill()
    this.proxyProcess = null
    const connectGeneration = ++this.connectGeneration

    const resolved = await resolveWithSshG(this.target.configHost || this.target.label).catch(
      () => null
    )
    if (shouldUseSystemSshTransport(this.target, resolved)) {
      await this.doSystemSshProbeWithControlMasterRetry(connectGeneration, resolved)
      return
    }
    // Why: ssh2 lacks gssapi-with-mic; GSSAPIAuthentication hosts try Kerberos SSO via system OpenSSH first, then fall through to key/credential auth.
    if (
      isOpenSshConfigBackedTarget(this.target) && resolved
        ? resolved.gssapiAuthentication === true
        : this.target.gssapiAuthentication === true
    ) {
      try {
        await this.doSystemSshProbeWithControlMasterRetry(connectGeneration, resolved, true)
        return
      } catch (probeErr) {
        if (this.disposed || !this.isCurrentConnectAttempt(connectGeneration)) {
          throw probeErr
        }
      }
    }
    // Why: a synchronous spawn throw bypasses the probe's catch, so clear system-transport state here or exec/sftp keep routing through the failed transport.
    this.systemSshResolvedConfig = null
    this.systemSshControlMasterDisabledForSession = false
    this.systemSshGssapiOnlyForSession = false
    this.useSystemSshTransport = false

    const config = buildConnectConfig(this.target, resolved)

    // Why: ssh2 doesn't support ProxyCommand/ProxyJump natively; spawn the resolved proxy and pipe its stdin/stdout as config.sock.
    const effectiveProxy = resolveEffectiveProxy(this.target, resolved)
    if (effectiveProxy) {
      const proxy = spawnProxyCommand(effectiveProxy, config.host!, config.port!, config.username!)
      this.proxyProcess = proxy.process
      config.sock = proxy.sock
    }

    if (this.cachedPassphrase) {
      config.passphrase = this.cachedPassphrase
    }
    if (this.cachedPassword) {
      config.password = this.cachedPassword
    }

    try {
      await this.doSsh2Connect(config, connectGeneration)
    } catch (err) {
      if (!(err instanceof Error)) {
        this.proxyProcess?.kill()
        this.proxyProcess = null
        throw err
      }

      if (isSystemSshFallbackError(err)) {
        this.proxyProcess?.kill()
        this.proxyProcess = null
        try {
          // Why: on macOS, per-app network policy can block Orca's direct TCP socket while the system OpenSSH binary is still allowed.
          await this.doSystemSshProbeWithControlMasterRetry(connectGeneration, resolved)
          return
        } catch {
          this.systemSshResolvedConfig = null
          this.systemSshControlMasterDisabledForSession = false
          this.systemSshGssapiOnlyForSession = false
          this.useSystemSshTransport = false
          throw err
        }
      }

      let authError = err
      let passphrasePromptHandled = false
      let credentialRetryConfig = config

      // Why: ssh2 parses encrypted privateKey before agent auth; when an agent exists, let it try first and fall back to direct key parsing only if it fails.
      if (isAgentFallbackError(authError) && config.agent && !config.privateKey) {
        const keyConfig = buildConnectConfig(this.target, resolved, {
          includeAgent: false,
          includePrivateKey: true
        })
        // Why: if the agent path failed, password/passphrase retries must not reuse the same agent-only config.
        credentialRetryConfig = keyConfig
        if (this.cachedPassphrase) {
          keyConfig.passphrase = this.cachedPassphrase
        }
        if (this.cachedPassword) {
          keyConfig.password = this.cachedPassword
        }
        if (keyConfig.privateKey || keyConfig.password) {
          this.respawnProxy(keyConfig, effectiveProxy)
          try {
            await this.doSsh2Connect(keyConfig, connectGeneration)
            return
          } catch (keyErr) {
            if (!(keyErr instanceof Error)) {
              this.proxyProcess?.kill()
              this.proxyProcess = null
              throw keyErr
            }
            authError = keyErr
            const passphraseKeyPath = getPassphrasePrivateKeyPath(keyConfig)
            // Why: with GSSAPI enabled, let the reactive system-ssh probe try a Kerberos ticket before prompting for the passphrase; the prompt still runs if it fails.
            if (
              (isPassphraseError(authError) || passphraseKeyPath) &&
              !this.cachedPassphrase &&
              !isGssapiSystemSshFallbackCandidate(authError, this.target, resolved)
            ) {
              passphrasePromptHandled = true
              const detail =
                passphraseKeyPath ||
                this.target.identityFile ||
                resolved?.identityFile?.[0] ||
                '(unknown)'
              const val = await this.callbacks.onCredentialRequest?.(
                this.target.id,
                'passphrase',
                detail
              )
              if (val) {
                this.cachedPassphrase = val
                keyConfig.passphrase = val
                this.respawnProxy(keyConfig, effectiveProxy)
                await this.doSsh2Connect(keyConfig, connectGeneration)
                return
              }
            }
          }
        }
      }

      // Why: a Kerberos ticket may authenticate where keys did not; try the system ssh binary before falling back to interactive prompts.
      if (isGssapiSystemSshFallbackCandidate(authError, this.target, resolved)) {
        this.proxyProcess?.kill()
        this.proxyProcess = null
        try {
          await this.doSystemSshProbeWithControlMasterRetry(connectGeneration, resolved, true)
          return
        } catch {
          this.systemSshResolvedConfig = null
          this.systemSshControlMasterDisabledForSession = false
          this.systemSshGssapiOnlyForSession = false
          this.useSystemSshTransport = false
        }
        // Why: if a disconnect/reconnect superseded this attempt mid-probe, throw the cancellation error (not the stale authError) so connect() doesn't post auth-failed.
        if (this.disposed || !this.isCurrentConnectAttempt(connectGeneration)) {
          throw this.createCancelledConnectAttemptError()
        }
      }

      if (!this.callbacks.onCredentialRequest) {
        this.proxyProcess?.kill()
        this.proxyProcess = null
        throw authError
      }

      // Why: prompt for passphrase on encrypted-key error, then retry with a fresh proxy socket (ssh2 may have destroyed the original).
      const passphraseKeyPath = getPassphrasePrivateKeyPath(credentialRetryConfig)
      if (
        (isPassphraseError(authError) || passphraseKeyPath) &&
        !this.cachedPassphrase &&
        !passphrasePromptHandled
      ) {
        const detail =
          passphraseKeyPath ||
          this.target.identityFile ||
          resolved?.identityFile?.[0] ||
          '(unknown)'
        const val = await this.callbacks.onCredentialRequest(this.target.id, 'passphrase', detail)
        if (val) {
          this.cachedPassphrase = val
          credentialRetryConfig.passphrase = val
          this.respawnProxy(credentialRetryConfig, effectiveProxy)
          await this.doSsh2Connect(credentialRetryConfig, connectGeneration)
          return
        }
      }
      // Why: an agent socket failure can still be recovered by password auth, but the retry must use the no-agent config selected above.
      if (isAgentFallbackError(authError) && !this.cachedPassword) {
        const val = await this.callbacks.onCredentialRequest(
          this.target.id,
          'password',
          config.host || this.target.label
        )
        if (val) {
          this.cachedPassword = val
          credentialRetryConfig.password = val
          this.respawnProxy(credentialRetryConfig, effectiveProxy)
          await this.doSsh2Connect(credentialRetryConfig, connectGeneration)
          return
        }
      }
      this.proxyProcess?.kill()
      this.proxyProcess = null
      throw authError
    }
  }
}
export type SshConnectionMethods5Surface = typeof SshConnectionMethods5
