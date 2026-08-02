import type { CommitMessageAiSettings, TuiAgent } from './types'
import type { SourceControlAiSettings, SourceControlActionRecipe } from './source-control-ai-types'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  readSourceControlActionDefault,
  type SourceControlActionId
} from './source-control-ai-actions'
import {
  DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
  CUSTOM_AGENT_ID,
  type CustomAgentId,
  actionRecipeFromLegacyCommitMessageAi,
  commandTemplateFromOperationInstruction,
  isCustomAgentId
} from './source-control-ai-normalization'

export function getDefaultSourceControlAiSettings(): SourceControlAiSettings {
  return {
    enabled: true,
    actions: Object.fromEntries(
      SOURCE_CONTROL_ACTION_IDS.map((actionId) => [
        actionId,
        { commandInputTemplate: DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId] }
      ])
    ) as SourceControlAiSettings['actions'],
    agentId: null,
    selectedModelByAgent: {},
    selectedModelByAgentByHost: {},
    discoveredModelsByAgent: {},
    discoveredModelsByAgentByHost: {},
    selectedThinkingByModel: {},
    customAgentCommand: '',
    instructionsByOperation: {
      commitMessage: '',
      pullRequest: '',
      branchName: ''
    },
    prCreationDefaults: { ...DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS },
    launchActionDefaults: {}
  }
}

export function sourceControlAiSettingsFromLegacy(
  legacy: CommitMessageAiSettings | null | undefined
): SourceControlAiSettings {
  const defaults = getDefaultSourceControlAiSettings()
  if (!legacy) {
    return defaults
  }
  const legacyActionRecipe = actionRecipeFromLegacyCommitMessageAi(legacy)
  return {
    ...defaults,
    enabled: legacy.enabled,
    agentId: legacy.agentId,
    selectedModelByAgent: { ...legacy.selectedModelByAgent },
    selectedModelByAgentByHost: copyRecord(legacy.selectedModelByAgentByHost) ?? {},
    discoveredModelsByAgent: copyRecord(legacy.discoveredModelsByAgent) ?? {},
    discoveredModelsByAgentByHost: copyRecord(legacy.discoveredModelsByAgentByHost) ?? {},
    selectedThinkingByModel: { ...legacy.selectedThinkingByModel },
    customAgentCommand: legacy.customAgentCommand,
    instructionsByOperation: {
      commitMessage: legacy.customPrompt ?? '',
      // Why: the legacy prompt covered commit generation and branch auto-rename;
      // the first split must preserve that guidance for both released paths.
      pullRequest: '',
      branchName: legacy.customPrompt ?? ''
    },
    actions: {
      ...defaults.actions,
      commitMessage: legacyActionRecipe,
      branchName: {
        ...legacyActionRecipe,
        commandInputTemplate: commandTemplateFromOperationInstruction(
          'branchName',
          legacy.customPrompt
        )
      }
    }
  }
}
