import {
  CUSTOM_AGENT_ID,
  listCommitMessageAgentCapabilities,
  type CustomAgentId,
  isCustomAgentId
} from './commit-message-agent-spec'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  normalizeSourceControlActionRecipe,
  readSourceControlActionDefault,
  SOURCE_CONTROL_ACTION_IDS,
  SOURCE_CONTROL_TEXT_ACTION_IDS,
  type SourceControlActionId,
  type SourceControlActionRecipe
} from './source-control-ai-actions'
import type {
  CommitMessageAiSettings,
  GlobalSettings,
  Repo,
  TuiAgent
} from './types'
import type {
  RepoSourceControlAiOverrides,
  SourceControlAiModelChoice,
  SourceControlAiOperation,
  SourceControlAiPrCreationDefaults,
  SourceControlAiSettings
} from './source-control-ai-types'

export const DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS: Required<SourceControlAiPrCreationDefaults> =
  {
    draft: false,
    useTemplate: false,
    generateDetailsOnOpen: false,
    openAfterCreate: false
  }

export type ResolvedSourceControlAiGenerationParams = {
  agentId: TuiAgent | 'custom'
  model: string
  thinkingLevel?: string
  customPrompt?: string
  commandInputTemplate?: string
  agentArgs?: string
  customAgentCommand?: string
  agentCommandOverride?: string
}

export type ResolvedSourceControlAiOperation = {
  enabled: boolean
  params: ResolvedSourceControlAiGenerationParams
  prCreationDefaults: Required<SourceControlAiPrCreationDefaults>
}

export type ResolveSourceControlAiResult =
  | { ok: true; value: ResolvedSourceControlAiOperation }
  | { ok: false; error: string }

export type ResolveSourceControlAiInput = {
  settings: Pick<
    GlobalSettings,
    'defaultTuiAgent' | 'agentCmdOverrides' | 'commitMessageAi' | 'sourceControlAi'
  > &
    Partial<Pick<GlobalSettings, 'disabledTuiAgents'>>
  repo?: Pick<Repo, 'sourceControlAi'> | null
  operation: SourceControlAiOperation
  discoveryHostKey?: string
  prCreationProductDefaults?: SourceControlAiPrCreationDefaults
}

export type ResolveSourceControlAiPrCreationDefaultsInput = {
  settings: Pick<GlobalSettings, 'commitMessageAi' | 'sourceControlAi'>
  repo?: Pick<Repo, 'sourceControlAi'> | null
  prCreationProductDefaults?: SourceControlAiPrCreationDefaults
}

type RepoSourceControlActionOverride = NonNullable<
  NonNullable<RepoSourceControlAiOverrides['actionOverrides']>[SourceControlActionId]
>

export const OPERATION_LABEL: Record<SourceControlAiOperation, string> = {
  commitMessage: 'commit messages',
  pullRequest: 'pull request details',
  branchName: 'branch names'
}

// Why: SourceControlAiOperation is exactly SourceControlTextActionId, so the
// operation list must stay derived from the canonical action ids, not duplicated.
const SOURCE_CONTROL_AI_OPERATIONS: readonly SourceControlAiOperation[] =
  SOURCE_CONTROL_TEXT_ACTION_IDS
const PR_CREATION_DEFAULT_KEYS = [
  'draft',
  'useTemplate',
  'generateDetailsOnOpen',
  'openAfterCreate'
] as const

export function supportedSourceControlAiAgentSummary(): string {
  return `Supported agents: ${listCommitMessageAgentCapabilities()
    .map((capability) => capability.label)
    .join(', ')}, or Custom command.`
}

export function copyRecord<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasEntries(value: Record<string, unknown> | null | undefined): boolean {
  return Object.keys(value ?? {}).length > 0
}

