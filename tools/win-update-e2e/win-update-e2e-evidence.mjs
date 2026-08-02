import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readDaemonPidFiles, findDaemonProcesses, isPidAlive } from './daemon-processes.mjs'
import { fileMtimeMs } from './interactivity-probes.mjs'

function log(step, msg) {
  console.log(`[win-update-e2e] ${step}: ${msg}`)
}

function readIntFile(filePath) {
  try {
    const n = Number(readFileSync(filePath, 'utf8').trim())
    return Number.isInteger(n) ? n : null
  } catch {
    return null
  }
}

function resolveScopedDaemon(userDataDir) {
  const pidFiles = readDaemonPidFiles(userDataDir)
  const scan = findDaemonProcesses(userDataDir)
  const pids = new Set()
  for (const rec of pidFiles) {
    if (typeof rec.pid === 'number') {
      pids.add(rec.pid)
    }
  }
  for (const proc of scan) {
    if (typeof proc.pid === 'number') {
      pids.add(proc.pid)
    }
  }
  const primary = pidFiles.find((r) => typeof r.pid === 'number')
  const pid = primary?.pid ?? scan[0]?.pid ?? null
  const scanEntry = scan.find((p) => p.pid === pid) ?? scan[0]
  return {
    pid,
    appVersion: primary?.appVersion ?? null,
    startedAtMs: primary?.startedAtMs ?? null,
    // Why: the daemon's exe path (first token of its command line) tells us
    // whether it was forked from the relocated userData/daemon-host copy or the
    // install-dir Orca.exe — the key survival signal.
    exePath: daemonExePath(scanEntry?.commandLine),
    pids: [...pids]
  }
}

/** Print the daemon's lifecycle log (Phase 0) so its startup/session events are
 *  visible in the CI log before teardown removes the userData dir. */
function dumpDaemonLog(userDataDir) {
  const logPath = path.join(userDataDir, 'logs', 'daemon.log')
  try {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    log('daemon-log', `${logPath} (${lines.length} lines):`)
    for (const line of lines.slice(-40)) {
      console.log(`    ${line}`)
    }
  } catch {
    log('daemon-log', `${logPath} (unavailable)`)
  }
}

/** Extract the host exe path (first token) from a daemon command line. */
function daemonExePath(commandLine) {
  if (typeof commandLine !== 'string') {
    return null
  }
  const trimmed = commandLine.trim()
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    return end > 0 ? trimmed.slice(1, end) : null
  }
  const space = trimmed.indexOf(' ')
  return space > 0 ? trimmed.slice(0, space) : trimmed
}

function isMarkerAlive(runDir) {
  const pid = readIntFile(path.join(runDir, 'marker.pid'))
  return pid != null && isPidAlive(pid)
}

async function heartbeatAdvancedSince(heartbeatFile, sinceMs) {
  await delay(1500)
  return fileMtimeMs(heartbeatFile) > sinceMs
}

function scrollbackFidelity(before, after) {
  // WebGL renderer can leave both empty; report unknown (null) rather than a
  // false failure. When text is available, check a stable prefix survived.
  if (!before || !before.trim() || !after || !after.trim()) {
    return null
  }
  const marker = before
    .trim()
    .split('\n')
    .find((l) => l.trim().length > 3)
  if (!marker) {
    return null
  }
  return after.includes(marker.trim())
}

function readDaemonLog(userDataDir) {
  // The daemon log (when present) is JSONL: { src, ts, pid, event, ...details }.
  // Only genuinely-bad records fail a run — matched by EVENT NAME, not by any
  // string containing "error". The daemon logs benign 'uncaught-exception-
  // suppressed' events with name:"Error" for native PTY errors it intentionally
  // swallows (src/main/daemon/daemon-entry.ts); those must never fail, and
  // 'client-hello-rejected' with reason expected-hello/protocol-mismatch is
  // normal version-skew during an update. Non-JSON lines fall back to a raw
  // FATAL match so an unstructured crash dump still counts.
  const logPath = path.join(userDataDir, 'logs', 'daemon.log')
  if (!existsSync(logPath)) {
    return null
  }
  const errorLines = []
  let suppressedCount = 0
  for (const raw of readFileSync(logPath, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      if (/\bFATAL\b/.test(line)) {
        errorLines.push(line)
      }
      continue
    }
    if (rec.event === 'uncaught-exception-suppressed') {
      suppressedCount += 1
    } else if (
      rec.event === 'uncaught-exception-fatal' ||
      (rec.event === 'client-hello-rejected' && rec.reason === 'invalid-token')
    ) {
      errorLines.push(line)
    }
  }
  return { path: logPath, errorLines, suppressedCount }
}


export {
  daemonExePath,
  dumpDaemonLog,
  heartbeatAdvancedSince,
  isMarkerAlive,
  readDaemonLog,
  readIntFile,
  resolveScopedDaemon,
  scrollbackFidelity
}
