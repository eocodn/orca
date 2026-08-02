import type {
  CommitMessageAiModelCapability,
  CommitMessageAiSettings,
  GlobalSettings,
  Repo,
  TuiAgent
} from './types'
import {
  CUSTOM_AGENT_ID,
  getCommitMessageAgentSpec,
  getCommitMessageModel,
  isCustomAgentId,
  resolveCommitMessageAgentChoice
} from './commit-message-agent-spec'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from './commit-message-host-key'
import type { SourceControlActionId, SourceControlActionRecipe } from './source-control-ai-actions'
import type {
  RepoSourceControlAiOverrides,
  SourceControlAiOperation,
  SourceControlAiPrCreationDefaults,
  SourceControlAiSettings
} from './source-control-ai-types'
import type { CustomAgentId } from './commit-message-agent-spec'
import {
  DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
  OPERATION_LABEL,
  type ResolveSourceControlAiResult,
  commandTemplateFromOperationInstruction,
  hasActionAgentRecipe,
  normalizeRepoSourceControlAiOverrides,
  supportedSourceControlAiAgentSummary
} from './source-control-ai-normalization'
import {
  readSourceControlActionDefault,
  resolveSourceControlActionCommandTemplate
} from './source-control-ai-actions'
import type {
  ResolveSourceControlAiInput,
  ResolveSourceControlAiPrCreationDefaultsInput
} from './source-control-ai-normalization'
import {
  normalizeSourceControlAiSettings,
  readSourceControlAiModelChoiceForHost
} from './source-control-ai-settings'

function readDefaultSelectedModelId(
  settings: Pick<SourceControlAiSettings, 'selectedModelByAgent' | 'selectedModelByAgentByHost'>,
  hostKey: string,
  agentId: TuiAgent
): string | undefined {
  return readSourceControlAiModelChoiceForHost(
    {
      selectedModelByAgent: settings.selectedModelByAgent,
      selectedModelByAgentByHost: settings.selectedModelByAgentByHost
    },
    hostKey,
    agentId
  )
}

function getDiscoveredModels(
  source: SourceControlAiSettings,
  legacy: CommitMessageAiSettings | null | undefined,
  hostKey: string,
  agentId: TuiAgent
): CommitMessageAiModelCapability[] {
  return (
    source.discoveredModelsByAgentByHost?.[hostKey]?.[agentId] ??
    (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
      ? (source.discoveredModelsByAgent?.[agentId] ??
        legacy?.discoveredModelsByAgentByHost?.[hostKey]?.[agentId] ??
        legacy?.discoveredModelsByAgent?.[agentId] ??
        [])
      : (legacy?.discoveredModelsByAgentByHost?.[hostKey]?.[agentId] ?? []))
  )
}

function selectPersistedModelId(args: {
  source: SourceControlAiSettings
  legacy: CommitMessageAiSettings | null | undefined
  repoOverrides: RepoSourceControlAiOverrides | null | undefined
  operation: SourceControlAiOperation
  hostKey: string
  agentId: TuiAgent
  defaultModelId: string
}): string {
  const { source, legacy, repoOverrides, operation, hostKey, agentId, defaultModelId } = args
  return (
    readSourceControlAiModelChoiceForHost(
      repoOverrides?.modelOverridesByOperation?.[operation],
      hostKey,
      agentId
    ) ??
    readSourceControlAiModelChoiceForHost(
      source.modelOverridesByOperation?.[operation],
      hostKey,
      agentId
    ) ??
    readDefaultSelectedModelId(source, hostKey, agentId) ??
    legacy?.selectedModelByAgentByHost?.[hostKey]?.[agentId] ??
    (hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY
      ? legacy?.selectedModelByAgent?.[agentId]
      : undefined) ??
    defaultModelId
  )
}

function resolveThinkingLevel(args: {
  model: CommitMessageAiModelCapability
  source: SourceControlAiSettings
  legacy: CommitMessageAiSettings | null | undefined
  repoOverrides: RepoSourceControlAiOverrides | null | undefined
  operation: SourceControlAiOperation
}): string | undefined {
  const { model, source, legacy, repoOverrides, operation } = args
  if (!model.thinkingLevels?.length) {
    return undefined
  }
  const persisted =
    repoOverrides?.modelOverridesByOperation?.[operation]?.selectedThinkingByModel?.[model.id] ??
    source.modelOverridesByOperation?.[operation]?.selectedThinkingByModel?.[model.id] ??
    source.selectedThinkingByModel[model.id] ??
    legacy?.selectedThinkingByModel?.[model.id]
  return model.thinkingLevels.some((level) => level.id === persisted)
    ? persisted
    : model.defaultThinkingLevel
}

