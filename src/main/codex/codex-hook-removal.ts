import { existsSync } from 'node:fs'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  createManagedCommandMatcher,
  readHooksJson,
  removeManagedCommands
} from '../agent-hooks/installer-utils'
import { getCodexManagedScriptFileName } from './codex-hook-identity'
import { getConfigPath, writeCodexHooksJson } from './codex-hook-support-a'
import {
  cleanupLegacyManagedHookRepresentations,
  removeRuntimeManagedHookTrustEntries
} from './codex-hook-support-b'

export function remove(service: any): AgentHookInstallStatus {

    const configPath = getConfigPath()
    const configExists = existsSync(configPath)
    const config = readHooksJson(configPath)
    if (!config) {
      // Why: a malformed hooks.json shouldn't strand old hooks in ~/.codex or the legacy profile after disabling.
      cleanupLegacyManagedHookRepresentations()
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Codex hooks.json'
      }
    }

    const nextHooks = { ...config.hooks }
    // Why: same broad matcher as install() so stale entries from older builds get cleaned even if scriptPath moved.
    const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (!Array.isArray(definitions)) {
        // Why: a non-array event value would make removeManagedCommands throw; skip it.
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand)
      if (cleaned.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = cleaned
      }
    }
    if (configExists) {
      // Why: remove() may be the only repair path for a file whose top-level plugin metadata makes Codex reject hooks.json.
      writeCodexHooksJson(configPath, nextHooks)
    }

    // Why: drop trust entries so config.toml doesn't accumulate dead [hooks.state] blocks across install/remove cycles.
    removeRuntimeManagedHookTrustEntries(configPath)

    cleanupLegacyManagedHookRepresentations()

    return service.getStatus()
}
