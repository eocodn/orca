#!/usr/bin/env node
/**
 * Orca startup-time benchmark.
 *
 * Launches the built app (out/) against a synthetic userData fixture that
 * mimics a long-lived real profile (tens of thousands of Chromium cache
 * files — the documented pathological case for the win32 startup ACL grant),
 * parses `ORCA_STARTUP_DIAGNOSTICS=1` milestone lines from stderr, and
 * reports per-phase timings across iterations.
 *
 * Usage:
 *   node tools/benchmarks/startup-time-bench.mjs --label baseline
 *     [--iterations 5] [--files 28000] [--fixture-dir <path>]
 *     [--state-profile none|restored-local-tabs] [--session-tabs 200]
 *     [--github-repos 3] [--gh-hang-ms 30000]
 *     [--wait-for-event renderer-startup-hydration-done]
 *     [--exe <path-to-packaged-Orca>] [--timeout-ms 240000]
 *
 * Issue #7225 freeze reproduction: `--github-repos N` seeds N git repos with
 * GitHub remotes and no configured username, so repo hydration reaches the
 * `gh` login probe; `--gh-hang-ms` puts a fake `gh` on PATH that hangs like a
 * blackholed api.github.com. The child it spawns survives the probe's timeout
 * kill while holding the inherited stdio pipe — the exact mechanism that
 * turns a 2.5s execSync timeout into a minutes-long main-thread stall.
 *
 * Prereq (when not using --exe): `pnpm build:electron-vite` so out/ exists.
 * Results: tools/benchmarks/results/startup-<label>-<timestamp>.json
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { join, resolve } from 'node:path'

const scriptDir = import.meta.dirname
const repoRoot = resolve(scriptDir, '..', '..')
const require = createRequire(import.meta.url)

function parseArgs(argv) {
  const args = {
    label: 'run',
    iterations: 5,
    files: 28000,
    fixtureDir: null,
    exe: null,
    timeoutMs: 240000,
    stateProfile: 'none',
    sessionTabs: 0,
    githubRepos: 0,
    ghHangMs: 0,
    waitForEvent: 'did-finish-load',
    // How long the app stays alive after did-finish-load before the harness
    // kills it. Raise to let background work (e.g. the async win32 ACL grant)
    // complete the way it would in a real session.
    lingerMs: 500
  }
  for (let i = 2; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case '--label':
        args.label = next()
        break
      case '--iterations':
        args.iterations = Number(next())
        break
      case '--files':
        args.files = Number(next())
        break
      case '--fixture-dir':
        args.fixtureDir = next()
        break
      case '--exe':
        args.exe = next()
        break
      case '--timeout-ms':
        args.timeoutMs = Number(next())
        break
      case '--state-profile':
        args.stateProfile = next()
        break
      case '--session-tabs':
        args.sessionTabs = Number(next())
        break
      case '--github-repos':
        args.githubRepos = Number(next())
        break
      case '--gh-hang-ms':
        args.ghHangMs = Number(next())
        break
      case '--wait-for-event':
        args.waitForEvent = next()
        break
      case '--linger-ms':
        args.lingerMs = Number(next())
        break
      default:
        throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return args
}

/**
 * Build a userData tree shaped like a real long-lived profile. The file count
 * drives the win32 icacls walk cost; contents are irrelevant, so files are
 * tiny. Layout mirrors Chromium cache dirs plus a few Orca-owned dirs.
 */
import { buildLaunchEnvironment, ensureFixture } from './startup-time-benchmark-fixture.mjs'
function killProcessTree(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      proc.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
}

