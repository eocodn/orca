#!/usr/bin/env node
/**
 * A/B benchmark for worktree deletion against real Orca dev instances.
 *
 * Usage:
 *   pnpm bench:worktree-deletion -- --instance baseline=/path/to/main \
 *     --instance candidate=. --iterations 3 --history-files 10000
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_ITERATIONS = 3
const DEFAULT_HISTORY_FILES = 10_000
const CDP_START_PORT = 9_700
const START_TIMEOUT_MS = 180_000
const IPC_TIMEOUT_MS = 90_000
const resultsRoot = path.resolve(import.meta.dirname, 'results')

function parseArgs(argv) {
  const options = {
    instances: [],
    iterations: DEFAULT_ITERATIONS,
    historyFiles: DEFAULT_HISTORY_FILES,
    keepFixture: false
  }
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') {
      continue
    }
    if (value === '--help' || value === '-h') {
      printHelp()
      process.exit(0)
    }
    if (value === '--keep-fixture') {
      options.keepFixture = true
      continue
    }
    const next = () => {
      const result = argv[++index]
      if (!result) {
        throw new Error(`${value} needs a value`)
      }
      return result
    }
    if (value === '--instance') {
      const entry = next()
      const separator = entry.indexOf('=')
      if (separator <= 0) {
        throw new Error('--instance must use label=/absolute/or/relative/path')
      }
      options.instances.push({
        label: entry.slice(0, separator),
        repoRoot: path.resolve(entry.slice(separator + 1))
      })
    } else if (value === '--iterations') {
      options.iterations = readPositiveInteger(value, next())
    } else if (value === '--history-files') {
      options.historyFiles = readPositiveInteger(value, next())
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  if (options.instances.length === 0) {
    options.instances.push({ label: 'candidate', repoRoot: process.cwd() })
  }
  return options
}

function readPositiveInteger(flag, value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return number
}

function printHelp() {
  console.log(`Usage:
  pnpm bench:worktree-deletion -- [options]

Options:
  --instance <label=path>  Dev checkout to launch; repeat for A/B comparison
  --iterations <count>     Deletions per instance (default: ${DEFAULT_ITERATIONS})
  --history-files <count>  Files seeded in each worktree history (default: ${DEFAULT_HISTORY_FILES})
  --keep-fixture           Keep disposable profiles and repos for inspection`)
}

import { benchmarkInstance } from './worktree-deletion-dev-benchmark-runner.mjs'
function printComparison(results) {
  console.log('\nWorktree deletion results')
  console.table(
    results.map((result) => ({
      instance: result.label,
      'delete median ms': result.summary.median,
      'delete p95 ms': result.summary.p95,
      'main IPC p95 ms': result.ipcSummary.p95,
      'main IPC max ms': result.ipcSummary.max,
      restart: result.restartPassed ? 'pass' : 'fail'
    }))
  )
  if (results.length === 2) {
    const [baseline, candidate] = results
    const percent = round(
      ((baseline.summary.median - candidate.summary.median) / baseline.summary.median) * 100
    )
    console.log(
      `${candidate.label} median deletion is ${Math.abs(percent)}% ${
        percent >= 0 ? 'faster' : 'slower'
      } than ${baseline.label}.`
    )
  }
}

const options = parseArgs(process.argv)
mkdirSync(resultsRoot, { recursive: true })
const results = []
for (const [index, instance] of options.instances.entries()) {
  results.push(await benchmarkInstance(instance, index, options))
}
const artifact = {
  benchmark: 'worktree-deletion-dev',
  createdAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  results
}
const artifactPath = path.join(
  resultsRoot,
  `worktree-deletion-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`
)
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`)
printComparison(results)
console.log(`Artifact: ${artifactPath}`)
