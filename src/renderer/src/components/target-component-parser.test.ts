import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const ts = require('typescript-api')

const targetFiles = [
  'activity/activity-prototype-page-orchestration.tsx',
  'activity/activity-prototype-page-renderer.tsx',
  'editor/combined-diff-viewer-view.tsx',
  'editor/markdown-preview-surface.tsx'
]

describe('target component parser regressions', () => {
  it.each(targetFiles)('parses %s without syntax diagnostics', (relativePath) => {
    const fileName = resolve('src/renderer/src/components', relativePath)
    const sourceFile = ts.createSourceFile(
      fileName,
      readFileSync(fileName, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )

    expect(
      sourceFile.parseDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        length: diagnostic.length,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        start: diagnostic.start
      }))
    ).toEqual([])
  })
})