function parseStartupLine(line) {
  const match = /^\[startup\] (\S+)(.*)$/.exec(line)
  if (!match) {
    return null
  }
  const details = {}
  const detailText = match[2].trim()
  if (detailText) {
    for (const pair of detailText.match(/(\S+?)=("[^"]*"|\S+)/g) ?? []) {
      const eq = pair.indexOf('=')
      const key = pair.slice(0, eq)
      let value = pair.slice(eq + 1)
      try {
        value = JSON.parse(value)
      } catch {
        // keep raw string
      }
      details[key] = value
    }
  }
  return { event: match[1], details }
}

function runIteration({ exe, timeoutMs, lingerMs, waitForEvent, launchEnv }) {
  return new Promise((resolvePromise) => {
    // Why: npm's `electron` package exposes the platform-specific executable;
    // hardcoding electron.exe made this benchmark unusable on macOS/Linux.
    const command = exe ?? require('electron')
    const commandArgs = exe ? [] : [repoRoot]
    const events = []
    const startedAt = process.hrtime.bigint()
    const child = spawn(command, commandArgs, {
      env: launchEnv,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let finished = false
    let buffer = ''
    const finish = (outcome) => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      // Keep the app alive briefly so trailing diagnostic lines (and, with
      // --linger-ms raised, background work like the async ACL grant) finish.
      setTimeout(() => {
        killProcessTree(child)
        resolvePromise({ outcome, events })
      }, lingerMs)
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
        const parsed = parseStartupLine(line)
        if (!parsed) {
          continue
        }
        const harnessMs = Number(process.hrtime.bigint() - startedAt) / 1e6
        events.push({ ...parsed, harnessMs: Math.round(harnessMs * 10) / 10 })
        if (parsed.event === waitForEvent) {
          finish('ok')
        }
      }
    })
    child.on('exit', () => finish('early-exit'))
    child.on('error', () => finish('spawn-error'))
  })
}

function eventTime(events, name, key) {
  const entry = events.find((event) => event.event === name)
  if (!entry) {
    return null
  }
  return key === 't'
    ? typeof entry.details.t === 'number'
      ? entry.details.t
      : null
    : entry.harnessMs
}

function derivePhases(events) {
  const aclStart = eventTime(events, 'acl-grant-start', 't')
  const aclDone = eventTime(events, 'acl-grant-done', 't')
  return {
    startupJsonParseMs: delta(
      events,
      'persistence-json-parse-start',
      'persistence-json-parse-done'
    ),
    startupStoreLoadMs: delta(events, 'persistence-load-start', 'persistence-load-done'),
    spawnToAppReady: eventTime(events, 'app-ready', 'harness'),
    appReadyToServices: delta(events, 'app-ready', 'services-initialized'),
    servicesToI18n: delta(events, 'services-initialized', 'i18n-ready'),
    i18nToOpenWindow: delta(events, 'i18n-ready', 'open-main-window-start'),
    daemonInitMs: delta(events, 'daemon-init-start', 'daemon-init-done'),
    aclGrantMs: aclStart !== null && aclDone !== null ? aclDone - aclStart : null,
    windowCreatedToLoadStart: delta(events, 'window-created', 'load-start'),
    windowCreatedToLoaded: delta(events, 'window-created', 'did-finish-load'),
    totalToWindowCreated: eventTime(events, 'window-created', 'harness'),
    totalToDidFinishLoad: eventTime(events, 'did-finish-load', 'harness'),
    didFinishLoadToWorkspaceReady: delta(
      events,
      'did-finish-load',
      'renderer-startup-hydration-done'
    ),
    totalToWorkspaceReady: eventTime(events, 'renderer-startup-hydration-done', 'harness'),
    rendererReconnectTerminalsMs:
      eventDetailsNumber(events, 'renderer-reconnect-terminals-done', 'durationMs') ??
      delta(
        events,
        'renderer-first-window-services-await-done',
        'renderer-reconnect-terminals-done'
      ),
    // Worst single main-thread stall observed by the event-loop probe — the
    // direct measurement of issue #7225's "Not Responding" freeze.
    maxEventLoopStallMs: maxEventDetailsNumber(events, 'event-loop-stall', 'maxGapMs')
  }
}

function maxEventDetailsNumber(events, name, key) {
  let max = null
  for (const event of events) {
    if (event.event !== name) {
      continue
    }
    const value = event.details[key]
    if (typeof value === 'number' && (max === null || value > max)) {
      max = value
    }
  }
  return max
}

