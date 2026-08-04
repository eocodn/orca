import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const rendererRoot = resolve(projectRoot, 'src/renderer/src')

function collectRendererProductionFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      return collectRendererProductionFiles(entryPath)
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return []
    }
    return [entryPath]
  })
}

describe('renderer orchestration setup state removal contract', () => {
  it('removes the renderer-only setup state module and its dedicated test', () => {
    for (const relativePath of [
      'src/renderer/src/lib/orchestration-setup-state.ts',
      'src/renderer/src/lib/orchestration-setup-state.test.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('keeps orchestration setup state out of renderer production sources', () => {
    const forbiddenSource = /orchestration-setup-state|ORCHESTRATION_SETUP_STATE_EVENT|ORCHESTRATION_ENABLED_STORAGE_KEY|ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY|markOrchestrationSetupComplete|isOrchestrationSetupEnabled|hasOrchestrationSetupMarker|isOrchestrationSetupDismissed|notifyOrchestrationSetupStateChanged/

    for (const filePath of collectRendererProductionFiles(rendererRoot)) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(forbiddenSource)
    }
  })
})
