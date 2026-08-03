#!/usr/bin/env node


// Orca Relay — lightweight daemon deployed to remote hosts over SCP and launched via an SSH exec channel.
// Communicates over stdin/stdout using the framed JSON-RPC protocol.
// On client disconnect it enters a grace period, keeping PTYs alive on a Unix domain socket; a later launch
// reconnects via `relay.js --connect`, bridging the new SSH channel's stdio to the existing relay's socket.

import { createServer, createConnection, type Socket, type Server } from 'node:net'
import { join } from 'node:path'
import { unlinkSync, existsSync, statSync, readFileSync, chmodSync } from 'node:fs'
import {
  RELAY_SENTINEL,
  FrameDecoder,
  MessageType,
  encodeJsonRpcFrame,
  parseJsonRpcMessage,
  type DecodedFrame,
  type JsonRpcResponse
} from './protocol'
import { readLaunchVersion, runConnectHandshake, setupDaemonHandshake } from './relay-handshake'
import { RelayDispatcher } from './dispatcher'
import { RelayContext, expandTilde } from './context'
import { PtyHandler } from './pty-handler'
import { FsHandler } from './fs-handler'
import { installRelayLogRotation } from './rotating-log-writer'
import { GitHandler } from './git-handler'
import { PreflightHandler } from './preflight-handler'
import { ExternalAutomationsHandler } from './external-automations-handler'
import { PortScanHandler } from './port-scan-handler'
import { AgentExecHandler } from './agent-exec-handler'
import { WorkspaceSessionHandler } from './workspace-session-handler'
import { endpointDirForRelaySocket, RelayAgentHookServer } from './agent-hook-server'
import { PluginOverlayManager } from './plugin-overlay'
import {
  AGENT_HOOK_INSTALL_PLUGINS_METHOD,
  AGENT_HOOK_NOTIFICATION_METHOD,
  AGENT_HOOK_REQUEST_REPLAY_METHOD
} from '../shared/agent-hook-relay'
import {
  DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD
} from '../shared/ssh-types'
import { assertPluginSourceUnderByteCap } from './plugin-source-limit'
import { resolveOpenCodeSourceConfigDir, resolvePiSourceAgentDir } from './plugin-overlay-env'
import {
  detectExplicitPiAgentKindFromCommand,
  isPiCompatibleAgentType
} from '../shared/pi-agent-kind'
import { resolveSetupAgentSequenceLaunchCommand } from '../shared/setup-agent-sequencing'
import { pickRemoteCliEnv } from './remote-cli-env'
import { relayLogLine } from './relay-diagnostic-log'
import { remoteCliRequestTimeoutMs } from './remote-cli-timeout'
import { shouldReadRemoteCliStdin } from './remote-cli-stdin'
import { registerManagedHookInstaller } from './managed-hook-installer'
import { registerRelayPluginHostCallHandlers } from './plugin-host-call-handler'
import { DispatcherClientWriter } from './dispatcher-client-writer'
import { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'
import { RelayPtySourcePublication } from './relay-pty-source-publication'

const DEFAULT_GRACE_MS = DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS * 1000
const SOCK_NAME = 'relay.sock'
const CONNECT_TIMEOUT_MS = 5_000
const STALE_SOCKET_PROBE_TIMEOUT_MS = 500
const EMPTY_DETACHED_STARTUP_GRACE_MS = parseNonNegativeIntEnv(
  'ORCA_RELAY_EMPTY_STARTUP_GRACE_MS',
  60_000
)

type SocketIdentity = {
  dev: bigint
  ino: bigint
  ctimeNs: bigint
}

function sameSocketIdentity(a: SocketIdentity, b: SocketIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs
}

function parseNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function readSocketIdentity(sockPath: string): SocketIdentity | null {
  if (isWindowsNamedPipePath(sockPath)) {
    return null
  }
  try {
    const stat = statSync(sockPath, { bigint: true })
    return { dev: stat.dev, ino: stat.ino, ctimeNs: stat.ctimeNs }
  } catch {
    return null
  }
}

function isWindowsNamedPipePath(sockPath: string): boolean {
  return process.platform === 'win32' && /^\\\\[.?]\\pipe\\/i.test(sockPath)
}

function parseArgs(argv: string[]): {
  graceTimeMs: number
  connectMode: boolean
  detached: boolean
  cliMode: boolean
  sockPath: string
  endpointDir?: string
  logFile?: string
  credentialFile?: string
} {
  let graceTimeMs = DEFAULT_GRACE_MS
  let connectMode = false
  let detached = false
  let cliMode = false
  let sockPath = ''
  let endpointDir: string | undefined
  let logFile: string | undefined
  let credentialFile: string | undefined
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--grace-time' && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10)
      // Why: flag is seconds (internally ms); 0 keeps the relay alive until explicitly terminated for synced workspaces.
      if (!Number.isNaN(parsed) && parsed >= 0) {
        graceTimeMs = parsed * 1000
      }
      i++
    } else if (argv[i] === '--connect') {
      connectMode = true
    } else if (argv[i] === '--orca-cli') {
      cliMode = true
    } else if (argv[i] === '--detached') {
      detached = true
    } else if (argv[i] === '--sock-path' && argv[i + 1]) {
      sockPath = argv[i + 1]
      i++
    } else if (argv[i] === '--endpoint-dir' && argv[i + 1]) {
      endpointDir = argv[i + 1]
      i++
    } else if (argv[i] === '--log-file' && argv[i + 1]) {
      logFile = argv[i + 1]
      i++
    } else if (argv[i] === '--credential-file' && argv[i + 1]) {
      credentialFile = argv[i + 1]
      i++
    }
  }
  if (!sockPath) {
    sockPath = join(process.cwd(), SOCK_NAME)
  }
  return {
    graceTimeMs,
    connectMode,
    detached,
    cliMode,
    sockPath,
    endpointDir,
    logFile,
    credentialFile
  }
}