function hasOwnInstruction(
  instructions: Partial<Record<SourceControlAiOperation, string | null>> | null | undefined,
  operation: SourceControlAiOperation
): boolean {
  return Object.prototype.hasOwnProperty.call(instructions ?? {}, operation)
}

function readRepoInstructionOverride(
  instructions: RepoSourceControlAiOverrides['instructionsByOperation'],
  operation: SourceControlAiOperation
): string | undefined {
  if (!hasOwnInstruction(instructions, operation)) {
    return undefined
  }
  const instruction = instructions?.[operation]
  return typeof instruction === 'string' ? instruction : undefined
}

// Why: callers that already normalized settings/repo overrides reuse this to
// avoid re-normalizing the same inputs on every instruction lookup.
function resolveInstructionsFromNormalized(
  source: SourceControlAiSettings,
  repoOverrides: RepoSourceControlAiOverrides | null | undefined,
  operation: SourceControlAiOperation,
  legacyCustomPrompt: string | undefined
): string {
  const repoInstruction = readRepoInstructionOverride(
    repoOverrides?.instructionsByOperation,
    operation
  )
  if (repoInstruction !== undefined) {
    return repoInstruction.trim()
  }
  const globalInstruction = source.instructionsByOperation[operation]
  if (typeof globalInstruction === 'string') {
    return globalInstruction.trim()
  }
  return operation === 'commitMessage' ? (legacyCustomPrompt ?? '').trim() : ''
}

export function resolveSourceControlAiInstructions(args: {
  settings: Pick<GlobalSettings, 'sourceControlAi' | 'commitMessageAi'>
  repo?: Pick<Repo, 'sourceControlAi'> | null
  operation: SourceControlAiOperation
}): string {
  const source = normalizeSourceControlAiSettings(
    args.settings.sourceControlAi,
    args.settings.commitMessageAi
  )
  const repoOverrides = normalizeRepoSourceControlAiOverrides(args.repo?.sourceControlAi)
  return resolveInstructionsFromNormalized(
    source,
    repoOverrides,
    args.operation,
    args.settings.commitMessageAi?.customPrompt
  )
}

export function hasConfiguredSourceControlAiInstructions(args: {
  settings: Pick<GlobalSettings, 'sourceControlAi' | 'commitMessageAi'>
  repo?: Pick<Repo, 'sourceControlAi'> | null
  operation: SourceControlAiOperation
}): boolean {
  const repoOverrides = normalizeRepoSourceControlAiOverrides(args.repo?.sourceControlAi)
  const repoInstruction = readRepoInstructionOverride(
    repoOverrides?.instructionsByOperation,
    args.operation
  )
  if (repoInstruction !== undefined) {
    return true
  }
  return resolveSourceControlAiInstructions(args).length > 0
}

function resolvePrCreationDefaults(
  source: SourceControlAiSettings,
  repoOverrides: RepoSourceControlAiOverrides | null | undefined,
  productDefaults: SourceControlAiPrCreationDefaults | undefined
): Required<SourceControlAiPrCreationDefaults> {
  const base = {
    ...DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
    ...productDefaults,
    ...source.prCreationDefaults
  }
  const repoDefaults = repoOverrides?.prCreationDefaults
  if (!repoDefaults) {
    return base
  }
  return {
    draft: repoDefaults.draft ?? base.draft,
    useTemplate: repoDefaults.useTemplate ?? base.useTemplate,
    generateDetailsOnOpen: repoDefaults.generateDetailsOnOpen ?? base.generateDetailsOnOpen,
    openAfterCreate: repoDefaults.openAfterCreate ?? base.openAfterCreate
  }
}

