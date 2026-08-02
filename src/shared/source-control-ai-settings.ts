import type { CommitMessageAiSettings, TuiAgent } from './types'
import type { SourceControlAiModelChoice, SourceControlAiSettings } from './source-control-ai-types'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  SOURCE_CONTROL_TEXT_ACTION_IDS,
  normalizeSourceControlAiActionDefaults,
  readSourceControlActionDefault
} from './source-control-ai-actions'
import { isCustomAgentId } from './commit-message-agent-spec'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from './commit-message-host-key'
import {
  actionRecipeFromLegacyCommitMessageAi,
  applyLegacyAgentToActionRecipe,
  commandTemplateFromOperationInstruction,
  copyRecord,
  hasActionAgentRecipe,
  hasLegacyCommitMessageCoreChanges,
  hasEntries,
  isLegacyBranchInstructionTemplate,
  legacyCommitMessageCoreChanges,
  legacyPromptFromCommandTemplate,
  shouldImportLegacyBranchAgent,
  shouldImportLegacyBranchPrompt
} from './source-control-ai-normalization'
import { sourceControlAiSettingsFromLegacy, getDefaultSourceControlAiSettings } from './source-control-ai-migration'

function mergeSelectedModelByAgentByHost(
  base: Partial<Record<string, Partial<Record<TuiAgent, string>>>> | undefined,
  override: Partial<Record<string, Partial<Record<TuiAgent, string>>>> | undefined
): Partial<Record<string, Partial<Record<TuiAgent, string>>>> {
  const merged = copyRecord(base) ?? {}
  for (const [hostKey, hostModels] of Object.entries(override ?? {})) {
    merged[hostKey] = {
      ...merged[hostKey],
      ...hostModels
    }
  }
  return merged
}

function mergeLegacyModelSelectionDelta<T>(
  existing: Record<string, T> | null | undefined,
  legacy: Record<string, T> | null | undefined,
  projected: Record<string, T> | null | undefined
): Record<string, T> | undefined {
  const merged: Record<string, T> = { ...existing }
  let changed = false
  const keys = new Set([...Object.keys(legacy ?? {}), ...Object.keys(projected ?? {})])
  for (const key of keys) {
    const legacyHasKey = Object.prototype.hasOwnProperty.call(legacy ?? {}, key)
    const legacyValue = legacy?.[key]
    if (JSON.stringify(projected?.[key]) === JSON.stringify(legacyValue)) {
      continue
    }
    changed = true
    if (legacyHasKey && legacyValue !== undefined) {
      merged[key] = legacyValue
    } else {
      delete merged[key]
    }
  }
  return changed ? merged : (existing ?? undefined)
}

function mergeLegacyHostModelSelectionDelta(
  existing: Partial<Record<string, Partial<Record<TuiAgent, string>>>> | null | undefined,
  legacy: Partial<Record<string, Partial<Record<TuiAgent, string>>>> | null | undefined,
  projected: Partial<Record<string, Partial<Record<TuiAgent, string>>>> | null | undefined
): Partial<Record<string, Partial<Record<TuiAgent, string>>>> | undefined {
  const merged = copyRecord(existing) ?? {}
  let changed = false
  const hostKeys = new Set([...Object.keys(legacy ?? {}), ...Object.keys(projected ?? {})])
  for (const hostKey of hostKeys) {
    const nextHostModels = mergeLegacyModelSelectionDelta(
      merged[hostKey],
      legacy?.[hostKey],
      projected?.[hostKey]
    )
    if (nextHostModels !== merged[hostKey]) {
      changed = true
    }
    if (nextHostModels && Object.keys(nextHostModels).length > 0) {
      merged[hostKey] = nextHostModels
    } else {
      delete merged[hostKey]
    }
  }
  return changed ? merged : (existing ?? undefined)
}

