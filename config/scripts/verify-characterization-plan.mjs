import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REQUIRED_AREAS = new Set([
  'workspace-registration-restore', 'worktree-preflight', 'terminal-lifecycle', 'wsl-context',
  'ssh-reconnect-forward', 'session-synchronization', 'file-read-write-watch', 'git-workflow',
  'mobile-pairing-stream', 'web-remote-session', 'editor-file-tree-source-control',
  'provider-integrations', 'mcp-configuration'
])

export async function verifyCharacterizationPlan(root) {
  const [rulesDocument, overridesDocument, contractsDocument] = await Promise.all([
    readJson(join(root, 'config/characterization/playwright-intent-rules.json')),
    readJson(join(root, 'config/characterization/playwright-intent-overrides.json')),
    readJson(join(root, 'config/characterization/area-contracts.json'))
  ])
  const specs = (await walk(join(root, 'tests/e2e')))
    .map((path) => relative(root, path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.spec.ts'))
  const rules = rulesDocument.rules.map((rule) => ({ ...rule, expression: new RegExp(rule.pattern) }))
  assertUnique(rules.map(({ id }) => id), 'intent rule')
  const overrides = new Map(overridesDocument.overrides.map((override) => [override.path, override]))
  assertUnique(overridesDocument.overrides.map(({ path }) => path), 'intent override')
  const intents = specs.map((path) => {
    const override = overrides.get(path)
    if (override) return override
    const rule = rules.find(({ expression }) => expression.test(path))
    if (!rule) throw new Error(`unmapped Playwright intent: ${path}`)
    return { path, rule: rule.id, layer: rule.layer, contract: rule.contract }
  })
  for (const path of overrides.keys()) if (!specs.includes(path)) throw new Error(`stale intent override: ${path}`)
  const areas = contractsDocument.areas
  const areaIds = new Set(areas.map(({ id }) => id))
  if (areas.length !== REQUIRED_AREAS.size || areaIds.size !== REQUIRED_AREAS.size || [...REQUIRED_AREAS].some((id) => !areaIds.has(id))) {
    throw new Error('characterization area contract set mismatch')
  }
  for (const area of areas) {
    if (!area.owner || area.observations.length < 3 || area.failures.length < 3 || !area.layer || area.coverage.length < 2) {
      throw new Error(`incomplete characterization contract: ${area.id}`)
    }
    for (const path of area.coverage) await readFile(join(root, path), 'utf8')
  }
  const dependencyFiles = await findPlaywrightDependencies(root)
  const intentSetSha256 = hashRecords(intents.map(({ path, rule, layer, contract }) => [path, rule, layer, contract]))
  const dependencySetSha256 = hashRecords(dependencyFiles.map((path) => [relative(root, path).replaceAll('\\', '/')]))
  assertEqual(intentSetSha256, rulesDocument.expectedIntentSetSha256, 'intent set hash')
  assertEqual(dependencySetSha256, rulesDocument.expectedDependencySetSha256, 'dependency set hash')
  return { areaCount: areas.length, dependencyFileCount: dependencyFiles.length, dependencySetSha256, intentCount: intents.length, intentSetSha256, intents }
}

async function findPlaywrightDependencies(root) {
  const candidates = await Promise.all(['tests', 'config', 'src', 'mobile'].map((path) => walk(join(root, path))))
  candidates.push([join(root, 'package.json'), join(root, 'pnpm-lock.yaml')])
  const matches = []
  for (const path of candidates.flat().filter((value) => /\.(?:[cm]?[jt]sx?|json)$/.test(value))) {
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
