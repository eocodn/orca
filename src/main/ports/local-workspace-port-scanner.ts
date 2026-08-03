import path from 'node:path'
import type {
  WorkspacePort,
  WorkspacePortOwner,
  WorkspacePortProbe,
  WorkspacePortScanResult
} from '../../shared/workspace-ports'
import { advertisedUrlWatcher, type AdvertisedUrlWatcher } from './advertised-url-watcher'
import { WorkspacePortScanTimeoutBackoff } from './workspace-port-scan-timeout-backoff'
import {
  isCommandTimeoutError,
  scanPlatformListeningPorts,
  connectHostForBindHost,
  type RawListeningPort
} from './workspace-port-platform-scanner'
export { parseLsofListeningOutput, parseNetstatListeningOutput, parseProcNetTcp } from './workspace-port-platform-scanner'

const MAX_PORTS = 200
const HTTP_PORTS = new Set([80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888])
const HTTPS_PORTS = new Set([443, 8443])

const commandTimeoutBackoff = new WorkspacePortScanTimeoutBackoff()

type NormalizedWorkspacePortProbe = {
  worktree: WorkspacePortProbe
  normalizedPath: string
}

export async function scanWorkspacePorts(
  worktrees: WorkspacePortProbe[],
  urlWatcher: Pick<AdvertisedUrlWatcher, 'lookup' | 'reconcileScan'> = advertisedUrlWatcher
): Promise<WorkspacePortScanResult> {
  const cooldown = commandTimeoutBackoff.snapshot()
  if (cooldown.isCoolingDown) {
    return makeUnavailableScan(
      `Port scanning is temporarily paused after a command timeout. Retrying in ${Math.ceil(
        cooldown.remainingMs / 1000
      )}s.`
    )
  }

  try {
    const rawPorts = await scanPlatformListeningPorts()
    commandTimeoutBackoff.recordSuccess()
    const normalizedWorktrees = normalizeWorkspacePortProbes(worktrees)
    reconcileAdvertisedUrls(rawPorts, normalizedWorktrees, urlWatcher)
    const ports = rawPorts
      .map((port) => enrichPort(port, normalizedWorktrees, urlWatcher))
      .sort(compareWorkspacePorts)
      .slice(0, MAX_PORTS)
    return { platform: process.platform, scannedAt: Date.now(), ports }
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      commandTimeoutBackoff.recordTimeout()
    }
    console.warn('[workspace-ports] scan failed', error)
    return makeUnavailableScan(`Port scanning is unavailable on ${process.platform}.`)
  }
}

export function resetWorkspacePortScanTimeoutBackoffForTests(): void {
  commandTimeoutBackoff.reset()
}

function makeUnavailableScan(reason: string): WorkspacePortScanResult {
  return {
    platform: process.platform,
    scannedAt: Date.now(),
    ports: [],
    unavailableReason: reason
  }
}

export function attributePortToWorkspace(
  port: Pick<RawListeningPort, 'cwd' | 'commandLine'>,
  worktrees: WorkspacePortProbe[]
): WorkspacePortOwner | undefined {
  return attributePortToNormalizedWorkspaces(port, normalizeWorkspacePortProbes(worktrees))
}

function normalizeWorkspacePortProbes(
  worktrees: readonly WorkspacePortProbe[]
): NormalizedWorkspacePortProbe[] {
  return worktrees.map((worktree) => ({
    worktree,
    normalizedPath: normalizeComparablePath(worktree.path)
  }))
}

function attributePortToNormalizedWorkspaces(
  port: Pick<RawListeningPort, 'cwd' | 'commandLine'>,
  worktrees: readonly NormalizedWorkspacePortProbe[]
): WorkspacePortOwner | undefined {
  const cwd = port.cwd ? normalizeComparablePath(port.cwd) : null
  const commandLine = port.commandLine ? normalizeComparableText(port.commandLine) : null

  const cwdMatch = cwd
    ? pickDeepestMatching(worktrees, ({ normalizedPath }) =>
        isSameOrDescendant(cwd, normalizedPath)
      )
    : undefined
  if (cwdMatch) {
    return toOwner(cwdMatch.worktree, 'cwd')
  }

  if (!commandLine) {
    return undefined
  }

  const commandMatch = pickDeepestMatching(worktrees, ({ normalizedPath }) =>
    includesPathBoundary(commandLine, normalizedPath)
  )
  return commandMatch ? toOwner(commandMatch.worktree, 'command') : undefined
}