export function mergeLegacyCommitMessageAiIntoSourceControlAi(
  sourceControlAi: SourceControlAiSettings | null | undefined,
  legacy: CommitMessageAiSettings | null | undefined,
  options: { pullRequestInstructionsFromLegacy?: boolean } = {}
): SourceControlAiSettings {
  // Why: older runtimes and rollback builds still write commitMessageAi; merge
  // those writes into the new shape without wiping PR-only settings.
  const base = normalizeSourceControlAiSettings(sourceControlAi, legacy)
  if (!legacy) {
    return base
  }
  if (sourceControlAi) {
    const existingCommitChoice = base.modelOverridesByOperation?.commitMessage
    const projectedLegacy = projectSourceControlAiToLegacyCommitMessageAi(base)
    const selectedModelByAgent = mergeLegacyModelSelectionDelta(
      existingCommitChoice?.selectedModelByAgent,
      legacy.selectedModelByAgent,
      projectedLegacy.selectedModelByAgent
    )
    const selectedModelByAgentByHost = mergeLegacyHostModelSelectionDelta(
      existingCommitChoice?.selectedModelByAgentByHost,
      legacy.selectedModelByAgentByHost,
      projectedLegacy.selectedModelByAgentByHost
    )
    const selectedThinkingByModel = mergeLegacyModelSelectionDelta(
      existingCommitChoice?.selectedThinkingByModel,
      legacy.selectedThinkingByModel,
      projectedLegacy.selectedThinkingByModel
    )
    const shouldMergeLegacyModels =
      selectedModelByAgent !== existingCommitChoice?.selectedModelByAgent ||
      selectedModelByAgentByHost !== existingCommitChoice?.selectedModelByAgentByHost ||
      selectedThinkingByModel !== existingCommitChoice?.selectedThinkingByModel
    const nextModelOverridesByOperation = { ...base.modelOverridesByOperation }
    if (shouldMergeLegacyModels) {
      const nextCommitChoice: SourceControlAiModelChoice = {}
      if (hasEntries(selectedModelByAgent)) {
        nextCommitChoice.selectedModelByAgent = selectedModelByAgent
      }
      if (hasEntries(selectedModelByAgentByHost)) {
        nextCommitChoice.selectedModelByAgentByHost = selectedModelByAgentByHost
      }
      if (hasEntries(selectedThinkingByModel)) {
        nextCommitChoice.selectedThinkingByModel = selectedThinkingByModel
      }
      if (Object.keys(nextCommitChoice).length > 0) {
        nextModelOverridesByOperation.commitMessage = nextCommitChoice
      } else {
        delete nextModelOverridesByOperation.commitMessage
      }
    }
    // Why: rollback builds write commitMessageAi, while new builds project
    // commit-message overrides there. Keep those model choices scoped to
    // commit-message generation so PR defaults cannot drift on reload.
    const legacyActionRecipe = actionRecipeFromLegacyCommitMessageAi(legacy)
    const legacyChanges = legacyCommitMessageCoreChanges(legacy, projectedLegacy)
    const shouldMergeLegacyCore = hasLegacyCommitMessageCoreChanges(legacyChanges)
    const shouldMergeBranchPrompt =
      legacyChanges.customPrompt && shouldImportLegacyBranchPrompt(base, projectedLegacy)
    const shouldMergeBranchAgent =
      legacyChanges.agentId && shouldImportLegacyBranchAgent(base, projectedLegacy)
    return normalizeSourceControlAiSettings(
      {
        ...base,
        discoveredModelsByAgent: copyRecord(legacy.discoveredModelsByAgent) ?? {},
        discoveredModelsByAgentByHost: copyRecord(legacy.discoveredModelsByAgentByHost) ?? {},
        ...(shouldMergeLegacyCore
          ? {
              // Why: legacy commitMessageAi is also our rollback projection.
              // Only import fields that diverged so independent action recipes survive.
              ...(legacyChanges.enabled ? { enabled: legacy.enabled } : {}),
              ...(legacyChanges.agentId ? { agentId: legacy.agentId } : {}),
              ...(legacyChanges.customAgentCommand
                ? { customAgentCommand: legacy.customAgentCommand }
                : {}),
              instructionsByOperation: {
                ...base.instructionsByOperation,
                ...(legacyChanges.customPrompt ? { commitMessage: legacy.customPrompt ?? '' } : {}),
                ...(shouldMergeBranchPrompt ? { branchName: legacy.customPrompt ?? '' } : {}),
                ...(legacyChanges.customPrompt && options.pullRequestInstructionsFromLegacy
                  ? { pullRequest: legacy.customPrompt ?? '' }
                  : {})
              },
              actions: {
                ...base.actions,
                commitMessage: {
                  ...(legacyChanges.agentId
                    ? applyLegacyAgentToActionRecipe(base.actions?.commitMessage, legacy.agentId)
                    : base.actions?.commitMessage),
                  ...(legacyChanges.customPrompt
                    ? { commandInputTemplate: legacyActionRecipe.commandInputTemplate }
                    : {})
                },
                branchName: {
                  ...(shouldMergeBranchAgent
                    ? applyLegacyAgentToActionRecipe(base.actions?.branchName, legacy.agentId)
                    : base.actions?.branchName),
                  ...(shouldMergeBranchPrompt
                    ? {
                        commandInputTemplate: commandTemplateFromOperationInstruction(
                          'branchName',
                          legacy.customPrompt
                        )
                      }
                    : {})
                }
              }
            }
          : {}),
        modelOverridesByOperation: nextModelOverridesByOperation
      },
      shouldMergeLegacyCore ? legacy : undefined
    )
  }
  return normalizeSourceControlAiSettings(
    {
      ...base,
      enabled: legacy.enabled,
      agentId: legacy.agentId,
      selectedModelByAgent: { ...legacy.selectedModelByAgent },
      selectedModelByAgentByHost: copyRecord(legacy.selectedModelByAgentByHost) ?? {},
      discoveredModelsByAgent: copyRecord(legacy.discoveredModelsByAgent) ?? {},
      discoveredModelsByAgentByHost: copyRecord(legacy.discoveredModelsByAgentByHost) ?? {},
      selectedThinkingByModel: { ...legacy.selectedThinkingByModel },
      customAgentCommand: legacy.customAgentCommand,
      instructionsByOperation: {
        ...base.instructionsByOperation,
        commitMessage: legacy.customPrompt ?? '',
        branchName: legacy.customPrompt ?? '',
        ...(options.pullRequestInstructionsFromLegacy
          ? { pullRequest: legacy.customPrompt ?? '' }
          : {})
      }
    },
    legacy
  )
}