function isSafeRecordKey(key: string): boolean {
  return key !== '' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSafeRecordKey(key) && typeof item === 'string') {
      normalized[key] = item
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeAgentModelRecord(value: unknown): Partial<Record<TuiAgent, string>> | undefined {
  return normalizeStringRecord(value) as Partial<Record<TuiAgent, string>> | undefined
}

function normalizeHostAgentModelRecord(
  value: unknown
): Partial<Record<string, Partial<Record<TuiAgent, string>>>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: Partial<Record<string, Partial<Record<TuiAgent, string>>>> = {}
  for (const [hostKey, hostModels] of Object.entries(value)) {
    if (!isSafeRecordKey(hostKey)) {
      continue
    }
    const normalizedHostModels = normalizeAgentModelRecord(hostModels)
    if (normalizedHostModels) {
      normalized[hostKey] = normalizedHostModels
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeSourceControlAiModelChoice(
  value: unknown
): SourceControlAiModelChoice | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const choice: SourceControlAiModelChoice = {}
  const selectedModelByAgent = normalizeAgentModelRecord(value.selectedModelByAgent)
  if (selectedModelByAgent) {
    choice.selectedModelByAgent = selectedModelByAgent
  }
  const selectedModelByAgentByHost = normalizeHostAgentModelRecord(value.selectedModelByAgentByHost)
  if (selectedModelByAgentByHost) {
    choice.selectedModelByAgentByHost = selectedModelByAgentByHost
  }
  const selectedThinkingByModel = normalizeStringRecord(value.selectedThinkingByModel)
  if (selectedThinkingByModel) {
    choice.selectedThinkingByModel = selectedThinkingByModel
  }
  return Object.keys(choice).length > 0 ? choice : undefined
}

function normalizeOperationRecord<T>(
  value: unknown,
  normalizeValue: (value: unknown) => T | undefined
): Partial<Record<SourceControlAiOperation, T>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: Partial<Record<SourceControlAiOperation, T>> = {}
  for (const operation of SOURCE_CONTROL_AI_OPERATIONS) {
    if (!Object.prototype.hasOwnProperty.call(value, operation)) {
      continue
    }
    const normalizedValue = normalizeValue(value[operation])
    if (normalizedValue !== undefined) {
      normalized[operation] = normalizedValue
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeActionRecord<T>(
  value: unknown,
  normalizeValue: (value: unknown) => T | undefined
): Partial<Record<SourceControlActionId, T>> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: Partial<Record<SourceControlActionId, T>> = {}
  for (const actionId of SOURCE_CONTROL_ACTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(value, actionId)) {
      continue
    }
    const normalizedValue = normalizeValue(value[actionId])
    if (normalizedValue !== undefined) {
      normalized[actionId] = normalizedValue
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeRepoInstruction(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined
}

function normalizeRepoPrCreationDefaults(
  value: unknown
): RepoSourceControlAiOverrides['prCreationDefaults'] {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: NonNullable<RepoSourceControlAiOverrides['prCreationDefaults']> = {}
  for (const key of PR_CREATION_DEFAULT_KEYS) {
    const item = value[key]
    if (typeof item === 'boolean' || item === null) {
      normalized[key] = item
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function normalizeRepoSourceControlAiOverrides(
  value: unknown
): RepoSourceControlAiOverrides | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const normalized: RepoSourceControlAiOverrides = {}
  if (typeof value.enabled === 'boolean') {
    normalized.enabled = value.enabled
  }
  if (typeof value.customAgentCommand === 'string') {
    const customAgentCommand = value.customAgentCommand.trim()
    if (customAgentCommand) {
      normalized.customAgentCommand = customAgentCommand
    }
  }
  const modelOverridesByOperation = normalizeOperationRecord(
    value.modelOverridesByOperation,
    normalizeSourceControlAiModelChoice
  )
  if (modelOverridesByOperation) {
    normalized.modelOverridesByOperation = modelOverridesByOperation
  }
  const instructionsByOperation = normalizeOperationRecord(
    value.instructionsByOperation,
    normalizeRepoInstruction
  )
  if (instructionsByOperation) {
    normalized.instructionsByOperation = instructionsByOperation
  }
  const actionOverrides = normalizeActionRecord<RepoSourceControlActionOverride>(
    value.actionOverrides,
    (item) => {
      if (!isRecord(item)) {
        return undefined
      }
      const normalized: RepoSourceControlActionOverride = {
        ...normalizeSourceControlActionRecipe(item)
      }
      if (item.commandInputTemplate === null) {
        normalized.commandInputTemplate = null
      }
      if (item.agentArgs === null) {
        normalized.agentArgs = null
      }
      return Object.keys(normalized).length > 0 ? normalized : undefined
    }
  )
  const migratedActionOverrides = { ...actionOverrides }
  for (const operation of SOURCE_CONTROL_TEXT_ACTION_IDS) {
    const instruction = instructionsByOperation?.[operation]
    const existingTemplate = migratedActionOverrides[operation]?.commandInputTemplate
    if (
      typeof instruction === 'string' &&
      (existingTemplate === undefined ||
        isLegacyBranchInstructionTemplate(operation, instruction, existingTemplate))
    ) {
      migratedActionOverrides[operation] = {
        ...migratedActionOverrides[operation],
        commandInputTemplate: commandTemplateFromOperationInstruction(operation, instruction)
      }
    }
  }
  if (Object.keys(migratedActionOverrides).length > 0) {
    normalized.actionOverrides = migratedActionOverrides
  }
  const prCreationDefaults = normalizeRepoPrCreationDefaults(value.prCreationDefaults)
  if (prCreationDefaults) {
    normalized.prCreationDefaults = prCreationDefaults
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function commandTemplateFromInstruction(instruction: string | null | undefined): string {
  const trimmed = instruction?.trim()
  if (!trimmed) {
    return '{basePrompt}'
  }
  return ['{basePrompt}', '', trimmed].join('\n')
}

export function commandTemplateFromOperationInstruction(
  operation: SourceControlAiOperation,
  instruction: string | null | undefined
): string {
  const trimmed = instruction?.trim()
  if (!trimmed) {
    return '{basePrompt}'
  }
  // Why: branch naming instructions define naming style, so they must precede
  // the general built-in prompt. Other operations retain their released order.
  return operation === 'branchName'
    ? [trimmed, '', '{basePrompt}'].join('\n')
    : commandTemplateFromInstruction(trimmed)
}

export function isLegacyBranchInstructionTemplate(
  operation: SourceControlAiOperation,
  instruction: string | null | undefined,
  template: string | null | undefined
): boolean {
  // Why: reorder only the exact template older settings derived automatically;
  // a user-authored command template remains authoritative.
  return (
    operation === 'branchName' &&
    Boolean(instruction?.trim()) &&
    template === commandTemplateFromInstruction(instruction)
  )
}

export function actionRecipeFromLegacyCommitMessageAi(legacy: CommitMessageAiSettings): {
  agentId?: TuiAgent | CustomAgentId | null
  commandInputTemplate: string
} {
  return {
    ...(legacy.agentId === null
      ? { agentId: null }
      : isCustomAgentId(legacy.agentId)
        ? { agentId: CUSTOM_AGENT_ID }
        : legacy.agentId
          ? { agentId: legacy.agentId }
          : {}),
    commandInputTemplate: commandTemplateFromInstruction(legacy.customPrompt)
  }
}

export function legacyPromptFromCommandTemplate(
  template: string | undefined,
  fallback: string | undefined
): string {
  const trimmed = template?.trim()
  if (!trimmed || trimmed === '{basePrompt}') {
    return fallback ?? ''
  }
  if (trimmed.startsWith('{basePrompt}')) {
    return trimmed.slice('{basePrompt}'.length).trim()
  }
  return trimmed
}

export function hasActionAgentRecipe(recipe: {
  agentId?: TuiAgent | CustomAgentId | null
}): recipe is { agentId: TuiAgent | CustomAgentId | null } {
  return Object.prototype.hasOwnProperty.call(recipe, 'agentId')
}

export function legacyCommitMessageCoreChanges(
  legacy: CommitMessageAiSettings,
  projected: CommitMessageAiSettings
): Record<'enabled' | 'agentId' | 'customPrompt' | 'customAgentCommand', boolean> {
  return {
    enabled: legacy.enabled !== projected.enabled,
    agentId: legacy.agentId !== projected.agentId,
    customPrompt: legacy.customPrompt !== projected.customPrompt,
    customAgentCommand: legacy.customAgentCommand !== projected.customAgentCommand
  }
}

export function hasLegacyCommitMessageCoreChanges(
  changes: Record<'enabled' | 'agentId' | 'customPrompt' | 'customAgentCommand', boolean>
): boolean {
  return Object.values(changes).some(Boolean)
}

export function applyLegacyAgentToActionRecipe(
  recipe: SourceControlActionRecipe | undefined,
  agentId: CommitMessageAiSettings['agentId']
): SourceControlActionRecipe {
  const next = { ...recipe }
  if (agentId === null) {
    next.agentId = null
  } else if (isCustomAgentId(agentId)) {
    next.agentId = CUSTOM_AGENT_ID
  } else if (agentId && !isCustomAgentId(agentId)) {
    next.agentId = agentId
  } else {
    delete next.agentId
  }
  return next
}

export function shouldImportLegacyBranchPrompt(
  base: SourceControlAiSettings,
  projectedLegacy: CommitMessageAiSettings
): boolean {
  const branchRecipe = readSourceControlActionDefault(base.actions, 'branchName')
  const projectedTemplate = commandTemplateFromOperationInstruction(
    'branchName',
    projectedLegacy.customPrompt
  )
  return (
    branchRecipe.commandInputTemplate === undefined ||
    branchRecipe.commandInputTemplate ===
      DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.branchName ||
    // Why: stale legacy branch instructions can remain after a user customizes
    // the new branch action recipe; only recipe state can prove it is still coupled.
    branchRecipe.commandInputTemplate === projectedTemplate
  )
}

export function shouldImportLegacyBranchAgent(
  base: SourceControlAiSettings,
  projectedLegacy: CommitMessageAiSettings
): boolean {
  const branchRecipe = readSourceControlActionDefault(base.actions, 'branchName')
  return !hasActionAgentRecipe(branchRecipe) || branchRecipe.agentId === projectedLegacy.agentId
}
