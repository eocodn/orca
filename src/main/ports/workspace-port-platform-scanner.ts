import { execFile } from 'node:child_process'
import { readFile, readdir, readlink } from 'node:fs/promises'
import { getProcessOutputFields } from '../../shared/process-output-field-scanner'

export const COMMAND_TIMEOUT_MS = 4_000

export type RawListeningPort = {
  host: string
  port: number
  pid?: number
  processName?: string
  commandLine?: string
  cwd?: string
}

type ProcessMetadata = {
  processName?: string
  commandLine?: string
  cwd?: string
}

export function parseLsofListeningOutput(output: string): RawListeningPort[] {
  const ports: RawListeningPort[] = []
  let currentPid: number | undefined
  let currentProcessName: string | undefined
  for (const line of output.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      const pid = Number.parseInt(value, 10)
      currentPid = Number.isFinite(pid) ? pid : undefined
      currentProcessName = undefined
    } else if (tag === 'c') {
      currentProcessName = value
    } else if (tag === 'n') {
      const parsed = parseAddressWithPort(value)
      if (parsed) ports.push({ pid: currentPid, processName: currentProcessName, ...parsed })
    }
  }
  return dedupeRawPorts(ports)
}

export function parseNetstatListeningOutput(output: string): RawListeningPort[] {
  const ports: RawListeningPort[] = []
  for (const line of output.split('\n')) {
    const fields = getProcessOutputFields(line, 6)
    if (fields[0]?.toUpperCase() !== 'TCP') continue
    const stateIndex = fields.findIndex((field) => field.toUpperCase() === 'LISTENING')
    if (stateIndex < 2) continue
    const parsed = parseAddressWithPort(fields[1])
    const pid = Number.parseInt(fields[stateIndex + 1] ?? '', 10)
    if (parsed) ports.push({ ...parsed, pid: Number.isFinite(pid) ? pid : undefined })
  }
  return dedupeRawPorts(ports)
}

export function parseProcNetTcp(content: string): { host: string; port: number; inode: number }[] {
  const results: { host: string; port: number; inode: number }[] = []
  const lines = content.split('\n')
  for (let index = 1; index < lines.length; index += 1) {
    const fields = getProcessOutputFields(lines[index], 10)
    if (fields.length < 10 || fields[3] !== '0A') continue
    const parsed = parseProcAddress(fields[1])
    const inode = Number.parseInt(fields[9], 10)
    if (parsed && Number.isFinite(inode) && inode !== 0) results.push({ ...parsed, inode })
  }
  return results
}

export async function scanPlatformListeningPorts(): Promise<RawListeningPort[]> {
  if (process.platform === 'linux') return scanLinuxProcPorts()
  if (process.platform === 'darwin') return scanDarwinLsofPorts()
  if (process.platform === 'win32') return scanWindowsNetstatPorts()
  throw new Error(`Port scanning is not supported on ${process.platform}`)
}

async function scanDarwinLsofPorts(): Promise<RawListeningPort[]> {
  const { stdout } = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])
  const ports = parseLsofListeningOutput(stdout)
  const metadata = await loadDarwinProcessMetadata(new Set(ports.flatMap((p) => p.pid ? [p.pid] : [])))
  return ports.map((port) => ({ ...metadata.get(port.pid ?? -1), ...port }))
}

async function scanWindowsNetstatPorts(): Promise<RawListeningPort[]> {
  const { stdout } = await runCommand('netstat', ['-ano', '-p', 'tcp'])
  const ports = parseNetstatListeningOutput(stdout)
  const metadata = await loadWindowsProcessMetadata(new Set(ports.flatMap((p) => p.pid ? [p.pid] : [])))
  return ports.map((port) => ({ ...metadata.get(port.pid ?? -1), ...port }))
}

async function scanLinuxProcPorts(): Promise<RawListeningPort[]> {
  const [tcp4, tcp6] = await Promise.all([readProcNet('/proc/net/tcp'), readProcNet('/proc/net/tcp6')])
  const sockets = [...tcp4, ...tcp6]
  const inodeToPid = await mapLinuxInodesToPids(new Set(sockets.map((socket) => socket.inode)))
  const metadata = new Map<number, ProcessMetadata>()
  const rawPorts: RawListeningPort[] = []
  for (const socket of sockets) {
    const pid = inodeToPid.get(socket.inode)
    if (pid != null && !metadata.has(pid)) metadata.set(pid, await loadLinuxProcessMetadata(pid))
    rawPorts.push({ host: socket.host, port: socket.port, pid, ...metadata.get(pid ?? -1) })
  }
  return dedupeRawPorts(rawPorts)
}

async function readProcNet(filePath: string): Promise<{ host: string; port: number; inode: number }[]> {
  try {
    return parseProcNetTcp(await readFile(filePath, 'utf-8'))
  } catch {
    return []
  }
}

async function mapLinuxInodesToPids(inodes: Set<number>): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (inodes.size === 0) return result
  let pids: string[]
  try {
    pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry))
  } catch {
    return result
  }
  for (const pidText of pids) {
    let fds: string[]
    try { fds = await readdir(`/proc/${pidText}/fd`) } catch { continue }
    const pid = Number.parseInt(pidText, 10)
    for (const fd of fds) {
      let link: string
      try { link = await readlink(`/proc/${pidText}/fd/${fd}`) } catch { continue }
      const match = link.match(/^socket:\[(\d+)\]$/)
      if (match) {
        const inode = Number.parseInt(match[1], 10)
        if (inodes.has(inode)) result.set(inode, pid)
      }
    }
  }
  return result
}

