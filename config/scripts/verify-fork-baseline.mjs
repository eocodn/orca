import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASELINE_COMMIT = '79251d7a9861568dc261faabfa16df5347d1d008'
const BASELINE_PARENT = '886fa7b4389fd309aee6a8674554f542be3b0eea'
const BASELINE_TREE = '34a0b0777e7b92e07bd2cea148008ee7c70864c9'
const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const MINIMUM_REMOTE_BRANCHES = 3506
const MINIMUM_TAGS = 1018
const LICENSE_HOLDER = 'Lovecast Inc.'
const EXPECTED_SURFACES = new Set([
  'provenance', 'core-tests', 'web-build', 'mobile-typecheck', 'mobile-tests', 'windows-desktop'
])
const executeFile = promisify(execFile)

export async function verifyForkBaseline(root, runGit = createGitRunner(root)) {
  const [baseline, license, resultsJson, shallow, objectType, commitData, upstreamUrl, tagsText, branchesText] = await Promise.all([
    readFile(join(root, 'docs/fork-baseline.md'), 'utf8'),
    readFile(join(root, 'LICENSE'), 'utf8'),
    readFile(join(root, 'docs/fork-baseline-results.json'), 'utf8'),
    runGit(['rev-parse', '--is-shallow-repository']),
    runGit(['cat-file', '-t', BASELINE_COMMIT]),
    runGit(['show', '-s', '--format=%P%n%T', BASELINE_COMMIT]),
    runGit(['remote', 'get-url', 'upstream']),
    runGit(['for-each-ref', '--format=%(refname)', 'refs/tags']),
    runGit(['for-each-ref', '--format=%(refname)', 'refs/remotes/upstream'])
  ])
  await runGit(['merge-base', '--is-ancestor', BASELINE_COMMIT, 'HEAD'])
  const packageData = JSON.parse(await runGit(['show', `${BASELINE_COMMIT}:package.json`]))
  verifyBaselineResults(JSON.parse(resultsJson))
  const [baselineParent, baselineTree] = lines(commitData)
  const tags = lines(tagsText).length
  const remoteBranches = lines(branchesText).filter((ref) => !ref.endsWith('/HEAD')).length

  assertEqual(shallow, 'false', 'repository must not be shallow')
  assertEqual(objectType, 'commit', 'baseline object type')
  assertEqual(baselineParent, BASELINE_PARENT, 'baseline parent')
  assertEqual(baselineTree, BASELINE_TREE, 'baseline tree')
  assertEqual(upstreamUrl, UPSTREAM_URL, 'upstream remote')
  assertMinimum(tags, MINIMUM_TAGS, 'tag count')
  assertMinimum(remoteBranches, MINIMUM_REMOTE_BRANCHES, 'upstream branch count')
  assertIncludes(baseline, `Baseline commit: \`${BASELINE_COMMIT}\``, 'baseline commit')
  assertIncludes(baseline, `Upstream: \`${UPSTREAM_URL}\``, 'upstream URL')
  assertIncludes(baseline, `Package version: \`${packageData.version}\``, 'package version')
  assertIncludes(license, 'MIT License', 'MIT license identifier')
  assertIncludes(license, `Copyright (c) 2026 ${LICENSE_HOLDER}`, 'license holder')

  return {
    baselineCommit: BASELINE_COMMIT,
    baselineParent: BASELINE_PARENT,
    baselineTree: BASELINE_TREE,
    licenseHolder: LICENSE_HOLDER,
    productVersion: packageData.version,
    remoteBranches,
    tags
  }
}

export function verifyBaselineResults(evidence) {
  assertEqual(evidence.schemaVersion, 1, 'result schema version')
  assertEqual(evidence.baselineCommit, BASELINE_COMMIT, 'result baseline commit')
  if (!Array.isArray(evidence.surfaces)) throw new Error('fork baseline surfaces must be an array')
  const ids = new Set(evidence.surfaces.map(({ id }) => id))
  if (ids.size !== EXPECTED_SURFACES.size || [...EXPECTED_SURFACES].some((id) => !ids.has(id))) {
    throw new Error('fork baseline surface set mismatch')
  }
  for (const surface of evidence.surfaces) {
    if (!['pass', 'fail', 'not_run'].includes(surface.status)) {
      throw new Error(`fork baseline invalid status: ${surface.id}`)
    }
    if (surface.status === 'not_run') {
      if (surface.exitCode !== null || !surface.reason) throw new Error(`fork baseline unobserved result mismatch: ${surface.id}`)
    } else if (!Number.isInteger(surface.exitCode)) {
      throw new Error(`fork baseline observed exit code missing: ${surface.id}`)
    }
    if (surface.status === 'pass' && surface.exitCode !== 0) throw new Error(`fork baseline pass exit mismatch: ${surface.id}`)
    if (surface.status === 'fail' && surface.exitCode === 0) throw new Error(`fork baseline failure exit mismatch: ${surface.id}`)
    if (!surface.command || !surface.summary) throw new Error(`fork baseline evidence incomplete: ${surface.id}`)
  }
  return evidence.surfaces
}

function createGitRunner(root) {
  return async (args) => (
    await executeFile('git', ['-c', `safe.directory=${root}`, '-C', root, ...args], { encoding: 'utf8' })
  ).stdout.trim()
}

function lines(value) {
  return value.trim() ? value.trim().split('\n') : []
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`fork baseline ${label} mismatch: ${actual}`)
}

function assertMinimum(actual, minimum, label) {
  if (actual < minimum) throw new Error(`fork baseline ${label} incomplete: ${actual} < ${minimum}`)
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) throw new Error(`fork baseline ${label} mismatch`)
}

const invokedPath = process.argv[1]
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  verifyForkBaseline(process.cwd())
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
}
