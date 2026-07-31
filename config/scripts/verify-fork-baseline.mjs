import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASELINE_COMMIT = '79251d7a9861568dc261faabfa16df5347d1d008'
const LICENSE_HOLDER = 'Lovecast Inc.'

export async function verifyForkBaseline(root) {
  const [baseline, license, packageJson] = await Promise.all([
    readFile(join(root, 'docs/fork-baseline.md'), 'utf8'),
    readFile(join(root, 'LICENSE'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8')
  ])
  const packageData = JSON.parse(packageJson)

  assertIncludes(baseline, `Baseline commit: \`${BASELINE_COMMIT}\``, 'baseline commit')
  assertIncludes(baseline, 'Upstream: `https://github.com/stablyai/orca.git`', 'upstream URL')
  assertIncludes(baseline, `Package version: \`${packageData.version}\``, 'package version')
  if (baseline.includes('| Pending first run |')) {
    throw new Error('fork baseline contains pending results')
  }
  const recordedResults = baseline.match(/^\| (?!---)[^\n]+ \| `[^`]+`[^\n]* \| [^\n]+ \|$/gm)?.length ?? 0
  if (recordedResults !== 6) throw new Error(`fork baseline result count mismatch: ${recordedResults}`)
  assertIncludes(license, 'MIT License', 'MIT license identifier')
  assertIncludes(license, `Copyright (c) 2026 ${LICENSE_HOLDER}`, 'license holder')

  return {
    baselineCommit: BASELINE_COMMIT,
    licenseHolder: LICENSE_HOLDER,
    productVersion: packageData.version,
    recordedResults
  }
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