export function normalizeSourceControlAiSettings(
  value: SourceControlAiSettings | null | undefined,
  legacy?: CommitMessageAiSettings | null
): SourceControlAiSettings {
  const base = value ?? sourceControlAiSettingsFromLegacy(legacy)
  const defaults = getDefaultSourceControlAiSettings()
  const normalizedLaunchActionDefaults = normalizeSourceControlAiActionDefaults(
    base.launchActionDefaults
  )
  const normalizedActions = {
    ...normalizedLaunchActionDefaults,
    ...normalizeSourceControlAiActionDefaults(base.actions)
  }
  const migratedTextActions = Object.fromEntries(
    SOURCE_CONTROL_TEXT_ACTION_IDS.map((actionId) => {
      const existing = readSourceControlActionDefault(normalizedActions, actionId)
      const instruction = base.instructionsByOperation?.[actionId]
      const legacyInstruction = actionId === 'commitMessage' ? legacy?.customPrompt : undefined
      const resolvedInstruction = instruction ?? legacyInstruction
      const instructionTemplate =
        instruction || legacyInstruction
          ? commandTemplateFromOperationInstruction(actionId, resolvedInstruction)
          : undefined
      const shouldApplyInstructionTemplate =
        instructionTemplate !== undefined &&
        (existing.commandInputTemplate === undefined ||
          existing.commandInputTemplate ===
            DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId] ||
          isLegacyBranchInstructionTemplate(
            actionId,
            resolvedInstruction,
            existing.commandInputTemplate
          ))
      return [
        actionId,
        {
          ...defaults.actions?.[actionId],
          ...(base.agentId && !isCustomAgentId(base.agentId) ? { agentId: base.agentId } : {}),
          ...existing,
          ...(shouldApplyInstructionTemplate ? { commandInputTemplate: instructionTemplate } : {})
        }
      ]
    })
  ) as SourceControlAiSettings['actions']
  const actions: SourceControlAiSettings['actions'] = {
    ...defaults.actions,
    ...normalizedActions,
    ...migratedTextActions
  }
  return {
    ...defaults,
    ...base,
    selectedModelByAgent: { ...defaults.selectedModelByAgent, ...base.selectedModelByAgent },
    selectedModelByAgentByHost:
      copyRecord(base.selectedModelByAgentByHost) ?? defaults.selectedModelByAgentByHost,
    discoveredModelsByAgent:
      copyRecord(base.discoveredModelsByAgent) ?? defaults.discoveredModelsByAgent,
    discoveredModelsByAgentByHost:
      copyRecord(base.discoveredModelsByAgentByHost) ?? defaults.discoveredModelsByAgentByHost,
    selectedThinkingByModel: {
      ...defaults.selectedThinkingByModel,
      ...base.selectedThinkingByModel
    },
    instructionsByOperation: {
      ...defaults.instructionsByOperation,
      ...base.instructionsByOperation
    },
    modelOverridesByOperation: copyRecord(base.modelOverridesByOperation),
    prCreationDefaults: {
      ...defaults.prCreationDefaults,
      ...base.prCreationDefaults
    },
    actions,
    launchActionDefaults: normalizedLaunchActionDefaults ?? defaults.launchActionDefaults
  }
}