function readEndpointCredential(credentialFile: string | undefined): string | undefined {
  if (!credentialFile) {
    return undefined
  }
  const credential = readFileSync(credentialFile, 'utf8').trim()
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential)) {
    throw new Error('Relay endpoint credential is missing or invalid')
  }
  if (process.platform !== 'win32') {
    chmodSync(credentialFile, 0o600)
  }
  return credential
}

// ── Connect mode ─────────────────────────────────────────────────────
// Why: --connect bridges a new SSH channel's stdin/stdout to the existing relay's socket so the client keeps talking to the process that owns the live PTYs.

export function runConnectMode(sockPath: string, endpointCredential?: string): void {
  const myVersion = readLaunchVersion()
  const sock = createConnection({ path: sockPath })
  const stdoutWriter = new DispatcherClientWriter(
    (data, onSettled) =>
      process.stdout.write(data, (error) => {
        onSettled(error ? { ok: false, error } : { ok: true })
      }),
    {
      supportsWriteCallback: true,
      writableLength: () => process.stdout.writableLength,
      writableHighWaterMark: () => process.stdout.writableHighWaterMark,
      waitWriteDrain: (callback) => {
        process.stdout.once('drain', callback)
        return () => process.stdout.off('drain', callback)
      }
    },
    () => {
      sock.destroy()
      process.exit(1)
    }
  )

  const connectTimeout = setTimeout(() => {
    process.stderr.write(`[relay-connect] Connection timed out after ${CONNECT_TIMEOUT_MS}ms\n`)
    sock.destroy()
    process.exit(1)
  }, CONNECT_TIMEOUT_MS)

  sock.on('connect', () => {
    clearTimeout(connectTimeout)
    runConnectHandshake(
      sock,
      myVersion,
      {
        onAccepted: (leftover: Buffer) => {
          stdoutWriter.enqueue('control', () => Buffer.from(RELAY_SENTINEL), RELAY_SENTINEL.length)
          if (leftover.length > 0) {
            stdoutWriter.enqueue('control', () => leftover, leftover.length)
          }
          process.stdin.pipe(sock)
          sock.on('data', (data: Buffer) => {
            sock.pause()
            let offset = 0
            const writeNext = (): void => {
              if (offset >= data.length) {
                sock.resume()
                return
              }
              const bytes = Math.min(stdoutWriter.producerFrameCapacity, data.length - offset)
              if (bytes <= 0) {
                stdoutWriter.close(new Error('Relay stdout has no producer capacity'))
                return
              }
              const chunk = data.subarray(offset, offset + bytes)
              if (
                !stdoutWriter.enqueue(
                  'ordinary',
                  () => chunk,
                  chunk.length,
                  (result) => {
                    if (!result.ok) {
                      return
                    }
                    offset += bytes
                    writeNext()
                  }
                )
              ) {
                stdoutWriter.close(new Error('Relay stdout bridge capacity exceeded'))
              }
            }
            writeNext()
          })
        }
      },
      endpointCredential
    )
  })

  // Why: Node swallows EPIPE on stdout, so the bridge would zombie and drop frames; exit on stdout error so the relay enters grace promptly.
  process.stdout.on('error', () => {
    stdoutWriter.close(new Error('Relay stdout closed'))
  })

  sock.on('error', (err) => {
    clearTimeout(connectTimeout)
    process.stderr.write(`[relay-connect] Socket error: ${err.message}\n`)
    process.exit(1)
  })

  sock.on('close', async () => {
    await stdoutWriter.waitForIdle()
    process.exit(0)
  })
}

