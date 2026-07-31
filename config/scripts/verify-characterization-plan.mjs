import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_AREAS = new Set([
  'workspace-registration-restore', 'worktree-preflight', 'terminal-lifecycle', 'wsl-context',
  'ssh-reconnect-forward', 'session-synchronization', 'file-read-write-watch', 'git-workflow',
  'mobile-pairing-stream', 'web-remote-session', 'editor-file-tree-source-control',
  'provider-integrations', 'mcp-configuration'
])

export async function verifyCharacterizationPlan(root) {
  const [rulesDocument, contractsDocument] = await Promise.all([
    readJson(join(root, 'config/characterization/playwright-intent-rules.json')),
    readJson(join(root, 'config/characterization/area-contracts.json'))
  ])
  const specs = (await walk(join(root, 'tests/e2e')))
    .map((path) => relative(root, path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.spec.ts'))
  const rules = rulesDocument.rules.map((rule) => ({ ...rule, expression: new RegExp(rule.pattern) }))
  const intents = specs.map((path) => {
    const rule = rules.find(({ expression }) => expression.test(path))
    if (!rule) throw new Error(`unmapped Playwright intent: ${path}`)
    return { path, rule: rule.id, layer: rule.layer }
  })
  const areas = contractsDocument.areas
  const areaIds = new Set(areas.map(({ id }) => id))
  if (areas.length !== REQUIRED_AREAS.size || areaIds.size !== REQUIRED_AREAS.size || [...REQUIRED_AREAS].some((id) => !areaIds.has(id))) {
    throw new Error('characterization area contract set mismatch')
  }
  for (const area of areas) {
    if (!area.owner || area.observations.length < 3 || area.failures.length < 3 || !area.layer) {
      throw new Error(`incomplete characterization contract: ${area.id}`)
    }
  }
  const dependencyFiles = await findPlaywrightDependencies(root)
  return { areaCount: areas.length, dependencyFileCount: dependencyFiles.length, intentCount: intents.length, intents }
}

async function findPlaywrightDependencies(root) {
  const candidates = await Promise.all(['tests', 'config', 'src', 'mobile'].map((path) => walk(join(root, path))))
  const matches = []
  for (const path of candidates.flat().filter((value) => /\.(?:[cm]?[jt]sx?|json)$/.test(value))) {
    const content = await readFile(path, 'utf8')
    if (content.includes('@playwright/test') || content.includes('@stablyai/playwright-test')) matches.push(path)
  }
  return matches
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
