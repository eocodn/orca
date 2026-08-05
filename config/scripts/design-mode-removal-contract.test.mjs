import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function projectPath(relativePath) {
  return resolve(projectRoot, relativePath)
}

function readProjectFile(relativePath) {
  return readFileSync(projectPath(relativePath), 'utf8')
}

describe('Design Mode product removal contract', () => {
  it('removes the retired feature-wall tile and workflow references', () => {
    expect(readProjectFile('src/shared/feature-wall-tiles.ts')).not.toContain('tile-05')
    expect(readProjectFile('src/shared/feature-wall-tiles.ts')).not.toMatch(/Design Mode/i)
    expect(readProjectFile('src/shared/feature-wall-workflows.ts')).not.toContain('tile-05')
    expect(readProjectFile('src/shared/telemetry-event-shared-enums.ts')).not.toContain('tile-05')
  })

  it('removes Design Mode asset and documentation entrypoints', () => {
    for (const relativePath of [
      'docs/assets/feature-wall/design-mode.gif',
      'docs/assets/feature-wall/design-mode.jpg',
      'docs/assets/orca-design-mode.gif',
      'resources/onboarding/feature-wall/tile-05.gif',
      'resources/onboarding/feature-wall/tile-05.poster.jpg',
      'resources/onboarding/feature-wall/tile-05.recorded-at.json'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
    for (const relativePath of [
      'README.md',
      ...['es', 'fr', 'ja', 'ko', 'pt', 'zh-CN'].map((locale) => `docs/readme/README.${locale}.md`)
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(/design[- ]mode/i)
    }
  })

  it('removes Design Mode from asset vendor and budget checks', () => {
    expect(readProjectFile('config/scripts/vendor-feature-wall-assets.mjs')).not.toContain(
      'tile-05'
    )
    expect(readProjectFile('config/scripts/vendor-feature-wall-assets.mjs')).not.toMatch(
      /design[- ]mode/i
    )
    expect(readProjectFile('config/scripts/check-feature-wall-assets.mjs')).not.toContain('tile-05')
  })

  it('retains generic editor, embedded browser, and screenshot paths', () => {
    expect(readProjectFile('src/shared/feature-wall-workflows.ts')).toContain('tile-07')
    expect(readProjectFile('src/renderer/src/components/browser-pane/BrowserPane.tsx')).toContain(
      'export default function BrowserPane'
    )
    expect(readProjectFile('src/main/browser/browser-grab-screenshot.ts')).toContain(
      'captureSelectionScreenshot'
    )
  })
})
