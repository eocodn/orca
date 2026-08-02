#!/usr/bin/env node
/** Start Metro, pair a temporary runtime, and open Orca Mobile in an iOS simulator. */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import {
  parseProcessOptions,
  ORCA_CLI,
  colors,
  log,
  logInfo,
  logSuccess
} from './start-emulator-process-options.mjs'
import { ensureMobileExpoCli, getMobileExpoExecutablePath } from './mobile-expo-cli.mjs'
import {
  devClientUrlForMetroUrl,
  findReachableMetroUrl,
  lanIpCandidates,
  resolveMetroPort
} from './start-emulator-network-runtime.mjs'
import {
  assertIosSimulatorPlatform,
  findBestDevice,
  openInSimulator,
  openPairingUrlInSimulator,
  takeScreenshot
} from './start-emulator-simulator-runtime.mjs'
import { startMetro } from './start-emulator-metro-runtime.mjs'
import {
  registerWorktreeForPairingRuntime,
  startHeadlessPairingRuntime
} from './start-emulator-pairing-runtime.mjs'

const execFileAsync = promisify(execFile)
const options = parseProcessOptions(process.argv.slice(2))

function logError(message) {
  log(`[error] ${message}`, 'red')
}

function getMobileDir(worktree) {
  const currentDir = process.cwd()
  return !options.worktree && path.basename(currentDir) === 'mobile'
    ? currentDir
    : path.join(worktree, 'mobile')
}

async function orca(args, commandOptions = {}) {
  const { stdout, stderr } = await execFileAsync(ORCA_CLI, args, {
    cwd: commandOptions.cwd || process.cwd(),
    env: commandOptions.env || process.env,
    encoding: 'utf8',
    timeout: commandOptions.timeout || 30000
  })
  return { stdout: stdout.trim(), stderr: stderr.trim() }
}

async function getWorktree() {
  if (options.worktree) return path.resolve(options.worktree)
  try {
    const { stdout } = await orca(['worktree', 'current', '--json'])
    const result = JSON.parse(stdout)
    const worktreePath = result.worktree?.path || result.result?.worktree?.path
    if (worktreePath) return worktreePath
  } catch {
    // The current directory is the only reliable fallback for a standalone mobile checkout.
  }
  return process.cwd()
}

async function ensureMobileDependencies(worktree) {
  await ensureMobileExpoCli(getMobileDir(worktree), { logStep, logSuccess })
}

function logStep(step, message) {
  log(`[${step}] ${message}`, 'cyan')
}

async function attachEmulator(worktree, device, runtime) {
  logStep('1', `Attaching to emulator: ${device.name}`)
  try {
    await orca(['emulator', 'attach', device.udid, '--worktree', worktree, '--focus', '--json'], {
      cwd: worktree,
      env: runtime?.env || process.env,
      timeout: 60000
    })
    logSuccess(`Attached to ${device.name}`)
  } catch (error) {
    logError(`Failed to attach to emulator: ${error.message}`)
    throw error
  }
}

async function main() {
  log(colors.bright + 'Starting Orca Mobile in Emulator\n' + colors.reset)
  let pairingRuntime = null
  try {
    assertIosSimulatorPlatform()
    const worktree = await getWorktree()
    logInfo(`Using worktree: ${worktree}`)
    await ensureMobileDependencies(worktree)
    pairingRuntime = await startHeadlessPairingRuntime({
      enabled: options.pair,
      orcaCli: ORCA_CLI,
      cwd: process.cwd(),
      lanIpCandidates,
      logStep,
      logSuccess
    })
    await registerWorktreeForPairingRuntime(pairingRuntime, worktree, { orca, logStep, logSuccess })
    const device = await findBestDevice(options.device)
    logInfo(`Using device: ${device.name} (${device.runtime})`)
    await attachEmulator(worktree, device, pairingRuntime)
    const metro = await startMetro({
      worktree,
      mobileDir: getMobileDir(worktree),
      port: await resolveMetroPort(options),
      waitForReady: options.waitForReady,
      getExecutable: getMobileExpoExecutablePath
    })
    logSuccess('Metro is running')
    const reachableMetro = await findReachableMetroUrl(metro.url)
    if (reachableMetro.url !== metro.url) logInfo(`Using reachable Metro URL: ${reachableMetro.url}`)
    metro.url = reachableMetro.url
    if (!reachableMetro.reachable) {
      logError('Metro is not reachable from this machine.')
      logInfo('The app may still work if the simulator can access the LAN IP.')
    } else logSuccess('Metro is reachable')
    if (options.open) {
      await openInSimulator(metro.url, device.udid)
      await openPairingUrlInSimulator(pairingRuntime?.pairingUrl, device.udid, pairingRuntime, worktree, orca)
      if (options.screenshot) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await takeScreenshot(device.udid)
      }
    } else {
      logInfo(`Metro URL: ${metro.url}`)
      logInfo(`Dev-client URL: ${devClientUrlForMetroUrl(metro.url)}`)
      logInfo('Omit --no-open to automatically open in simulator')
    }
    log(colors.bright + '\nSetup complete!' + colors.reset)
    logInfo('Press Ctrl+C to stop Metro and the temporary desktop runtime')
    await new Promise((resolve) => {
      let stopping = false
      let stopTimeout = null
      const finish = () => {
        if (stopping) return
        stopping = true
        if (stopTimeout) clearTimeout(stopTimeout)
        metro.closeOutput()
        metro.process.kill('SIGTERM')
        Promise.resolve(pairingRuntime?.stop?.()).finally(resolve)
      }
      process.once('SIGINT', finish)
      process.once('SIGTERM', finish)
      metro.process.once('exit', finish)
    })
  } catch (error) {
    logError(error.message)
    await pairingRuntime?.stop?.()
    process.exitCode = 1
  }
}

void main()
