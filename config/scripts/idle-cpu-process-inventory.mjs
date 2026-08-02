import { execFileSync, spawnSync } from 'node:child_process'

function parseCpuTimeSeconds(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    return null
  }
  const [dayOrTime, maybeTime] = trimmed.includes('-') ? trimmed.split('-', 2) : [null, trimmed]
  const days = dayOrTime === null ? 0 : Number(dayOrTime)
  const parts = maybeTime.split(':').map(Number)
  if (!Number.isFinite(days) || parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  if (parts.length === 3) {
    return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 2) {
    return days * 86400 + parts[0] * 60 + parts[1]
  }
  if (parts.length === 1) {
    return days * 86400 + parts[0]
  }
  return null
}

function parseUnixProcessRows(stdout) {
  const rows = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    const match = line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) {
      continue
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      percentCpu: Number(match[3]),
      rssBytes: Number(match[4]) * 1024,
      cpuTimeSeconds: parseCpuTimeSeconds(match[5]),
      command: match[6]
    })
  }
  return rows
}

function readUnixProcessRows() {
  const stdout = execFileSync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,cputime=,command='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    maxBuffer: 20 * 1024 * 1024
  })
  return parseUnixProcessRows(stdout)
}

function readWindowsProcessRows() {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'PowerShell process enumeration failed')
  }
  const parsed = JSON.parse(result.stdout || '[]')
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.map((entry) => ({
    pid: Number(entry.ProcessId),
    ppid: Number(entry.ParentProcessId),
    percentCpu: 0,
    cpuTimeSeconds: null,
    rssBytes: Number(entry.WorkingSetSize) || 0,
    command: String(entry.CommandLine || '')
  }))
}

export function readIdleCpuProcessRows() {
  return process.platform === 'win32' ? readWindowsProcessRows() : readUnixProcessRows()
}

export function descendantsOfIdleCpuProcess(rows, rootPid) {
  const children = new Map()
  for (const row of rows) {
    const list = children.get(row.ppid) ?? []
    list.push(row)
    children.set(row.ppid, list)
  }
  const result = []
  const stack = [rootPid]
  const seen = new Set()
  while (stack.length > 0) {
    const pid = stack.pop()
    if (seen.has(pid)) {
      continue
    }
    seen.add(pid)
    const row = rows.find((candidate) => candidate.pid === pid)
    if (row) {
      result.push(row)
    }
    for (const child of children.get(pid) ?? []) {
      stack.push(child.pid)
    }
  }
  return result
}

export function classifyIdleCpuProcess(row, rootPid) {
  const command = row.command.toLowerCase()
  if (row.pid === rootPid) {
    return 'main'
  }
  if (command.includes('daemon-entry')) {
    return 'daemon'
  }
  if (command.includes('--type=gpu-process')) {
    return 'gpu'
  }
  if (command.includes('--type=renderer')) {
    return 'renderer'
  }
  if (command.includes('--type=utility')) {
    return 'utility'
  }
  if (command.includes('--type=')) {
    return 'electron-other'
  }
  if (command.includes('node') || command.includes('/pi') || command.endsWith(' pi')) {
    return 'agent-or-node'
  }
  return 'other-descendant'
}

export function terminateIdleCpuProcesses(processes) {
  for (const proc of processes) {
    try {
      process.kill(proc.pid)
    } catch {}
  }
}
