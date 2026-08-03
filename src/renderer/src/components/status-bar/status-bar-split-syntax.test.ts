import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const statusBarDirectory = resolve(__dirname)

const splitFiles = [
  'status-bar-claude-switcher.tsx',
  'status-bar-codex-switcher.tsx',
  'status-bar-account-menu-parts.tsx',
  'status-bar-main.tsx',
  'status-bar-provider-details-menu.tsx',
  'status-bar-provider-inline-usage.tsx',
  'workspace-space-manager-decision-model.ts',
  'workspace-space-manager-decision.tsx',
  'workspace-space-manager-surface.tsx',
  'workspace-space-manager-workspace-rows.tsx'
]

describe('status-bar split source', () => {
  it('does not contain the malformed split-boundary syntax', () => {
    for (const fileName of splitFiles) {
      const source = readFileSync(resolve(statusBarDirectory, fileName), 'utf8')
      const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )

      expect(sourceFile.parseDiagnostics, fileName).toHaveLength(0)
      expect(source, fileName).not.toMatch(/from\s+['"][^'"]+['"]\s+import\b/)
      expect(source, fileName).not.toMatch(/\bexport\s+export\b/)
      expect(source, fileName).not.toMatch(/\bexport\s+import\b/)
      expect(source, fileName).not.toMatch(/^\s+breakdown, and table pieces.*\*\/$/m)
      expect(source, fileName).not.toMatch(/^export\s*$/m)
    }
  })
})