function resolveActionRecipeForTextOperation(
  source: SourceControlAiSettings,
  repoOverrides: RepoSourceControlAiOverrides | null | undefined,
  operation: SourceControlAiOperation
): { agentId?: TuiAgent | CustomAgentId | null; commandInputTemplate: string; agentArgs?: string } {
  const globalRecipe = readSourceControlActionDefault(source.actions, operation)
  const repoRecipe = repoOverrides?.actionOverrides?.[operation]
  const repoInstruction = readRepoInstructionOverride(
    repoOverrides?.instructionsByOperation,
    operation
  )
  const fallbackTemplate =
    repoInstruction !== undefined
      ? commandTemplateFromOperationInstruction(operation, repoInstruction)
      : resolveSourceControlActionCommandTemplate(source.actions, operation)
  const repoTemplate =
    typeof repoRecipe?.commandInputTemplate === 'string'
      ? repoRecipe.commandInputTemplate.trim()
      : undefined
  const repoAgentArgs =
    typeof repoRecipe?.agentArgs === 'string'
      ? repoRecipe.agentArgs.trim()
      : repoRecipe?.agentArgs === null
        ? ''
        : undefined
  return {
    ...(repoRecipe?.agentId !== undefined
      ? { agentId: repoRecipe.agentId }
      : globalRecipe.agentId !== undefined
        ? { agentId: globalRecipe.agentId }
        : {}),
    ...(repoAgentArgs !== undefined
      ? { agentArgs: repoAgentArgs }
      : globalRecipe.agentArgs !== undefined
        ? { agentArgs: globalRecipe.agentArgs }
        : {}),
    commandInputTemplate:
      repoTemplate !== undefined
        ? repoTemplate
        : globalRecipe.commandInputTemplate !== undefined
          ? globalRecipe.commandInputTemplate
          : fallbackTemplate
  }
}

export function resolveSourceControlAiPrCreationDefaults(
  input: ResolveSourceControlAiPrCreationDefaultsInput
): Required<SourceControlAiPrCreationDefaults> {
  const source = normalizeSourceControlAiSettings(
    input.settings.sourceControlAi,
    input.settings.commitMessageAi
  )
  return resolvePrCreationDefaults(
    source,
    normalizeRepoSourceControlAiOverrides(input.repo?.sourceControlAi),
    input.prCreationProductDefaults
  )
}

export function resolveSourceControlAiEnabled(input: {
  settings: Pick<GlobalSettings, 'sourceControlAi' | 'commitMessageAi'> | null | undefined
  repo?: Pick<Repo, 'sourceControlAi'> | null
}): boolean {
  const source = normalizeSourceControlAiSettings(
    input.settings?.sourceControlAi,
    input.settings?.commitMessageAi
  )
  const repoOverrides = normalizeRepoSourceControlAiOverrides(input.repo?.sourceControlAi)
  return repoOverrides?.enabled ?? source.enabled
}

export function resolveSourceControlActionRecipe(input: {
  settings: Pick<GlobalSettings, 'sourceControlAi' | 'commitMessageAi'> | null | undefined
  repo?: Pick<Repo, 'sourceControlAi'> | null
  actionId: SourceControlActionId
}): SourceControlActionRecipe {
  const source = normalizeSourceControlAiSettings(
    input.settings?.sourceControlAi,
    input.settings?.commitMessageAi
  )
  const globalRecipe = readSourceControlActionDefault(source.actions, input.actionId)
  const repoRecipe = normalizeRepoSourceControlAiOverrides(input.repo?.sourceControlAi)
    ?.actionOverrides?.[input.actionId]
  if (!repoRecipe) {
    return {
      ...globalRecipe,
      commandInputTemplate: resolveSourceControlActionCommandTemplate(
        source.actions,
        input.actionId
      )
    }
  }
  return {
    ...globalRecipe,
    commandInputTemplate: resolveSourceControlActionCommandTemplate(source.actions, input.actionId),
    ...(repoRecipe.agentId !== undefined ? { agentId: repoRecipe.agentId } : {}),
    ...(typeof repoRecipe.commandInputTemplate === 'string'
      ? { commandInputTemplate: repoRecipe.commandInputTemplate.trim() }
      : {}),
    ...(typeof repoRecipe.agentArgs === 'string'
      ? { agentArgs: repoRecipe.agentArgs.trim() }
      : repoRecipe.agentArgs === null
        ? { agentArgs: '' }
        : {})
  }
}

