import { execFileSync, fork } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  median,
  percentile,
  processSnapshot,
  sampleProcess
} from './macos-computer-helper-owner-loss-metrics.mjs'
import {
  benchmarkTrialNeedsCleanup,
  parseBenchmarkTrialResult,
  processIdentityIsCurrent,
  signalProcessIdentity,
  spawnBenchmarkProcess,
  throwBenchmarkTrialFailures,
  writeProcessRecord
} from './macos-computer-helper-owner-loss-processes.mjs'
import { cleanupOwnerLossTrial } from './macos-computer-helper-owner-loss-trial-cleanup.mjs'

const INTERNAL_ENV = 'ORCA_COMPUTER_HELPER_OWNER_BENCH_INTERNAL'
const EXPECTATION_ENV = 'ORCA_COMPUTER_HELPER_OWNER_BENCH_EXPECTATION'
const HELPER_RECORD_PATH_ENV = 'ORCA_COMPUTER_HELPER_OWNER_BENCH_HELPER_RECORD_PATH'
const RESULT_PATH_ENV = 'ORCA_COMPUTER_HELPER_OWNER_BENCH_RESULT_PATH'
const ACTIVE_REQUEST_COUNT = 100_000
const DEFAULT_TRIALS = 3
const OWNER_HOLD_MS = 31_000
const PROCESS_EXIT_TIMEOUT_MS = 5_000
const RETAIN_PROOF_MS = 3_000
const TRIAL_TIMEOUT_MS = OWNER_HOLD_MS + 4 * PROCESS_EXIT_TIMEOUT_MS + 120_000
const MIB = 1024 * 1024
const scriptPath = path.join(import.meta.dirname, 'macos-computer-helper-owner-loss-benchmark.mjs')
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const metricsPath = path.join(import.meta.dirname, 'macos-computer-helper-owner-loss-metrics.mjs')
const processCleanupPath = path.join(
  import.meta.dirname,
  'macos-computer-helper-owner-loss-processes.mjs'
)
const trialCleanupPath = path.join(
  import.meta.dirname,
  'macos-computer-helper-owner-loss-trial-cleanup.mjs'
)
const sidecarPath = path.join(repoRoot, 'out', 'main', 'computer-sidecar.js')
const helperAppPath = path.join(
  repoRoot,
  'native',
  'computer-use-macos',
  '.build',
  'release',
  'Orca Computer Use.app'
)
const helperPath = path.join(helperAppPath, 'Contents', 'MacOS', 'orca-computer-use-macos')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(identity, timeoutMs) {
  const startedAt = performance.now()
  while (performance.now() - startedAt < timeoutMs) {
    if (!processIdentityIsCurrent(identity)) {
      return performance.now() - startedAt
    }
    await sleep(50)
  }
  return null
}

async function stopProcess(identity) {
  if (!identity || !processIdentityIsCurrent(identity)) {
    return
  }
  signalProcessIdentity(identity, helperPath, 'SIGTERM')
  if ((await waitForProcessExit(identity, 2_000)) !== null) {
    return
  }
  signalProcessIdentity(identity, helperPath, 'SIGKILL')
  await waitForProcessExit(identity, 2_000)
}

function startSidecar() {
  const errors = []
  const child = fork(sidecarPath, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ORCA_COMPUTER_SIDECAR: '1',
      ORCA_COMPUTER_MACOS_HELPER_APP_PATH: helperAppPath
    }
  })
  child.on('error', (error) => errors.push(error.stack ?? error.message))
  child.stderr?.on('data', (chunk) => errors.push(String(chunk)))
  return { child, errors }
}

function requestSidecar(sidecar, id, method) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Sidecar ${method} request timed out: ${sidecar.errors.join('')}`))
    }, 10_000)
    const onMessage = (message) => {
      if (message?.id !== id) {
        return
      }
      cleanup()
      if (message.ok) {
        resolve(message.result)
      } else {
        reject(new Error(`Sidecar ${method} failed: ${JSON.stringify(message.error)}`))
      }
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `Sidecar exited during ${method}: ${JSON.stringify({ code, signal, stderr: sidecar.errors.join('') })}`
        )
      )
    }
    const onError = (error) => {
      cleanup()
      reject(new Error(`Sidecar ${method} process error: ${error.message}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      sidecar.child.off('message', onMessage)
      sidecar.child.off('exit', onExit)
      sidecar.child.off('error', onError)
    }
    sidecar.child.on('message', onMessage)
    sidecar.child.once('exit', onExit)
    sidecar.child.once('error', onError)
    try {
      sidecar.child.send({ id, method, params: {} })
    } catch (error) {
      onError(error)
    }
  })
}

async function waitForHelper(sidecarPid) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    })
    for (const line of output.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
      if (
        match &&
        Number(match[2]) === sidecarPid &&
        Number(match[3]) === Number(match[1]) &&
        match[4].includes(helperPath) &&
        match[4].includes(' --agent ')
      ) {
        return { pid: Number(match[1]), pgid: Number(match[3]), command: match[4] }
      }
    }
    await sleep(50)
  }
  throw new Error(`Could not find helper owned by sidecar ${sidecarPid}`)
}

