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

import { SshConnectionMethods1, type SshConnectionMethods1Surface } from './ssh-connection-lifecycle-get-state-can-run-concurrent-exec-commands'
import { SshConnectionMethods2, type SshConnectionMethods2Surface } from './ssh-connection-lifecycle-get-target-set-callbacks'
import { SshConnectionMethods3, type SshConnectionMethods3Surface } from './ssh-connection-lifecycle-has-cached-credential-open-session-channel-with-retry'
import { SshConnectionMethods4, type SshConnectionMethods4Surface } from './ssh-connection-lifecycle-wait-for-ssh-callback-open-file-upload-session'
import { SshConnectionMethods5, type SshConnectionMethods5Surface } from './ssh-connection-lifecycle-write-file-attempt-connect'
import { SshConnectionMethods6, type SshConnectionMethods6Surface } from './ssh-connection-lifecycle-reconnect-spawn-system-ssh-with-control-master-retry'
import { SshConnectionMethods7, type SshConnectionMethods7Surface } from './ssh-connection-lifecycle-spawn-and-wait-for-system-ssh-spawn-tracked-system-ssh-command'
import { SshConnectionMethods8, type SshConnectionMethods8Surface } from './ssh-connection-lifecycle-get-system-ssh-build-args-options-setup-disconnect-handler'
import { SshConnectionMethods9, type SshConnectionMethods9Surface } from './ssh-connection-lifecycle-schedule-reconnect-connect-via-system-ssh'
import { SshConnectionMethods10, type SshConnectionMethods10Surface } from './ssh-connection-lifecycle-disconnect-set-state'

export * from './ssh-connection-lifecycle-foundation'

export class SshConnection {

  private client: SshClient | null = null
  private proxyProcess: ChildProcess | null = null
  private systemSsh: SystemSshProcess | null = null
  private systemCommandChannels = new Set<ClientChannel>()
  private systemOperationAbortController = new AbortController()
  private systemSshResolvedConfig: SshResolvedConfig | null = null
  private systemSshControlMasterDisabledForSession = false
  private systemSshGssapiOnlyForSession = false
  private useSystemSshTransport = false
  private state: SshConnectionState
  private callbacks: SshConnectionCallbacks
  private target: SshTarget
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private cachedPassphrase: string | null = null
  private cachedPassword: string | null = null
  private hostKeyFingerprint: string | undefined
  private connectGeneration = 0


  constructor(target: SshTarget, callbacks: SshConnectionCallbacks) {
    this.target = target
    this.callbacks = callbacks
    this.state = {
      targetId: target.id,
      status: 'disconnected',
      error: null,
      reconnectAttempt: 0,
      supportsFolderDownload: false
    }
  }
}

export interface SshConnection extends SshConnectionMethods1Surface, SshConnectionMethods2Surface, SshConnectionMethods3Surface, SshConnectionMethods4Surface, SshConnectionMethods5Surface, SshConnectionMethods6Surface, SshConnectionMethods7Surface, SshConnectionMethods8Surface, SshConnectionMethods9Surface, SshConnectionMethods10Surface {}

Object.assign(SshConnection.prototype, SshConnectionMethods1, SshConnectionMethods2, SshConnectionMethods3, SshConnectionMethods4, SshConnectionMethods5, SshConnectionMethods6, SshConnectionMethods7, SshConnectionMethods8, SshConnectionMethods9, SshConnectionMethods10)


export function shouldUseSystemSshTransport(
  target: SshTarget,
  resolved: Pick<SshResolvedConfig, 'proxyUseFdpass' | 'proxyCommand' | 'proxyJump'> | null
): boolean {
  if (isOpenSshConfigBackedTarget(target) && resolved) {
    return (
      process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT === '1' ||
      resolved.proxyUseFdpass === true ||
      resolved.proxyCommand != null ||
      resolved.proxyJump != null
    )
  }
  return (
    process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT === '1' ||
    target.proxyCommand != null ||
    target.jumpHost != null ||
    resolved?.proxyUseFdpass === true ||
    resolved?.proxyCommand != null ||
    resolved?.proxyJump != null
  )
}
