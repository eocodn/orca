import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const sourceRoot = resolve(projectRoot, 'src')

function collectProductionFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      return collectProductionFiles(entryPath)
    }
    if (!/\.(?:cjs|mjs|ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) {
      return []
    }
    return [entryPath]
  })
}

function removedPathIsEmpty(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    return true
  }
  return readdirSync(absolutePath).length === 0
}

const retiredAutomationTests = [
  'src/main/persistence.test.ts',
  'src/main/runtime/rpc/methods/worktree.test.ts',
  'src/main/ipc/worktrees.test.ts',
  'src/renderer/src/components/sidebar/SidebarNav.test.tsx',
  'src/renderer/src/components/sidebar/WorktreeCard.pr-display.test.tsx',
  'src/renderer/src/components/sidebar/WorktreeCardAgents.activation.test.tsx',
  'src/renderer/src/components/sidebar/WorktreeCardDisplayMenuSection.test.tsx',
  'src/renderer/src/components/sidebar/sidebar-workspace-option-items.test.ts',
  'src/renderer/src/components/settings/AppearancePane.test.tsx',
  'src/renderer/src/components/settings/terminal-search.test.ts'
]

describe('automations removal contract', () => {
  it('removes the complete automations-owned source trees and entry modules', () => {
    for (const relativePath of [
      'src/main/automations',
      'src/renderer/src/components/automations',
      'src/relay/external-automations-handler.ts',
      'src/relay/external-automations-provider.ts',
      'src/relay/external-automations-stage-1.ts',
      'src/relay/external-automations-stage-2.ts',
      'src/relay/external-automations-stage-3.ts',
      'src/relay/external-automations-stage-state.ts',
      'src/cli/handlers/automations.ts',
      'src/cli/specs/automations.ts',
      'src/main/ipc/automations.ts',
      'src/main/runtime/rpc/methods/automations.ts',
      'src/main/runtime/runtime-automation-commands.ts',
      'src/shared/automations-types.ts',
      'src/shared/automation-precheck.ts',
      'src/shared/automation-run-identity.ts',
      'src/shared/automation-run-retention.ts',
      'src/shared/automation-schedule-classifier.ts',
      'src/shared/automation-schedule-occurrence.ts',
      'src/shared/automation-schedule-parser.ts',
      'src/shared/automation-schedules.ts',
      'src/shared/automation-workspace-provenance.ts',
      'src/shared/external-automation-jobs-file.ts'
    ]) {
      expect(removedPathIsEmpty(relativePath), relativePath).toBe(true)
    }
  })

  it('removes automations from production integration boundaries', () => {
    const forbiddenSource =
      /(?:from ['\"][^'\"]*(?:\/automations(?:\/|['\"])|\/automation-(?!visibility)|external-automation)|registerAutomationHandlers|AutomationService|AUTOMATION_METHODS|AutomationWorkspaceProvenance|automationProvenance|automationRuns|automationRun|window\.api\.automations|useAutomationDispatchEvents|AutomationsPage|ExternalAutomations|automation\.(?:list|create|update|delete|run|runs))/

    for (const filePath of collectProductionFiles(sourceRoot)) {
      const source = readFileSync(filePath, 'utf8')
      expect(source, filePath).not.toMatch(forbiddenSource)
      expect(source, filePath).not.toMatch(
        /AutomationRunUsage|AutomationUsageLookupInput|AUTOMATION_ATTRIBUTION_WINDOW_MS|getAutomationRunUsage/
      )
      expect(source, filePath).not.toMatch(
        /automations-types|ui\.automations|ExternalAutomation|Automation(?:Run|Create|Update|Dispatch|Precheck|Workspace|Usage|Service)|automation(?:s|Run|Provenance|Created)|openAutomationsPage|closeAutomationsPage|hideAutomationGeneratedWorkspaces|setHideAutomationGeneratedWorkspaces|showAutomationsButton|auto\.components\.automations|useAutomationDispatchEvents/
      )
    }

    const localeRoot = resolve(sourceRoot, 'renderer/src/i18n/locales')
    for (const entry of readdirSync(localeRoot)) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const source = readFileSync(join(localeRoot, entry), 'utf8')
      expect(source, entry).not.toMatch(
        /"AutomationSessionField"\s*:|"AutomationsPage"\s*:|"automationRunMissing"\s*:/
      )
    }
  })

  it('retains generic scheduling, agent-hook, terminal, browser, and provider surfaces', () => {
    for (const relativePath of [
      'src/main/agent-hooks/server.ts',
      'src/main/browser/browser-manager-lifecycle.ts',
      'src/main/ssh/ssh-multiplexer-writer-lane-scheduler.ts',
      'src/relay/relay-pty-source-send-scheduler.ts',
      'src/shared/timer-delay.ts',
      'src/main/github',
      'src/main/linear',
      'src/relay/git-handler-stage-1.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(true)
    }
  })

  it('does not keep retired automation fixtures in generic test suites', () => {
    const forbidden =
      /createAutomation|listAutomationRuns|automationProvenance|showAutomationsButton|dispatch-tokens|createAutomationDispatchToken|AutomationService|openAutomationsPage|shouldShowAutomationsButton|Created by automation|\bautomation\b|Automations/
    for (const relativePath of retiredAutomationTests) {
      expect(readFileSync(resolve(projectRoot, relativePath), 'utf8'), relativePath).not.toMatch(
        forbidden
      )
    }
  })
})
