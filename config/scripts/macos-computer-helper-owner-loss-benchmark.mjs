#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { median, percentile } from './macos-computer-helper-owner-loss-metrics.mjs'

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
const scriptPath = import.meta.filename
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

import { runInternalTrial, runTrial } from './macos-computer-helper-owner-loss-trials.mjs'

function parseArgs(argv) {
  const options = { expect: '', trials: DEFAULT_TRIALS, output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--expect' || arg === '--trials' || arg === '--output') {
      if (!value) {
        throw new Error(`Missing value for ${arg}`)
      }
      options[arg.slice(2)] = arg === '--trials' ? Number(value) : value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!['retained', 'reaped'].includes(options.expect)) {
    throw new Error('--expect must be retained or reaped')
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new Error('--trials must be a positive integer')
  }
  return options
}

function electronPath() {
  const electronModulePath = fileURLToPath(import.meta.resolve('electron'))
  return execFileSync(
    process.execPath,
    ['-e', `process.stdout.write(require(${JSON.stringify(electronModulePath)}))`],
    { encoding: 'utf8' }
  )
}

function buildArtifacts() {
  execFileSync('pnpm', ['exec', 'electron-vite', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
  execFileSync('pnpm', ['build:computer-macos'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

function artifactSha256(artifactPath) {
  return createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
}

function runBenchmark() {
  if (process.platform !== 'darwin') {
    throw new Error('The computer-use helper owner benchmark is macOS-only')
  }
  const options = parseArgs(process.argv.slice(2))
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim()
  if (dirty) {
    throw new Error('Commit or stash changes before running the provenance-bound benchmark')
  }
  buildArtifacts()
  if (!existsSync(sidecarPath) || !existsSync(helperPath)) {
    throw new Error('Fresh production sidecar/helper build did not produce the expected artifacts')
  }
  const executable = electronPath()
  const results = Array.from({ length: options.trials }, () => runTrial(executable, options.expect))
  const rssBytes = results.map((result) => result.connectedRssBytes)
  const cpuMilliseconds = results.map((result) => result.connectedCpuMilliseconds)
  const activeRequestTotals = results.map((result) => result.activeRequests.totalMs)
  const activeRequestRates = results.map((result) => result.activeRequests.requestsPerSecond)
  const activeRequestMedians = results.map((result) => result.activeRequests.medianLatencyMs)
  const activeRequestP95s = results.map((result) => result.activeRequests.p95LatencyMs)
  const activeRequestMaxes = results.map((result) => result.activeRequests.maxLatencyMs)
  const postLossRssBytes = results.map((result) => result.postLossRssBytes)
  const report = {
    benchmark: 'macos-computer-helper-authenticated-owner-loss',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim(),
    artifacts: {
      sidecarSha256: artifactSha256(sidecarPath),
      helperSha256: artifactSha256(helperPath)
    },
    sources: {
      benchmarkSha256: artifactSha256(scriptPath),
      metricsSha256: artifactSha256(metricsPath),
      processCleanupSha256: artifactSha256(processCleanupPath),
      trialCleanupSha256: artifactSha256(trialCleanupPath)
    },
    expectation: options.expect,
    trials: options.trials,
    ownerHoldMs: OWNER_HOLD_MS,
    activeRequestCount: ACTIVE_REQUEST_COUNT,
    authenticated: results.every((result) => result.authenticated),
    survivedClaimDeadline: results.every((result) => result.survivedClaimDeadline),
    invalidPeerRejectedAndDidNotRetain: results.every(
      (result) => result.invalidPeerRejectedAndDidNotRetain
    ),
    connectedRssMiB: rssBytes.map((value) => Number((value / MIB).toFixed(2))),
    medianConnectedRssMiB: Number((median(rssBytes) / MIB).toFixed(2)),
    connectedCpuMilliseconds: cpuMilliseconds,
    medianConnectedCpuMilliseconds: median(cpuMilliseconds),
    activeRequestTotalMs: activeRequestTotals.map((value) => Number(value.toFixed(3))),
    medianActiveRequestTotalMs: Number(median(activeRequestTotals).toFixed(3)),
    activeRequestsPerSecond: activeRequestRates.map((value) => Number(value.toFixed(2))),
    medianActiveRequestsPerSecond: Number(median(activeRequestRates).toFixed(2)),
    activeRequestMedianLatencyMs: activeRequestMedians.map((value) => Number(value.toFixed(3))),
    medianActiveRequestMedianLatencyMs: Number(median(activeRequestMedians).toFixed(3)),
    activeRequestP95LatencyMs: activeRequestP95s.map((value) => Number(value.toFixed(3))),
    medianActiveRequestP95LatencyMs: Number(median(activeRequestP95s).toFixed(3)),
    activeRequestMaxLatencyMs: activeRequestMaxes.map((value) => Number(value.toFixed(3))),
    helperExitedAfterAbruptLoss: results.map((result) => result.helperExitedAfterAbruptLoss),
    abruptExitMs: results.map((result) => result.abruptExitMs),
    postLossRssMiB: postLossRssBytes.map((value) => Number((value / MIB).toFixed(2))),
    medianPostLossRssMiB: Number((median(postLossRssBytes) / MIB).toFixed(2)),
    gracefulExitMs: results.map((result) => result.gracefulExitMs)
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(serialized)
  if (options.output) {
    writeFileSync(path.resolve(options.output), serialized)
  }
}

if (process.env[INTERNAL_ENV] === '1') {
  const { app } = await import('electron')
  await app.whenReady()
  try {
    const result = await runInternalTrial(process.env[EXPECTATION_ENV])
    writeFileSync(process.env[RESULT_PATH_ENV], JSON.stringify(result))
  } finally {
    app.quit()
  }
} else {
  runBenchmark()
}