export async function runOrcaCliMode(
  sockPath: string,
  argv: string[],
  endpointCredential?: string
): Promise<void> {
  const myVersion = readLaunchVersion()
  const stdin = shouldReadRemoteCliStdin(argv) ? await readOrcaCliStdin() : undefined
  const sock = createConnection({ path: sockPath })
  const stdoutWriter = new DispatcherClientWriter(
    (data, onSettled) =>
      process.stdout.write(data, (error) => {
        onSettled(error ? { ok: false, error } : { ok: true })
      }),
    {
      supportsWriteCallback: true,
      writableLength: () => process.stdout.writableLength,
      writableHighWaterMark: () => process.stdout.writableHighWaterMark,
      waitWriteDrain: (callback) => {
        process.stdout.once('drain', callback)
        return () => process.stdout.off('drain', callback)
      }
    },
    () => process.exit(1)
  )
  let nextSeq = 1
  let highestReceivedSeq = 0
  const requestId = 1
  const postOutputRequestId = 2
  let initialExitCode = 0

  const sendRequest = (): void => {
    const env = pickRemoteCliEnv(process.env)
    const frame = encodeJsonRpcFrame(
      {
        jsonrpc: '2.0',
        id: requestId,
        method: 'orca.cli',
        params: {
          argv,
          cwd: process.cwd(),
          env,
          ...(stdin !== undefined ? { stdin } : {})
        }
      },
      nextSeq++,
      highestReceivedSeq
    )
    sock.write(frame)
  }

  const finish = (exitCode: number): void => {
    sock.destroy()
    process.exit(exitCode)
  }

  const sendPostOutput = (postOutput: unknown): void => {
    sock.write(
      encodeJsonRpcFrame(
        {
          jsonrpc: '2.0',
          id: postOutputRequestId,
          method: 'orca.cli.postOutput',
          params: { postOutput, env: pickRemoteCliEnv(process.env) }
        },
        nextSeq++,
        highestReceivedSeq
      )
    )
  }

  const writeOutput = (
    result: { stdout?: unknown; stderr?: unknown },
    onFlushed: (error?: Error) => void
  ): void => {
    let pending = 0
    let completed = false
    const settle = (error?: Error): void => {
      if (completed) {
        return
      }
      if (error) {
        completed = true
        onFlushed(error)
        return
      }
      pending -= 1
      if (pending === 0) {
        completed = true
        onFlushed()
      }
    }
    if (typeof result.stdout === 'string' && result.stdout.length > 0) {
      pending += 1
      const output = Buffer.from(result.stdout)
      stdoutWriter.enqueue(
        'control',
        () => output,
        output.length,
        (settlement) => settle(settlement.ok ? undefined : settlement.error)
      )
    }
    if (typeof result.stderr === 'string' && result.stderr.length > 0) {
      pending += 1
      process.stderr.write(result.stderr, 'utf8', (error) => settle(error ?? undefined))
    }
    if (pending === 0) {
      completed = true
      onFlushed()
    }
  }

  const decoder = new FrameDecoder((frame: DecodedFrame) => {
    if (frame.id > highestReceivedSeq) {
      highestReceivedSeq = frame.id
    }
    if (frame.type !== MessageType.Regular) {
      return
    }
    const msg = parseJsonRpcMessage(frame.payload)
    if (
      !('id' in msg) ||
      (msg.id !== requestId && msg.id !== postOutputRequestId) ||
      !('result' in msg || 'error' in msg)
    ) {
      return
    }
    const response = msg as JsonRpcResponse
    if (response.error) {
      process.stderr.write(`${response.error.message}\n`)
      finish(1)
      return
    }
    if (response.id === postOutputRequestId) {
      finish(initialExitCode)
      return
    }
    const result = (response.result ?? {}) as {
      stdout?: unknown
      stderr?: unknown
      exitCode?: unknown
      postOutput?: unknown
    }
    initialExitCode = typeof result.exitCode === 'number' ? result.exitCode : 0
    writeOutput(result, (error) => {
      if (error) {
        finish(1)
        return
      }
      if (result.postOutput === undefined) {
        finish(initialExitCode)
        return
      }
      sendPostOutput(result.postOutput)
    })
  })

  const connectTimeout = setTimeout(() => {
    process.stderr.write(`[orca-cli] Relay connection timed out after ${CONNECT_TIMEOUT_MS}ms\n`)
    sock.destroy()
    process.exit(1)
  }, CONNECT_TIMEOUT_MS)

  sock.on('connect', () => {
    clearTimeout(connectTimeout)
    runConnectHandshake(
      sock,
      myVersion,
      {
        onAccepted: (leftover) => {
          if (leftover.length > 0) {
            decoder.feed(leftover)
          }
          sock.on('data', (chunk) =>
            decoder.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          )
          sendRequest()
        }
      },
      endpointCredential
    )
  })

  sock.on('error', (err) => {
    clearTimeout(connectTimeout)
    process.stderr.write(`[orca-cli] Relay socket error: ${err.message}\n`)
    process.exit(1)
  })
}

export async function readOrcaCliStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