function socketPathFromCommand(command) {
  const match = command.match(/ --agent (.+?) --token-file /)
  if (!match) {
    throw new Error(`Could not read helper socket path from command: ${command}`)
  }
  return match[1]
}

function connectInvalidPeer(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let accepted = false
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Invalid-peer connection timed out'))
    }, 5_000)
    let buffer = ''
    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('error', onError)
      socket.off('data', onData)
    }
    const onError = (error) => {
      if (accepted) {
        return
      }
      cleanup()
      reject(error)
    }
    const onData = (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) {
        return
      }
      let response
      try {
        response = JSON.parse(buffer.slice(0, newline))
      } catch (error) {
        cleanup()
        socket.destroy()
        reject(error)
        return
      }
      if (response.ok !== false || response.error?.code !== 'permission_denied') {
        cleanup()
        socket.destroy()
        reject(new Error(`Invalid peer was not rejected: ${JSON.stringify(response)}`))
        return
      }
      clearTimeout(timeout)
      socket.off('data', onData)
      accepted = true
      resolve(socket)
    }
    socket.setEncoding('utf8')
    socket.on('error', onError)
    socket.on('data', onData)
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({ id: 991, method: 'handshake', params: {}, token: 'invalid' })}\n`
      )
    })
  })
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }
  return await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false)
  ])
}

async function startAuthenticatedSession() {
  const sidecar = startSidecar()
  let helper
  try {
    const capabilitiesResult = requestSidecar(sidecar, 1, 'capabilities').then(
      (capabilities) => ({ capabilities }),
      (error) => ({ error })
    )
    helper = await waitForHelper(sidecar.child.pid)
    const helperRecordPath = process.env[HELPER_RECORD_PATH_ENV]
    if (!helperRecordPath) {
      throw new Error('Missing helper process record path')
    }
    writeProcessRecord(helperRecordPath, helper)
    const { capabilities, error } = await capabilitiesResult
    if (error) {
      throw error
    }
    if (capabilities?.protocolVersion !== 1) {
      throw new Error(`Unexpected helper handshake: ${JSON.stringify(capabilities)}`)
    }
    return { authenticated: capabilities.protocolVersion === 1, sidecar, helper }
  } catch (error) {
    sidecar.child.kill('SIGKILL')
    await stopProcess(helper)
    throw error
  }
}

async function exerciseActiveRequests(sidecar) {
  const latencies = []
  const startedAt = performance.now()
  for (let index = 0; index < ACTIVE_REQUEST_COUNT; index += 1) {
    const requestStartedAt = performance.now()
    const result = await requestSidecar(sidecar, 10_000 + index, 'listApps')
    if (!Array.isArray(result?.apps)) {
      throw new Error(`Unexpected listApps response: ${JSON.stringify(result)}`)
    }
    latencies.push(performance.now() - requestStartedAt)
  }
  const totalMs = performance.now() - startedAt
  return {
    totalMs,
    requestsPerSecond: (ACTIVE_REQUEST_COUNT * 1_000) / totalMs,
    medianLatencyMs: median(latencies),
    p95LatencyMs: percentile(latencies, 0.95),
    maxLatencyMs: Math.max(...latencies)
  }
}

async function verifyGracefulClose() {
  const { sidecar, helper } = await startAuthenticatedSession()
  try {
    const startedAt = performance.now()
    sidecar.child.disconnect()
    if (!(await waitForChildExit(sidecar.child, PROCESS_EXIT_TIMEOUT_MS))) {
      throw new Error('Sidecar did not exit after graceful IPC close')
    }
    const helperExitMs = await waitForProcessExit(helper, PROCESS_EXIT_TIMEOUT_MS)
    if (helperExitMs === null) {
      throw new Error('Helper did not exit after graceful owner close')
    }
    return Math.round(performance.now() - startedAt)
  } finally {
    sidecar.child.kill('SIGKILL')
    await stopProcess(helper)
  }
}

async function runInternalTrial(expectation) {
  let sidecar
  let helper
  let invalidPeer
  let invalidPeerRejected = false
  try {
    const session = await startAuthenticatedSession()
    sidecar = session.sidecar
    helper = session.helper
    const authenticatedAt = performance.now()
    const initial = await sampleProcess(helper.pid)
    const activeRequests = await exerciseActiveRequests(sidecar)
    const remainingHoldMs = Math.max(0, OWNER_HOLD_MS - (performance.now() - authenticatedAt))
    await sleep(remainingHoldMs)
    const connected = await sampleProcess(helper.pid)
    const invalidSocketPath = socketPathFromCommand(helper.command)
    invalidPeer = await connectInvalidPeer(invalidSocketPath)
    invalidPeerRejected = true
    const survivedClaimDeadline =
      performance.now() - authenticatedAt >= OWNER_HOLD_MS && isProcessAlive(helper.pid)

    sidecar.child.kill('SIGKILL')
    await waitForChildExit(sidecar.child, PROCESS_EXIT_TIMEOUT_MS)
    const abruptExitMs = await waitForProcessExit(
      helper,
      expectation === 'reaped' ? PROCESS_EXIT_TIMEOUT_MS : RETAIN_PROOF_MS
    )
    const helperExitedAfterAbruptLoss = abruptExitMs !== null
    if (expectation === 'reaped' && !helperExitedAfterAbruptLoss) {
      throw new Error('Expected helper to exit after abrupt authenticated owner loss')
    }
    if (expectation === 'retained' && helperExitedAfterAbruptLoss) {
      throw new Error('Expected baseline helper to remain after abrupt owner loss')
    }
    const postLossRssBytes = helperExitedAfterAbruptLoss ? 0 : processSnapshot(helper.pid).rssBytes
    await stopProcess(helper)
    helper = null
    invalidPeer.destroy()
    invalidPeer = null

    const gracefulExitMs = await verifyGracefulClose()
    return {
      authenticated: session.authenticated,
      survivedClaimDeadline,
      invalidPeerRejectedAndDidNotRetain: invalidPeerRejected && helperExitedAfterAbruptLoss,
      connectedRssBytes: connected.rssBytes,
      connectedCpuMilliseconds: Math.max(
        0,
        Math.round((connected.cpuTimeSeconds - initial.cpuTimeSeconds) * 1_000)
      ),
      activeRequests,
      cpuSampleMs: Math.round(performance.now() - authenticatedAt),
      helperExitedAfterAbruptLoss,
      abruptExitMs: abruptExitMs === null ? null : Math.round(abruptExitMs),
      postLossRssBytes,
      gracefulExitMs
    }
  } finally {
    invalidPeer?.destroy()
    sidecar?.child.kill('SIGKILL')
    await stopProcess(helper)
  }
}

function runTrial(executable, expectation) {
  let launcherDir
  let trialTempDir
  let helperRecordPath
  let resultPath
  let stderrPath
  let stdoutPath
  let result
  let serializedResult
  let parsedResult
  let parsedResultAvailable = false
  let trialError
  let cleanupError
  let stderrDescriptor
  let stdoutDescriptor
  let trialOutput = ''
  try {
    launcherDir = mkdtempSync(path.join(tmpdir(), 'orca-helper-owner-bench-launcher-'))
    trialTempDir = mkdtempSync(path.join(path.sep, 'tmp', 'orca-owner-bench-'))
    helperRecordPath = path.join(launcherDir, 'helper.json')
    resultPath = path.join(launcherDir, 'result.json')
    stderrPath = path.join(launcherDir, 'stderr.log')
    stdoutPath = path.join(launcherDir, 'stdout.log')
    writeFileSync(
      path.join(launcherDir, 'package.json'),
      JSON.stringify({ name: 'orca-helper-owner-benchmark', main: 'main.cjs' })
    )
    writeFileSync(
      path.join(launcherDir, 'main.cjs'),
      `import(${JSON.stringify(pathToFileURL(scriptPath).href)}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})\n`
    )
    const env = {
      ...process.env,
      TMPDIR: trialTempDir,
      [INTERNAL_ENV]: '1',
      [EXPECTATION_ENV]: expectation,
      [HELPER_RECORD_PATH_ENV]: helperRecordPath,
      [RESULT_PATH_ENV]: resultPath
    }
    delete env.ELECTRON_RUN_AS_NODE
    stderrDescriptor = openSync(stderrPath, 'w')
    stdoutDescriptor = openSync(stdoutPath, 'w')
    result = spawnBenchmarkProcess(executable, [launcherDir], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', stdoutDescriptor, stderrDescriptor],
      timeout: TRIAL_TIMEOUT_MS
    })
    if (result.status === 0 && existsSync(resultPath)) {
      serializedResult = readFileSync(resultPath, 'utf8')
      parsedResult = parseBenchmarkTrialResult(serializedResult)
      parsedResultAvailable = true
    }
  } catch (error) {
    trialError = error
  } finally {
    const failedTrial = benchmarkTrialNeedsCleanup(result, parsedResultAvailable)
    const trialMarker = trialTempDir ? `TMPDIR=${trialTempDir}` : undefined
    const cleanup = cleanupOwnerLossTrial({
      failed: failedTrial,
      pid: result?.pid,
      marker: trialMarker,
      recordPath: helperRecordPath,
      helperPath,
      tempDir: trialTempDir,
      stderrDescriptor,
      stdoutDescriptor,
      outputPaths: [stderrPath, stdoutPath],
      launcherDir
    })
    cleanupError = cleanup.error
    trialOutput = cleanup.output
  }
  if (!trialError && result?.status !== 0) {
    trialError = new Error(
      `Electron trial failed (${result.error?.message ?? result.signal ?? result.status}):\n${trialOutput}`
    )
  }
  if (!trialError && !serializedResult) {
    trialError = new Error(`Electron trial did not write a result:\n${trialOutput}`)
  }
  throwBenchmarkTrialFailures(trialError, cleanupError)
  return parsedResult
}



export { runInternalTrial, runTrial }