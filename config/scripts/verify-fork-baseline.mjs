import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASELINE_COMMIT = '79251d7a9861568dc261faabfa16df5347d1d008'
const BASELINE_PARENT = '886fa7b4389fd309aee6a8674554f542be3b0eea'
const BASELINE_TREE = '34a0b0777e7b92e07bd2cea148008ee7c70864c9'
const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const MINIMUM_REMOTE_BRANCHES = 3506
const MINIMUM_TAGS = 1018
const REMOTE_BRANCH_NAMES_SHA256 = '7d5594fbf0d61f6761f35d222cd9e4e2719c8e89eebcb6c1ec71189369d8c4a2'
const TAG_NAMES_SHA256 = 'e6c80643da127080b15ec24c400881c7eaadcce5c84ac9e82bcb220ec05fd3a9'
const LICENSE_HOLDER = 'Lovecast Inc.'
const EXPECTED_SURFACES = new Set([
  'provenance', 'core-tests', 'web-build', 'mobile-typecheck', 'mobile-tests', 'windows-desktop'
])
const COMPOSE_SERVICES = new Map([
  ['provenance', 'baseline-tests'],
  ['core-tests', 'baseline-core-tests'],
  ['web-build', 'baseline-web-build'],
  ['mobile-typecheck', 'baseline-mobile-typecheck'],
  ['mobile-tests', 'baseline-mobile-tests']
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
  const [baselineParent, baselineTree] = lines(commitData)
  const tags = lines(tagsText).length
  const tagNames = lines(tagsText)
  const remoteBranchNames = lines(branchesText).filter((ref) => !ref.endsWith('/HEAD'))
  const remoteBranches = remoteBranchNames.length

  assertEqual(shallow, 'false', 'repository must not be shallow')
  assertEqual(objectType, 'commit', 'baseline object type')
  assertEqual(baselineParent, BASELINE_PARENT, 'baseline parent')
  assertEqual(baselineTree, BASELINE_TREE, 'baseline tree')
  assertEqual(upstreamUrl, UPSTREAM_URL, 'upstream remote')
  assertMinimum(tags, MINIMUM_TAGS, 'tag count')
  assertMinimum(remoteBranches, MINIMUM_REMOTE_BRANCHES, 'upstream branch count')
  assertEqual(hashLines(tagNames), TAG_NAMES_SHA256, 'tag ref set')
  assertEqual(hashLines(remoteBranchNames), REMOTE_BRANCH_NAMES_SHA256, 'upstream branch ref set')
  assertIncludes(baseline, `Baseline commit: \`${BASELINE_COMMIT}\``, 'baseline commit')
  assertIncludes(baseline, `Upstream: \`${UPSTREAM_URL}\``, 'upstream URL')
  assertIncludes(baseline, `Package version: \`${packageData.version}\``, 'package version')
  assertIncludes(license, 'MIT License', 'MIT license identifier')
  assertIncludes(license, `Copyright (c) 2026 ${LICENSE_HOLDER}`, 'license holder')
  const evidence = JSON.parse(resultsJson)
  const surfaces = verifyBaselineResults(evidence)
  const head = await runGit(['rev-parse', 'HEAD'])
  await runGit(['diff', '--quiet', evidence.verifierCommit, 'HEAD', '--', 'Dockerfile.baseline', 'compose.yml', 'config/scripts/verify-fork-baseline.mjs', 'config/scripts/verify-fork-baseline.node-test.mjs'])
  await verifyObservationArtifacts(root, surfaces, evidence.verifierCommit, head)

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
  if (!/^[a-f0-9]{40}$/.test(evidence.verifierCommit)) throw new Error('fork baseline verifier commit invalid')
  if (!Array.isArray(evidence.surfaces)) throw new Error('fork baseline surfaces must be an array')
  const ids = new Set(evidence.surfaces.map(({ id }) => id))
  if (evidence.surfaces.length !== EXPECTED_SURFACES.size || ids.size !== EXPECTED_SURFACES.size || [...EXPECTED_SURFACES].some((id) => !ids.has(id))) {
    throw new Error('fork baseline surface set mismatch')
  }
  const runIds = new Set()
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
    const service = COMPOSE_SERVICES.get(surface.id)
    if (service) {
      if (surface.status === 'not_run') throw new Error(`fork baseline Linux surface was not run: ${surface.id}`)
      if (!/^[a-z0-9][a-z0-9-]{5,63}$/.test(surface.runId)) throw new Error(`fork baseline run ID invalid: ${surface.id}`)
      if (runIds.has(surface.runId)) throw new Error(`fork baseline run ID reused: ${surface.runId}`)
      runIds.add(surface.runId)
      const expected = `ADE_BASELINE_RUN_ID=${surface.runId} docker compose up --build --abort-on-container-exit --exit-code-from ${service} ${service}`
      assertEqual(surface.command, expected, `${surface.id} command`)
      if (!surface.artifact?.path || !/^[a-f0-9]{64}$/.test(surface.artifact.sha256)) {
        throw new Error(`fork baseline artifact missing: ${surface.id}`)
      }
    } else {
      assertEqual(surface.command, 'pnpm build:win', 'windows command')
    }
  }
  return evidence.surfaces
}

async function verifyObservationArtifacts(root, surfaces, verifierCommit, head) {
  for (const surface of surfaces.filter(({ artifact }) => artifact)) {
    assertEqual(surface.artifact.path, `docs/baseline-evidence/${surface.id}.json`, `${surface.id} artifact path`)
    const content = await readFile(join(root, surface.artifact.path), 'utf8')
    const digest = createHash('sha256').update(content).digest('hex')
    assertEqual(digest, surface.artifact.sha256, `${surface.id} artifact digest`)
    const observation = JSON.parse(content)
    assertEqual(observation.surface, surface.id, `${surface.id} artifact surface`)
    assertEqual(observation.runId, surface.runId, `${surface.id} artifact run ID`)
    assertEqual(observation.exitCode, surface.exitCode, `${surface.id} artifact exit code`)
    assertEqual(observation.sourceCommit, surface.id === 'provenance' ? verifierCommit : BASELINE_COMMIT, `${surface.id} artifact source commit`)
    assertEqual(observation.status, surface.status, `${surface.id} artifact status`)
    const candidateCommand = `ADE_BASELINE_RUN_ID=${surface.runId} docker compose up --build --abort-on-container-exit --exit-code-from baseline-verifier-candidate baseline-verifier-candidate`
    if (surface.id === 'provenance' && observation.mode === 'candidate') {
      assertEqual(head, verifierCommit, 'candidate artifact may only bootstrap its own verifier commit')
      assertEqual(observation.command, candidateCommand, 'provenance candidate command')
    } else {
      assertEqual(observation.mode ?? 'full', 'full', `${surface.id} artifact mode`)
      assertEqual(observation.command, surface.command, `${surface.id} artifact command`)
    }
    assertEqual(observation.summary, surface.summary, `${surface.id} artifact summary`)
    const startedAt = Date.parse(observation.startedAt)
    const finishedAt = Date.parse(observation.finishedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt || !/^sha256:[a-f0-9]{64}$/.test(observation.image)) {
      throw new Error(`fork baseline artifact metadata incomplete: ${surface.id}`)
    }
  }
}

function createGitRunner(root) {
  return async (args) => (
    await executeFile('git', ['-c', `safe.directory=${root}`, '-C', root, ...args], { encoding: 'utf8' })
  ).stdout.trim()
}

function lines(value) {
  return value.trim() ? value.trim().split('\n') : []
}

function hashLines(values) {
  return createHash('sha256').update(values.join('\n')).digest('hex')
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
