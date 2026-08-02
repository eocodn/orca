const DEFAULT_WARMUP_MS = 15_000
const DEFAULT_SAMPLE_MS = 30_000
const DEFAULT_INTERVAL_MS = 1_000
const DEFAULT_WORKTREE_COUNT = 1

export function parseIdleCpuBenchmarkArgs(argv) {
  const options = {
    warmupMs: DEFAULT_WARMUP_MS,
    sampleMs: DEFAULT_SAMPLE_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    worktrees: DEFAULT_WORKTREE_COUNT,
    skipBuild: false,
    headful: false,
    output: null,
    disableRendererAnimations: false,
    syntheticVisibleSpinners: 0,
    syntheticSpinnerAnimation: 'smooth',
    syntheticSpinnerSteps: 12
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
    if (arg === '--') {
      continue
    } else if (arg === '--warmup-ms') {
      options.warmupMs = Number(readValue())
    } else if (arg === '--sample-ms') {
      options.sampleMs = Number(readValue())
    } else if (arg === '--interval-ms') {
      options.intervalMs = Number(readValue())
    } else if (arg === '--worktrees') {
      options.worktrees = Number(readValue())
    } else if (arg === '--output') {
      options.output = readValue()
    } else if (arg === '--skip-build') {
      options.skipBuild = true
    } else if (arg === '--headful') {
      options.headful = true
    } else if (arg === '--disable-renderer-animations') {
      options.disableRendererAnimations = true
    } else if (arg === '--synthetic-visible-spinners') {
      options.syntheticVisibleSpinners = Number(readValue())
    } else if (arg === '--synthetic-spinner-animation') {
      options.syntheticSpinnerAnimation = readValue()
    } else if (arg === '--synthetic-spinner-steps') {
      options.syntheticSpinnerSteps = Number(readValue())
    } else if (arg === '--help') {
      printIdleCpuBenchmarkUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  for (const key of [
    'warmupMs',
    'sampleMs',
    'intervalMs',
    'worktrees',
    'syntheticVisibleSpinners',
    'syntheticSpinnerSteps'
  ]) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`Invalid --${key}: ${options[key]}`)
    }
  }
  options.worktrees = Math.max(1, Math.floor(options.worktrees))
  options.intervalMs = Math.max(250, Math.floor(options.intervalMs))
  options.syntheticVisibleSpinners = Math.max(0, Math.floor(options.syntheticVisibleSpinners))
  options.syntheticSpinnerSteps = Math.max(1, Math.floor(options.syntheticSpinnerSteps))
  if (!['smooth', 'steps'].includes(options.syntheticSpinnerAnimation)) {
    throw new Error(`Invalid --synthetic-spinner-animation: ${options.syntheticSpinnerAnimation}`)
  }
  return options
}

export function printIdleCpuBenchmarkUsage() {
  console.log(
    `Usage: node config/scripts/run-idle-cpu-benchmark.mjs [options]\n\nOptions:\n  --warmup-ms <n>    Time to wait after app readiness before sampling (default ${DEFAULT_WARMUP_MS})\n  --sample-ms <n>    Sampling window duration (default ${DEFAULT_SAMPLE_MS})\n  --interval-ms <n>  Sampling cadence (default ${DEFAULT_INTERVAL_MS})\n  --worktrees <n>    Seed repo worktree count, including primary (default ${DEFAULT_WORKTREE_COUNT})\n  --headful          Show the Electron window while measuring\n  --skip-build       Reuse out/main/index.js instead of building first\n  --output <path>    Write JSON report to this path\n  --disable-renderer-animations  Inject measurement-only CSS that disables animations/transitions\n  --synthetic-visible-spinners <n>  Measurement-only: add visible working spinners\n  --synthetic-spinner-animation <smooth|steps>  Spinner animation style (default smooth)\n  --synthetic-spinner-steps <n>  Step count for --synthetic-spinner-animation steps (default 12)\n`
  )
}