export function readSourceControlAiModelChoiceForHost(
  choice: SourceControlAiModelChoice | null | undefined,
  hostKey: string,
  agentId: TuiAgent
): string | undefined {
  return (
    choice?.selectedModelByAgentByHost?.[hostKey]?.[agentId] ??
    (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
      ? choice?.selectedModelByAgent?.[agentId]
      : undefined)
  )
}

export function selectSourceControlAiModelChoiceForHost(
  choice: SourceControlAiModelChoice | undefined,
  hostKey: string,
  agentId: TuiAgent,
  modelId: string
): SourceControlAiModelChoice {
  const hostSelectedModels = choice?.selectedModelByAgentByHost?.[hostKey] ?? {}
  return {
    ...choice,
    selectedModelByAgent:
      hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
        ? {
            ...choice?.selectedModelByAgent,
            [agentId]: modelId
          }
        : choice?.selectedModelByAgent,
    selectedModelByAgentByHost: {
      ...choice?.selectedModelByAgentByHost,
      [hostKey]: {
        ...hostSelectedModels,
        [agentId]: modelId
      }
    }
  }
}

export function clearSourceControlAiModelChoiceForHost(
  choice: SourceControlAiModelChoice | undefined,
  hostKey: string,
  agentId: TuiAgent
): SourceControlAiModelChoice | undefined {
  if (!choice) {
    return undefined
  }
  // Why: model choices are host-scoped; clearing one "Use global" selector
  // must not erase a different SSH/runtime host's override.
  const selectedModelByAgent = { ...choice.selectedModelByAgent }
  if (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY) {
    delete selectedModelByAgent[agentId]
  }

  const selectedModelByAgentByHost = { ...choice.selectedModelByAgentByHost }
  const hostModels = { ...selectedModelByAgentByHost[hostKey] }
  delete hostModels[agentId]
  if (Object.keys(hostModels).length > 0) {
    selectedModelByAgentByHost[hostKey] = hostModels
  } else {
    delete selectedModelByAgentByHost[hostKey]
  }

  const nextChoice: SourceControlAiModelChoice = {}
  if (Object.keys(selectedModelByAgent).length > 0) {
    nextChoice.selectedModelByAgent = selectedModelByAgent
  }
  if (Object.keys(selectedModelByAgentByHost).length > 0) {
    nextChoice.selectedModelByAgentByHost = selectedModelByAgentByHost
  }
  const hasModelSelection =
    nextChoice.selectedModelByAgent !== undefined ||
    nextChoice.selectedModelByAgentByHost !== undefined
  if (hasModelSelection && Object.keys(choice.selectedThinkingByModel ?? {}).length > 0) {
    nextChoice.selectedThinkingByModel = choice.selectedThinkingByModel
  }
  return hasModelSelection ? nextChoice : undefined
}

export function projectSourceControlAiToLegacyCommitMessageAi(
  sourceControlAi: SourceControlAiSettings,
  previousLegacy?: CommitMessageAiSettings | null
): CommitMessageAiSettings {
  const commitMessageChoice = sourceControlAi.modelOverridesByOperation?.commitMessage
  const commitRecipe = readSourceControlActionDefault(sourceControlAi.actions, 'commitMessage')
  return {
    enabled: sourceControlAi.enabled,
    agentId: hasActionAgentRecipe(commitRecipe) ? commitRecipe.agentId : sourceControlAi.agentId,
    selectedModelByAgent: {
      ...sourceControlAi.selectedModelByAgent,
      ...commitMessageChoice?.selectedModelByAgent
    },
    selectedModelByAgentByHost: mergeSelectedModelByAgentByHost(
      sourceControlAi.selectedModelByAgentByHost,
      commitMessageChoice?.selectedModelByAgentByHost
    ),
    discoveredModelsByAgent: copyRecord(sourceControlAi.discoveredModelsByAgent) ?? {},
    discoveredModelsByAgentByHost: copyRecord(sourceControlAi.discoveredModelsByAgentByHost) ?? {},
    selectedThinkingByModel: {
      ...sourceControlAi.selectedThinkingByModel,
      ...commitMessageChoice?.selectedThinkingByModel
    },
    customPrompt: legacyPromptFromCommandTemplate(
      commitRecipe.commandInputTemplate,
      sourceControlAi.instructionsByOperation.commitMessage ?? previousLegacy?.customPrompt
    ),
    customAgentCommand: sourceControlAi.customAgentCommand
  }
}
