import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REQUIRED_AREAS = new Set([
  'workspace-registration-restore', 'worktree-preflight', 'terminal-lifecycle', 'wsl-context',
  'ssh-reconnect-forward', 'session-synchronization', 'file-read-write-watch', 'git-workflow',
  'mobile-pairing-stream', 'web-remote-session', 'editor-file-tree-source-control',
  'provider-integrations', 'mcp-configuration'
])
const ALLOWED_LAYERS = new Set(['removed-feature-audit', 'native-smoke', 'headless-core', 'core-integration', 'component'])

export async function verifyCharacterizationPlan(root) {
  const [rulesDocument, contractRulesDocument, overridesDocument, contractsDocument] = await Promise.all([
    readJson(join(root, 'config/characterization/playwright-intent-rules.json')),
    readJson(join(root, 'config/characterization/playwright-contract-rules.json')),
    readJson(join(root, 'config/characterization/playwright-intent-overrides.json')),
    readJson(join(root, 'config/characterization/area-contracts.json'))
  ])
  const specs = (await walk(join(root, 'tests/e2e')))
    .map((path) => relative(root, path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.spec.ts'))
  const rules = rulesDocument.rules.map((rule) => ({ ...rule, expression: new RegExp(rule.pattern) }))
  assertUnique(rules.map(({ id }) => id), 'intent rule')
  validateRules(rules)
  const contractRules = contractRulesDocument.rules.map((rule) => ({ ...rule, expression: new RegExp(rule.pattern) }))
  assertUnique(contractRules.map(({ id }) => id), 'contract rule')
  validateContractRules(contractRules)
  const overrides = new Map(overridesDocument.overrides.map((override) => [override.path, override]))
  assertUnique(overridesDocument.overrides.map(({ path }) => path), 'intent override')
  validateOverrides(overridesDocument.overrides, rules, contractRules)
  const unmapped = []
  const intents = specs.map((path) => {
    const override = overrides.get(path)
    if (override) return override
    const rule = rules.find(({ expression }) => expression.test(path))
    if (!rule) { unmapped.push(path); return null }
    const contractRule = contractRules.find(({ expression, layers }) => expression.test(path) && layers.includes(rule.layer))
    if (!contractRule) throw new Error(`unmapped characterization contract: ${path}`)
    return { path, rule: rule.id, layer: rule.layer, contract: contractRule.contract }
  }).filter(Boolean)
  if (unmapped.length) throw new Error(`unmapped Playwright intents:\n${unmapped.join('\n')}`)
  for (const path of overrides.keys()) if (!specs.includes(path)) throw new Error(`stale intent override: ${path}`)
  const areas = contractsDocument.areas
  const areaIds = new Set(areas.map(({ id }) => id))
  if (areas.length !== REQUIRED_AREAS.size || areaIds.size !== REQUIRED_AREAS.size || [...REQUIRED_AREAS].some((id) => !areaIds.has(id))) {
    throw new Error('characterization area contract set mismatch')
  }
  for (const area of areas) {
    if (!ALLOWED_LAYERS.has(area.layer)) throw new Error(`invalid area layer: ${area.id}`)
    if (!isNonemptyString(area.owner) || !isStringArray(area.observations, 3) || !isStringArray(area.failures, 3) || !isStringArray(area.coverage, 2)) {
      throw new Error(`incomplete characterization contract: ${area.id}`)
    }
    assertUnique(area.coverage, `${area.id} coverage path`)
    for (const path of area.coverage) {
      if (!/\.(?:integration\.)?test\.[cm]?[jt]sx?$/.test(path)) throw new Error(`non-test coverage path: ${path}`)
      const absolutePath = await resolveCoveragePath(root, path)
      const content = await readFile(absolutePath, 'utf8')
      if (!/\b(?:describe|it|test)\s*\(/.test(content)) throw new Error(`non-executable coverage file: ${path}`)
    }
  }
  assertUnique(areas.flatMap(({ coverage }) => coverage), 'global coverage path')
  const areaRecords = await Promise.all(areas.map(async (area) => [
    area.id, area.owner, area.layer, ...area.observations, ...area.failures,
    ...(await Promise.all(area.coverage.map(async (path) => `${path}:${createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')}`)))
  ]))
  const areaSetSha256 = hashRecords(areaRecords)
  assertEqual(areaSetSha256, contractsDocument.expectedAreaSetSha256, 'area set hash')
  for (const rule of contractRules) {
    if (rule.contract !== 'removed-feature-audit' && !areaIds.has(rule.contract)) {
      throw new Error(`invalid contract rule: ${rule.id}`)
    }
  }
  for (const intent of intents) {
    if (!ALLOWED_LAYERS.has(intent.layer)) throw new Error(`invalid characterization layer: ${intent.path}`)
    if (intent.contract !== 'removed-feature-audit' && !areaIds.has(intent.contract)) throw new Error(`invalid characterization contract: ${intent.path}`)
    if (!rules.some(({ id, layer }) => id === intent.rule && layer === intent.layer)) throw new Error(`invalid intent rule linkage: ${intent.path}`)
    if (!contractRules.some(({ contract, layers }) => contract === intent.contract && layers.includes(intent.layer))) throw new Error(`invalid contract layer linkage: ${intent.path}`)
  }
  const dependencyFiles = await findPlaywrightDependencies(root)
  const intentSetSha256 = hashRecords(intents.map(({ path, rule, layer, contract }) => [path, rule, layer, contract]))
  const dependencyRecords = await Promise.all(dependencyFiles.map(async (path) => [relative(root, path).replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex')]))
  const dependencySetSha256 = hashRecords(dependencyRecords)
  assertEqual(intentSetSha256, rulesDocument.expectedIntentSetSha256, 'intent set hash')
  assertEqual(dependencySetSha256, rulesDocument.expectedDependencySetSha256, 'dependency set hash')
  return { areaCount: areas.length, areaSetSha256, dependencyFileCount: dependencyFiles.length, dependencyPaths: dependencyRecords.map(([path]) => path), dependencySetSha256, intentCount: intents.length, intentSetSha256, intents }
}

async function findPlaywrightDependencies(root) {
  const candidates = await Promise.all(['tests', 'config', 'src', 'mobile', 'tools'].map((path) => walk(join(root, path))))
  const rootEntries = await readdir(root, { withFileTypes: true })
  candidates.push(rootEntries.filter((entry) => entry.isFile()).map((entry) => join(root, entry.name)))
  const matches = []
  const verifierPath = join(root, 'config/scripts/verify-characterization-plan.mjs')
  const manifestRoot = join(root, 'config/characterization')
  for (const path of candidates.flat().filter((value) => /\.(?:[cm]?[jt]sx?|json)$/.test(value) || basename(value) === 'pnpm-lock.yaml')) {
    // The verifier contains the dependency tokens as data; counting it would make the
    // expected digest self-referential and would not represent a runtime/test dependency.
    if (path === verifierPath || isRelativePathInside(relative(manifestRoot, path), sep)) continue
    const content = await readFile(path, 'utf8')
    if (content.includes('@playwright/test') || content.includes('@stablyai/playwright-test')) matches.push(path)
  }
  return matches.sort()
}

function hashRecords(records) {
  return createHash('sha256').update(records.sort((a, b) => a[0].localeCompare(b[0])).map((record) => record.join('\0')).join('\n')).digest('hex')
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`)
}

export function validateRules(rules) {
  for (const rule of rules) {
    if (!rule.id || !rule.pattern || !ALLOWED_LAYERS.has(rule.layer) || !rule.reason || 'contract' in rule) throw new Error(`invalid intent rule: ${rule.id}`)
  }
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value, minimum) {
  return Array.isArray(value) && value.length >= minimum && value.every(isNonemptyString)
}

export function validateContractRules(rules) {
  for (const rule of rules) {
    if (!rule.id || !rule.pattern || !rule.contract || !Array.isArray(rule.layers) || rule.layers.length === 0 || rule.layers.some((layer) => !ALLOWED_LAYERS.has(layer))) {
      throw new Error(`invalid contract rule: ${rule.id}`)
    }
  }
}

export function validateOverrides(overrides, rules, contractRules) {
  for (const override of overrides) {
    const linkedRule = rules.find(({ id, layer }) => id === override.rule && layer === override.layer)
    const naturalContract = contractRules.some(({ expression, contract, layers }) => expression.test(override.path) && contract === override.contract && layers.includes(override.layer))
    if (!override.path || !override.reason || !linkedRule || !ALLOWED_LAYERS.has(override.layer) || !override.contract) {
      throw new Error(`invalid intent override: ${override.path}`)
    }
    if (naturalContract === Boolean(override.exception)) {
      throw new Error(`invalid intent override exception: ${override.path}`)
    }
  }
}

export async function resolveCoveragePath(root, path) {
  const absolutePath = resolve(root, path)
  if (!isRelativePathInside(relative(root, absolutePath), sep)) throw new Error(`coverage path escapes repository: ${path}`)
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolutePath)])
  if (!isRelativePathInside(relative(realRoot, realFile), sep)) throw new Error(`coverage path escapes repository through symlink: ${path}`)
  return realFile
}

export function isRelativePathInside(relativePath, separator) {
  if (relativePath === '') return true
  if (relativePath === '..' || relativePath.startsWith(`..${separator}`) || relativePath.startsWith(separator)) return false
  if (separator === '\\' && (/^[A-Za-z]:\\/.test(relativePath) || relativePath.startsWith('\\\\'))) return false
  return true
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: ${actual}`)
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return nested.flat()
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyCharacterizationPlan(process.cwd())
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