async function loadLinuxProcessMetadata(pid: number): Promise<ProcessMetadata> {
  const [comm, cmdline, cwd] = await Promise.all([
    readTextIfAvailable(`/proc/${pid}/comm`),
    readTextIfAvailable(`/proc/${pid}/cmdline`),
    readlink(`/proc/${pid}/cwd`).catch(() => undefined)
  ])
  return { processName: comm?.trim() || undefined, commandLine: cmdline?.split('\u0000').join(' ').trim() || undefined, cwd }
}

async function loadDarwinProcessMetadata(pids: Set<number>): Promise<Map<number, ProcessMetadata>> {
  const result = new Map<number, ProcessMetadata>()
  const pidList = Array.from(pids).join(',')
  if (!pidList) return result
  const [cwdOutput, commandOutput] = await Promise.all([
    runCommand('lsof', ['-a', '-p', pidList, '-d', 'cwd', '-Fn']).catch(() => null),
    runCommand('ps', ['-p', pidList, '-o', 'pid=', '-o', 'command=']).catch(() => null)
  ])
  let currentPid: number | null = null
  for (const line of cwdOutput?.stdout.split('\n') ?? []) {
    if (line.startsWith('p')) {
      const pid = Number.parseInt(line.slice(1), 10)
      currentPid = Number.isFinite(pid) ? pid : null
    } else if (line.startsWith('n') && currentPid != null) {
      result.set(currentPid, { ...result.get(currentPid), cwd: line.slice(1) || undefined })
    }
  }
  for (const line of commandOutput?.stdout.split('\n') ?? []) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (match) result.set(Number.parseInt(match[1], 10), { ...result.get(Number.parseInt(match[1], 10)), commandLine: match[2].trim() || undefined })
  }
  return result
}

async function loadWindowsProcessMetadata(pids: Set<number>): Promise<Map<number, ProcessMetadata>> {
  const result = new Map<number, ProcessMetadata>()
  if (pids.size === 0) return result
  try {
    const pidFilter = Array.from(pids).filter(Number.isFinite).map((pid) => `ProcessId=${pid}`).join(' OR ')
    const { stdout } = await runCommand('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "${pidFilter}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`
    ])
    const parsed = JSON.parse(stdout) as { ProcessId: number; Name?: string; CommandLine?: string } | { ProcessId: number; Name?: string; CommandLine?: string }[]
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      if (pids.has(row.ProcessId)) result.set(row.ProcessId, { processName: row.Name, commandLine: row.CommandLine })
    }
  } catch {
    // Process metadata is optional; port rows still render without attribution.
  }
  return result
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string }> {
  return await new Promise((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof execFile> | undefined
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child?.kill()
      reject(new CommandTimeoutError(command, COMMAND_TIMEOUT_MS))
    }, COMMAND_TIMEOUT_MS)
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    try {
      child = execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error) settle(() => reject(error))
        else settle(() => resolve({ stdout: String(stdout) }))
      })
    } catch (error) { settle(() => reject(error)) }
  })
}

class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`${command} timed out after ${timeoutMs}ms`)
    this.name = 'CommandTimeoutError'
  }
}

export function isCommandTimeoutError(error: unknown): boolean {
  return error instanceof CommandTimeoutError
}

async function readTextIfAvailable(filePath: string): Promise<string | undefined> {
  try { return await readFile(filePath, 'utf-8') } catch { return undefined }
}

export function connectHostForBindHost(host: string): string {
  return host === '*' || host === '0.0.0.0' || host === '::' ? 'localhost' : host
}

function dedupeRawPorts(ports: RawListeningPort[]): RawListeningPort[] {
  const seen = new Set<string>()
  return ports.filter((port) => {
    const key = `${connectHostForBindHost(port.host)}:${port.port}:${port.pid ?? 'unknown'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseAddressWithPort(value: string): { host: string; port: number } | null {
  const trimmed = value.trim().replace(/\s+\(LISTEN\)$/i, '')
  const bracketed = trimmed.match(/^\[([^\]]+)\]:(\d+)$/)
  if (bracketed) return { host: bracketed[1], port: Number.parseInt(bracketed[2], 10) }
  const match = trimmed.match(/^(.+):(\d+)$/)
  if (!match) return null
  const port = Number.parseInt(match[2], 10)
  return Number.isFinite(port) && port > 0 && port <= 65535 ? { host: match[1], port } : null
}

function parseProcAddress(hexAddress: string): { host: string; port: number } | null {
  const [addrHex, portHex] = hexAddress.split(':')
  const port = Number.parseInt(portHex, 16)
  if (!Number.isFinite(port) || port === 0) return null
  if (addrHex.length === 8) {
    const bytes = [6, 4, 2, 0].map((index) => Number.parseInt(addrHex.slice(index, index + 2), 16))
    return { host: bytes.join('.'), port }
  }
  if (addrHex.length !== 32) return null
  if (addrHex === '00000000000000000000000000000000') return { host: '::', port }
  if (addrHex === '00000000000000000000000001000000') return { host: '::1', port }
  return { host: formatIPv6Address(addrHex), port }
}

function formatIPv6Address(hex: string): string {
  const groups: string[] = []
  for (let index = 0; index < 32; index += 8) {
    const chunk = hex.slice(index, index + 8)
    const reversed = chunk.slice(6, 8) + chunk.slice(4, 6) + chunk.slice(2, 4) + chunk.slice(0, 2)
    groups.push(reversed.slice(0, 4), reversed.slice(4, 8))
  }
  return groups.map((group) => group.replace(/^0+/, '') || '0').join(':')
}