function enrichPort(
  port: RawListeningPort,
  worktrees: readonly NormalizedWorkspacePortProbe[],
  urlWatcher: Pick<AdvertisedUrlWatcher, 'lookup'>
): WorkspacePort {
  const owner = attributePortToNormalizedWorkspaces(port, worktrees)
  const base = {
    id: `${port.host}:${port.port}:${port.pid ?? 'unknown'}`,
    bindHost: port.host,
    connectHost: connectHostForBindHost(port.host),
    port: port.port,
    pid: port.pid,
    processName: port.processName,
    protocol: inferProtocol(port.port)
  }

  if (owner) {
    // Why: only enrich workspace-attributed ports. Container and external
    // ports may have URLs printed in unrelated terminals — the worktree
    // scoping is the primary false-positive filter.
    const advertised = urlWatcher.lookup(owner.worktreeId, port.port, port.pid)
    return {
      ...base,
      protocol: advertised?.protocol ?? base.protocol,
      kind: 'workspace',
      owner,
      ...(advertised ? { advertisedUrl: advertised.origin } : {})
    }
  }
  if (isContainerProcess(port)) {
    return { ...base, kind: 'container' }
  }
  return { ...base, kind: 'external' }
}

function reconcileAdvertisedUrls(
  ports: RawListeningPort[],
  worktrees: readonly NormalizedWorkspacePortProbe[],
  urlWatcher: Pick<AdvertisedUrlWatcher, 'reconcileScan'>
): void {
  const observationsByWorktree = new Map<string, { port: number; pid?: number }[]>()
  for (const worktree of worktrees) {
    observationsByWorktree.set(worktree.worktree.id, [])
  }
  for (const port of ports) {
    const owner = attributePortToNormalizedWorkspaces(port, worktrees)
    if (!owner) {
      continue
    }
    observationsByWorktree.get(owner.worktreeId)?.push({ port: port.port, pid: port.pid })
  }
  for (const [worktreeId, observations] of observationsByWorktree) {
    // Why: the scanner sees port disappearance and PID changes before a lazy
    // lookup would otherwise pin a stale banner to a new listener.
    urlWatcher.reconcileScan([worktreeId], observations)
  }
}

function compareWorkspacePorts(a: WorkspacePort, b: WorkspacePort): number {
  const aRank = a.kind === 'workspace' ? 0 : a.kind === 'container' ? 1 : 2
  const bRank = b.kind === 'workspace' ? 0 : b.kind === 'container' ? 1 : 2
  return aRank - bRank || a.port - b.port || a.connectHost.localeCompare(b.connectHost)
}

function inferProtocol(port: number): 'http' | 'https' | 'unknown' {
  if (HTTPS_PORTS.has(port)) {
    return 'https'
  }
  if (HTTP_PORTS.has(port)) {
    return 'http'
  }
  return 'unknown'
}

export function isContainerProcess(
  port: Pick<RawListeningPort, 'processName' | 'commandLine'>
): boolean {
  const haystack = `${port.processName ?? ''} ${port.commandLine ?? ''}`.toLowerCase()
  return /\b(com\.[\w.-]+\.backend|com\.container\w*|container\w*)\b/.test(haystack)
}

function toOwner(
  worktree: WorkspacePortProbe,
  confidence: WorkspacePortOwner['confidence']
): WorkspacePortOwner {
  return {
    worktreeId: worktree.id,
    repoId: worktree.repoId,
    displayName: worktree.displayName,
    path: worktree.path,
    confidence
  }
}

function pickDeepestMatching<T extends { normalizedPath: string }>(
  candidates: readonly T[],
  predicate: (candidate: T) => boolean
): T | undefined {
  let best: T | undefined
  for (const candidate of candidates) {
    if (!predicate(candidate)) {
      continue
    }
    if (!best || candidate.normalizedPath.length > best.normalizedPath.length) {
      best = candidate
    }
  }
  return best
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`)
}

function includesPathBoundary(commandLine: string, normalizedPath: string): boolean {
  let index = commandLine.indexOf(normalizedPath)
  while (index !== -1) {
    const before = index === 0 ? '' : commandLine[index - 1]
    const after = commandLine[index + normalizedPath.length] ?? ''
    const startsOnBoundary = before === '' || /\s|["'=]/.test(before)
    const endsOnBoundary = after === '' || /[\s"'/:]/.test(after)
    if (startsOnBoundary && endsOnBoundary) {
      return true
    }
    index = commandLine.indexOf(normalizedPath, index + normalizedPath.length)
  }
  return false
}

function normalizeComparablePath(input: string): string {
  if (input.startsWith('/')) {
    // Why: command-line evidence for SSH/WSL/POSIX workspaces can be evaluated
    // on a Windows host; path.resolve would reinterpret "/repo" as "G:/repo".
    return normalizeComparableText(path.posix.resolve(input))
  }
  return normalizeComparableText(path.resolve(input))
}

function normalizeComparableText(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/\/+/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
