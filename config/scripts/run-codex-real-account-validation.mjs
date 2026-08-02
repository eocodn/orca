#!/usr/bin/env node
import { _electron as electron } from '@stablyai/playwright-test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  classifyCodexHomeTripwireEvent,
  startCodexPrimaryHomeTripwire
} from './codex-primary-home-tripwire.mjs'
import {
  cleanupValidationDaemons,
  closeValidationElectronApp
} from './codex-validation-process-shutdown.mjs'

import {
  createValidationEnv,
  createValidationLayout,
  snapshotValidationState
} from './codex-real-account-validation-layout.mjs'
import { runInteractiveSession, writeReport } from './codex-real-account-validation-session.mjs'

const VALID_SCENARIOS = new Set(['mixed', 'managed-only', 'codex-lb'])

function parseArgs(argv) {
  const options = {
    scenario: 'mixed',
    dryRun: false,
    closeAfterLaunch: false,
    skipBuild: false,
    keep: false,
    reportPath: null,
    primaryHome: os.homedir(),
    configTemplate: null,
    tempParent: null,
    laneAwareContainment: false,
    systemDefaultRealHome: 'on'
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`)
      }
      index += 1
      return value
    }
    if (arg === '--scenario') {
      options.scenario = readValue()
    } else if (arg === '--report') {
      options.reportPath = path.resolve(readValue())
    } else if (arg === '--primary-home') {
      options.primaryHome = path.resolve(readValue())
    } else if (arg === '--config-template') {
      options.configTemplate = path.resolve(readValue())
    } else if (arg === '--temp-parent') {
      options.tempParent = path.resolve(readValue())
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--close-after-launch') {
      options.closeAfterLaunch = true
    } else if (arg === '--skip-build') {
      options.skipBuild = true
    } else if (arg === '--keep') {
      options.keep = true
    } else if (arg === '--system-default-real-home') {
      const value = readValue()
      if (value !== 'on' && value !== 'off') {
        throw new Error('--system-default-real-home must be "on" or "off"')
      }
      options.systemDefaultRealHome = value
    } else if (arg === '--lane-aware-containment') {
      // Why: on Windows the flag-ON system-default lane cannot be env-sandboxed
      // (native codex ignores USERPROFILE), so strict zero-event containment is
      // structurally unreachable there. This mode records codex's designed
      // volatile churn without aborting while every other real-home write stays
      // a hard failure. The absolute zero-event claim is carried by macOS runs.
      options.laneAwareContainment = true
    } else if (arg === '--help') {
      console.log(
        'Usage: node config/scripts/run-codex-real-account-validation.mjs [--scenario mixed|managed-only|codex-lb] [--config-template <path>] [--temp-parent <dir>] [--skip-build] [--dry-run] [--close-after-launch] [--keep] [--lane-aware-containment] [--system-default-real-home on|off] [--report <path>]'
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!VALID_SCENARIOS.has(options.scenario)) {
    throw new Error(`Invalid scenario: ${options.scenario}`)
  }
  if (options.scenario === 'codex-lb' && !options.configTemplate) {
    throw new Error('The codex-lb scenario requires --config-template outside primary ~/.codex')
  }
  return options
}

// Why: `npx` resolves to a .cmd shim on Windows that execFileSync cannot launch
// (ENOENT), so the harness could not build its own app there. Run the
// repository-local electron-vite JS entry with the current Node binary instead;
// process.execPath + a resolved .js path behaves identically on macOS, Linux,
// and Windows without a shell.
export function resolveElectronViteBuildCommand(repoRoot) {
  const electronViteEntry = path.join(
    repoRoot,
    'node_modules',
    'electron-vite',
    'bin',
    'electron-vite.js'
  )
  if (!existsSync(electronViteEntry)) {
    throw new Error(
      `Cannot build the validation app: electron-vite entry not found at ${electronViteEntry}. ` +
        'Install dependencies (pnpm install) or pass --skip-build with a prebuilt out/main/index.js.'
    )
  }
  return { command: process.execPath, args: [electronViteEntry, 'build', '--mode', 'e2e'] }
}

function buildAppIfNeeded(repoRoot, skipBuild) {
  const mainPath = path.join(repoRoot, 'out', 'main', 'index.js')
  if (skipBuild) {
    if (!existsSync(mainPath)) {
      throw new Error(`--skip-build requested, but ${mainPath} does not exist`)
    }
    return mainPath
  }
  const { command, args } = resolveElectronViteBuildCommand(repoRoot)
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, VITE_EXPOSE_STORE: 'true' }
  })
  return mainPath
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const layout = await createValidationLayout({
    primaryHome: options.primaryHome,
    tempParent: options.tempParent ?? undefined
  })
  const reportPath =
    options.reportPath ??
    path.join(os.tmpdir(), `orca-codex-real-account-${options.scenario}-${Date.now()}.json`)
  const launchEnv = createValidationEnv(process.env, layout, options)
  let app = null
  let tripwire = null
  const abortController = new AbortController()
  const abortForSignal = () => abortController.abort()
  process.once('SIGINT', abortForSignal)
  process.once('SIGTERM', abortForSignal)
  const report = {
    scenario: options.scenario,
    startedAt: new Date().toISOString(),
    reportVersion: 1,
    disposableHome: layout.homeDir,
    userDataDir: layout.userDataDir,
    primaryCodexHome: path.join(layout.primaryHome, '.codex'),
    electronPaths: null,
    checkpoints: [],
    terminalProbes: [],
    tripwire: null
  }

  try {
    await seedCompletedProfile(layout)
    await installCodexConfigTemplate(layout, options.configTemplate)
    tripwire = await startCodexPrimaryHomeTripwire({
      primaryHome: layout.primaryHome,
      onChange: (event) => {
        if (
          options.laneAwareContainment &&
          classifyCodexHomeTripwireEvent(event) === 'designed-system-default'
        ) {
          console.warn(
            '[LANE-DESIGNED] Real ~/.codex volatile churn from the system-default codex lane (recorded, not a violation)'
          )
          console.warn(JSON.stringify(event, null, 2))
          return
        }
        console.error('\u001b[31;1m[VALIDATION ABORTED] Primary ~/.codex changed\u001b[0m')
        console.error(JSON.stringify(event, null, 2))
        abortController.abort()
      }
    })
    report.checkpoints.push({
      label: 'prepared',
      ...(await snapshotValidationState(layout)),
      primaryTripwire: tripwire.getStatus()
    })
    await writeReport(reportPath, report)
    console.log(`Disposable HOME: ${layout.homeDir}`)
    console.log(`Disposable userData: ${layout.userDataDir}`)
    console.log(`Sanitized report: ${reportPath}`)

    if (!options.dryRun) {
      const mainPath = buildAppIfNeeded(repoRoot, options.skipBuild)
      app = await electron.launch({ args: [mainPath], env: launchEnv })
      report.electronPaths = await app.evaluate(({ app: electronApp }) => ({
        home: electronApp.getPath('home'),
        userData: electronApp.getPath('userData'),
        nodeHome: process.getBuiltinModule('node:os').homedir()
      }))
      if (
        !samePath(report.electronPaths.home, layout.homeDir) ||
        !samePath(report.electronPaths.nodeHome, layout.homeDir) ||
        !samePath(report.electronPaths.userData, layout.userDataDir)
      ) {
        throw new Error('Electron escaped the disposable validation boundary')
      }
      app.process().once('exit', () => abortController.abort())
      await writeReport(reportPath, report)
      if (!options.closeAfterLaunch) {
        await runInteractiveSession({
          layout,
          launchEnv,
          report,
          reportPath,
          tripwire,
          signal: abortController.signal
        })
      }
    }
  } finally {
    abortController.abort()
    try {
      await closeValidationElectronApp(app)
      await cleanupValidationDaemons(layout.userDataDir)
      if (tripwire) {
        const tripwireStatus = await tripwire.stop()
        report.tripwire = options.laneAwareContainment
          ? { ...tripwireStatus, laneAware: summarizeLaneAwareTripwire(tripwireStatus.events) }
          : tripwireStatus
      }
      report.checkpoints.push({ label: 'shutdown', ...(await snapshotValidationState(layout)) })
      report.completedAt = new Date().toISOString()
      await writeReport(reportPath, report)
    } finally {
      try {
        if (options.keep) {
          console.warn(`Credential-bearing disposable root kept at ${layout.tempRoot}`)
        } else {
          // Why: a detached codex descendant can briefly hold a Windows handle
          // in the disposable home; retry so cleanup never strands credentials.
          await rm(layout.tempRoot, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 250
          })
          console.log('Removed the credential-bearing disposable root.')
        }
      } finally {
        process.removeListener('SIGINT', abortForSignal)
        process.removeListener('SIGTERM', abortForSignal)
      }
    }
  }

  const tripwireFailed = report.tripwire
    ? options.laneAwareContainment
      ? report.tripwire.laneAware.violations.length > 0
      : !report.tripwire.clean
    : false
  if (tripwireFailed) {
    process.exitCode = 2
  } else {
    if (options.laneAwareContainment && report.tripwire?.events.length) {
      console.warn(
        `Lane-aware containment: ${report.tripwire.laneAware.designedLaneEvents.length} designed system-default event(s) recorded, 0 violations. Review them in the report.`
      )
    }
    console.log(`Validation harness complete. Report: ${reportPath}`)
  }
}

function summarizeLaneAwareTripwire(events) {
  const designedLaneEvents = []
  const violations = []
  for (const event of events) {
    if (classifyCodexHomeTripwireEvent(event) === 'designed-system-default') {
      designedLaneEvents.push(event)
    } else {
      violations.push(event)
    }
  }
  return { designedLaneEvents, violations }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