export function resolveSourceControlAiForOperation(
  input: ResolveSourceControlAiInput
): ResolveSourceControlAiResult {
  const legacy = input.settings.commitMessageAi
  const source = normalizeSourceControlAiSettings(input.settings.sourceControlAi, legacy)
  const repoOverrides = normalizeRepoSourceControlAiOverrides(input.repo?.sourceControlAi)

  const prCreationDefaults = resolvePrCreationDefaults(
    source,
    repoOverrides,
    input.prCreationProductDefaults
  )
  const actionRecipe = resolveActionRecipeForTextOperation(source, repoOverrides, input.operation)
  if (!actionRecipe.commandInputTemplate.trim()) {
    return {
      ok: false,
      error: `Command template is empty for ${OPERATION_LABEL[input.operation]}.`
    }
  }
  // Why: action recipes own the new customization model. The legacy global
  // agent remains a fallback so existing users migrate without losing intent.
  const preferredAgent = hasActionAgentRecipe(actionRecipe) ? actionRecipe.agentId : source.agentId
  const agentChoice = resolveCommitMessageAgentChoice(
    preferredAgent,
    input.settings.defaultTuiAgent,
    input.settings.disabledTuiAgents
  )
  if (!agentChoice) {
    return {
      ok: false,
      error: `Choose a supported Source Control AI agent for this action in Settings -> Git -> Source Control AI. ${supportedSourceControlAiAgentSummary()}`
    }
  }

  const customAgentCommand =
    repoOverrides?.customAgentCommand?.trim() || source.customAgentCommand.trim()
  if (isCustomAgentId(agentChoice)) {
    if (!customAgentCommand) {
      return {
        ok: false,
        error: 'Custom command is empty. Add one in Settings -> Git -> Source Control AI.'
      }
    }
    return {
      ok: true,
      value: {
        enabled: true,
        params: {
          agentId: CUSTOM_AGENT_ID,
          model: '',
          customPrompt: resolveInstructionsFromNormalized(
            source,
            repoOverrides,
            input.operation,
            legacy?.customPrompt
          ),
          commandInputTemplate: actionRecipe.commandInputTemplate,
          ...(actionRecipe.agentArgs !== undefined ? { agentArgs: actionRecipe.agentArgs } : {}),
          customAgentCommand
        },
        prCreationDefaults
      }
    }
  }

  const agentId = agentChoice
  const actionAgentId = actionRecipe.agentId ?? agentId
  const resolvedActionAgentId =
    actionAgentId === agentId
      ? agentId
      : resolveCommitMessageAgentChoice(
          actionAgentId,
          input.settings.defaultTuiAgent,
          input.settings.disabledTuiAgents
        )
  if (!resolvedActionAgentId || isCustomAgentId(resolvedActionAgentId)) {
    return {
      ok: false,
      error: `Choose a supported Source Control AI agent for this action. ${supportedSourceControlAiAgentSummary()}`
    }
  }
  const spec = getCommitMessageAgentSpec(resolvedActionAgentId)
  if (!spec) {
    return {
      ok: false,
      error: `Agent "${resolvedActionAgentId}" does not support Source Control AI ${OPERATION_LABEL[input.operation]}. ${supportedSourceControlAiAgentSummary()}`
    }
  }

  const hostKey = input.discoveryHostKey ?? LOCAL_COMMIT_MESSAGE_HOST_KEY
  const persistedModelId = selectPersistedModelId({
    source,
    legacy,
    repoOverrides,
    operation: input.operation,
    hostKey,
    agentId: resolvedActionAgentId,
    defaultModelId: spec.defaultModelId
  })
  const discoveredModels = getDiscoveredModels(source, legacy, hostKey, resolvedActionAgentId)
  const model =
    spec.models.find((candidate) => candidate.id === persistedModelId) ??
    discoveredModels.find((candidate) => candidate.id === persistedModelId) ??
    getCommitMessageModel(resolvedActionAgentId, spec.defaultModelId)
  if (!model) {
    return { ok: false, error: `No model is available for ${spec.label}.` }
  }

  const thinkingLevel = resolveThinkingLevel({
    model,
    source,
    legacy,
    repoOverrides,
    operation: input.operation
  })
  const agentCommandOverride = input.settings.agentCmdOverrides?.[resolvedActionAgentId]?.trim()
  return {
    ok: true,
    value: {
      enabled: true,
      params: {
        agentId: resolvedActionAgentId,
        model: model.id,
        thinkingLevel,
        customPrompt: resolveInstructionsFromNormalized(
          source,
          repoOverrides,
          input.operation,
          legacy?.customPrompt
        ),
        commandInputTemplate: actionRecipe.commandInputTemplate,
        ...(actionRecipe.agentArgs !== undefined ? { agentArgs: actionRecipe.agentArgs } : {}),
        ...(customAgentCommand ? { customAgentCommand } : {}),
        ...(agentCommandOverride ? { agentCommandOverride } : {})
      },
      prCreationDefaults
    }
  }
}