function eventDetailsNumber(events, name, key) {
  const value = events.find((event) => event.event === name)?.details[key]
  return typeof value === 'number' ? value : null
}

function delta(events, from, to) {
  const a = eventTime(events, from, 't')
  const b = eventTime(events, to, 't')
  return a !== null && b !== null ? b - a : null
}

function median(values) {
  const usable = values.filter((value) => typeof value === 'number').sort((a, b) => a - b)
  if (usable.length === 0) {
    return null
  }
  const mid = Math.floor(usable.length / 2)
  return usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2
}

// Results are committed as PR evidence — keep home-anchored paths out of them.
function sanitizeLocalPath(value) {
  if (typeof value !== 'string') {
    return value
  }
  const home = os.homedir()
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value
}

function formatMs(value) {
  if (value === null) {
    return 'n/a'
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`
}

async function main() {
  const args = parseArgs(process.argv)
  if (!['none', 'restored-local-tabs'].includes(args.stateProfile)) {
    throw new Error(`Unknown state profile: ${args.stateProfile}`)
  }
  const fixtureDir = resolve(
    args.fixtureDir ??
      join(
        os.tmpdir(),
        'orca-startup-bench',
        `userdata-${args.files}-${args.stateProfile}-${args.sessionTabs}-gh${args.githubRepos}`
      )
  )
  mkdirSync(fixtureDir, { recursive: true })
  ensureFixture(fixtureDir, {
    fileCount: args.files,
    stateProfile: args.stateProfile,
    sessionTabs: args.sessionTabs,
    githubRepos: args.githubRepos
  })
  const ghShimDir = writeGhShim(fixtureDir, args.ghHangMs)
  const launchEnv = buildLaunchEnvironment({
    fixtureDir,
    githubRepos: args.githubRepos,
    ghShimDir
  })

  if (!args.exe && !existsSync(join(repoRoot, 'out', 'main', 'index.js'))) {
    throw new Error('out/main/index.js missing — run `pnpm build:electron-vite` first')
  }

  const iterations = []
  for (let i = 0; i < args.iterations; i++) {
    process.stdout.write(`[bench] iteration ${i + 1}/${args.iterations}… `)
    const result = await runIteration({
      exe: args.exe,
      timeoutMs: args.timeoutMs,
      lingerMs: args.lingerMs,
      waitForEvent: args.waitForEvent,
      launchEnv
    })
    const phases = derivePhases(result.events)
    iterations.push({ ...result, phases })
    console.log(
      `${result.outcome} total=${formatMs(phases.totalToDidFinishLoad)} acl=${formatMs(phases.aclGrantMs)} maxStall=${formatMs(phases.maxEventLoopStallMs)}`
    )
    // Let the OS settle between launches (process teardown, file handles).
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1500))
  }

  const phaseNames = Object.keys(iterations[0]?.phases ?? {})
  const summary = {}
  for (const name of phaseNames) {
    summary[name] = median(iterations.map((iteration) => iteration.phases[name]))
  }

  const resultsDir = join(scriptDir, 'results')
  mkdirSync(resultsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(resultsDir, `startup-${args.label}-${stamp}.json`)
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        label: args.label,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus()[0]?.model,
        fixtureDir: sanitizeLocalPath(fixtureDir),
        fixtureFiles: args.files,
        stateProfile: args.stateProfile,
        sessionTabs: args.sessionTabs,
        githubRepos: args.githubRepos,
        ghHangMs: args.ghHangMs,
        waitForEvent: args.waitForEvent,
        exe: sanitizeLocalPath(args.exe),
        iterations,
        summaryMedianMs: summary
      },
      null,
      2
    )
  )

  console.log(`\n[bench] label=${args.label} (medians over ${iterations.length} runs)`)
  console.log('| phase | median |')
  console.log('|---|---|')
  for (const name of phaseNames) {
    console.log(`| ${name} | ${formatMs(summary[name])} |`)
  }
  console.log(`\n[bench] results written to ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
