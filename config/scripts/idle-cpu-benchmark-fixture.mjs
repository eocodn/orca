import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function runFixtureCommand(command, args, options = {}) {
  execFileSync(command, args, { stdio: options.stdio ?? 'pipe', encoding: 'utf8', ...options })
}

export function buildIdleCpuAppIfNeeded(root, skipBuild) {
  const mainPath = path.join(root, 'out', 'main', 'index.js')
  if (skipBuild && existsSync(mainPath)) {
    return mainPath
  }
  if (skipBuild) {
    throw new Error(`--skip-build requested, but ${mainPath} does not exist`)
  }
  console.log('[idle-cpu] building Electron app with electron-vite --mode e2e')
  runFixtureCommand('npx', ['electron-vite', 'build', '--mode', 'e2e'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_EXPOSE_STORE: 'true' }
  })
  return mainPath
}

export function makeCompletedIdleCpuOnboardingProfile() {
  return {
    settings: {
      telemetry: {
        optedIn: true,
        installId: '00000000-0000-4000-8000-000000000000',
        existedBeforeTelemetryRelease: false
      }
    },
    onboarding: {
      flowVersion: 2,
      closedAt: 1,
      outcome: 'completed',
      lastCompletedStep: 3
    },
    ui: {
      contextualToursSeenIds: [
        'workspace-board',
        'browser',
        'tasks',
        'automations',
        'workspace-creation'
      ],
      contextualToursAutoEligible: false,
      projectOrderManualDefaultNoticeDismissed: true
    }
  }
}

export function createIdleCpuRepo(worktreeCount) {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'orca-idle-cpu-repo-'))
  const cleanupDirs = [repoDir]
  runFixtureCommand('git', ['init'], { cwd: repoDir })
  runFixtureCommand('git', ['config', 'user.email', 'idle-cpu@test.local'], { cwd: repoDir })
  runFixtureCommand('git', ['config', 'user.name', 'Idle CPU Benchmark'], { cwd: repoDir })
  writeFileSync(path.join(repoDir, 'README.md'), '# Orca idle CPU benchmark\n')
  writeFileSync(
    path.join(repoDir, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`
  )
  mkdirSync(path.join(repoDir, 'src'), { recursive: true })
  writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const idleBenchmark = true\n')
  runFixtureCommand('git', ['add', '-A'], { cwd: repoDir })
  runFixtureCommand('git', ['commit', '-m', 'Initial idle CPU fixture'], { cwd: repoDir })
  for (let i = 2; i <= worktreeCount; i += 1) {
    const worktreeDir = path.join(
      path.dirname(repoDir),
      `orca-idle-cpu-worktree-${i}-${Date.now()}`
    )
    cleanupDirs.push(worktreeDir)
    runFixtureCommand('git', ['worktree', 'add', worktreeDir, '-b', `idle-cpu-${i}`], {
      cwd: repoDir
    })
  }
  return { repoDir, cleanupDirs }
}

export function idleCpuLaunchArgs(mainPath, headful) {
  if (headful || process.platform !== 'linux') {
    return [mainPath]
  }
  return [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--in-process-gpu',
    mainPath
  ]
}

export function sleepForIdleCpuBenchmark(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
