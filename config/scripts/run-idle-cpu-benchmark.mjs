#!/usr/bin/env node
import { _electron as electron } from '@stablyai/playwright-test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installSyntheticVisibleSpinners } from './idle-cpu-synthetic-spinners.mjs'
import { parseIdleCpuBenchmarkArgs } from './idle-cpu-benchmark-options.mjs'
import {
  buildIdleCpuAppIfNeeded,
  createIdleCpuRepo,
  idleCpuLaunchArgs,
  makeCompletedIdleCpuOnboardingProfile,
  sleepForIdleCpuBenchmark
} from './idle-cpu-benchmark-fixture.mjs'
import {
  classifyIdleCpuProcess,
  descendantsOfIdleCpuProcess,
  readIdleCpuProcessRows,
  terminateIdleCpuProcesses
} from './idle-cpu-process-inventory.mjs'
import {
  collectIdleCpuRendererState,
  summarizeIdleCpuProcessInventory,
  summarizeIdleCpuSamples
} from './idle-cpu-benchmark-report.mjs'

async function main() {
  const options = parseIdleCpuBenchmarkArgs(process.argv.slice(2))
  const root = path.resolve(import.meta.dirname, '..', '..')
  const mainPath = buildIdleCpuAppIfNeeded(root, options.skipBuild)
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'orca-idle-cpu-userdata-'))
  const { repoDir, cleanupDirs } = createIdleCpuRepo(options.worktrees)
  writeFileSync(
    path.join(userDataDir, 'orca-data.json'),
    `${JSON.stringify(makeCompletedIdleCpuOnboardingProfile(), null, 2)}\n`
  )
  const {
    ELECTRON_RUN_AS_NODE,
    CODEX_HOME: _codexHome,
    ORCA_CODEX_HOME: _orcaCodexHome,
    ...cleanEnv
  } = process.env
  void ELECTRON_RUN_AS_NODE
  void _codexHome
  void _orcaCodexHome
  // Why: real-home rollout work would both contaminate idle measurements and
  // expose the developer Codex profile to this disposable Electron launch.
  const isolatedHome = path.join(userDataDir, 'home')
  mkdirSync(isolatedHome, { recursive: true })
  const app = await electron.launch({
    args: idleCpuLaunchArgs(mainPath, options.headful),
    env: {
      ...cleanEnv,
      NODE_ENV: 'development',
      ORCA_E2E_USER_DATA_DIR: userDataDir,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      ORCA_E2E_HOME_DIR: isolatedHome,
      ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME: '0',
      ...(options.headful ? { ORCA_E2E_HEADFUL: '1' } : { ORCA_E2E_HEADLESS: '1' })
    }
  })
  const rootPid = app.process().pid
  try {
    const page = await app.firstWindow({ timeout: 120_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
    const measurementCss = []
    if (options.disableRendererAnimations) {
      measurementCss.push(
        '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'
      )
    }
    if (measurementCss.length > 0) {
      await page.addStyleTag({ content: measurementCss.join('\n') })
    }
    await installSyntheticVisibleSpinners(
      page,
      options.syntheticVisibleSpinners,
      options.syntheticSpinnerAnimation,
      options.syntheticSpinnerSteps
    )
    await page.evaluate(async (repoPath) => {
      await window.api.repos.add({ path: repoPath })
      const store = window.__store
      await store?.getState().fetchRepos()
      const repo = store?.getState().repos.find((candidate) => candidate.path === repoPath)
      if (repo) {
        await store.getState().updateRepo(repo.id, { externalWorktreeVisibility: 'show' })
        await store.getState().fetchWorktrees(repo.id)
      }
    }, repoDir)
    await page.waitForFunction(
      () => window.__store?.getState().workspaceSessionReady === true,
      null,
      { timeout: 60_000 }
    )
    console.log(
      `[idle-cpu] root pid=${rootPid}; warmup=${options.warmupMs}ms sample=${options.sampleMs}ms interval=${options.intervalMs}ms worktrees=${options.worktrees}`
    )
    await sleepForIdleCpuBenchmark(options.warmupMs)
    const rendererIdleState = await collectIdleCpuRendererState(page)
    const deadline = Date.now() + options.sampleMs
    const samples = []
    let previousSnapshot = null
    while (Date.now() <= deadline || samples.length === 0) {
      const sampledAt = Date.now()
      const processRows = descendantsOfIdleCpuProcess(readIdleCpuProcessRows(), rootPid)
      const rawProcesses = processRows.map((row) => ({
        ...row,
        kind: classifyIdleCpuProcess(row, rootPid)
      }))
      if (previousSnapshot) {
        const elapsedSeconds = Math.max(0.001, (sampledAt - previousSnapshot.at) / 1000)
        const previousByPid = new Map(previousSnapshot.processes.map((proc) => [proc.pid, proc]))
        const processes = rawProcesses.map((row) => {
          const previous = previousByPid.get(row.pid)
          const canComputeDelta =
            typeof row.cpuTimeSeconds === 'number' && typeof previous?.cpuTimeSeconds === 'number'
          const cpu = canComputeDelta
            ? Math.max(0, ((row.cpuTimeSeconds - previous.cpuTimeSeconds) / elapsedSeconds) * 100)
            : row.percentCpu
          return { ...row, cpu }
        })
        samples.push({
          at: sampledAt,
          elapsedMs: sampledAt - previousSnapshot.at,
          totalCpuPercent: processes.reduce((sum, proc) => sum + proc.cpu, 0),
          totalRssBytes: processes.reduce((sum, proc) => sum + proc.rssBytes, 0),
          processes
        })
      }
      previousSnapshot = { at: sampledAt, processes: rawProcesses }
      await sleepForIdleCpuBenchmark(options.intervalMs)
    }
    const report = {
      benchmark: 'orca-idle-cpu',
      createdAt: new Date().toISOString(),
      options,
      rootPid,
      platform: { platform: process.platform, arch: process.arch, cpus: os.cpus().length },
      rendererIdleState,
      sampleCount: samples.length,
      summary: summarizeIdleCpuSamples(samples),
      processInventory: summarizeIdleCpuProcessInventory(samples),
      samples
    }
    if (options.output) {
      mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true })
      writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`)
      console.log(`[idle-cpu] wrote ${String(options.output)}`)
    }
    console.log(
      JSON.stringify(
        {
          summary: report.summary,
          processInventory: report.processInventory,
          sampleCount: report.sampleCount
        },
        null,
        2
      )
    )
  } finally {
    const launchedProcesses = descendantsOfIdleCpuProcess(readIdleCpuProcessRows(), rootPid).filter(
      (proc) => proc.pid !== rootPid
    )
    await app.close().catch(() => undefined)
    await sleepForIdleCpuBenchmark(250)
    terminateIdleCpuProcesses(launchedProcesses)
    rmSync(userDataDir, { recursive: true, force: true })
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
