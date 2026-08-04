import type { AgentType } from './agent-status-types'
import { sessionOptionValueIsValid } from './agent-session-option-catalog'
import type { PersistedAgentSessionOptions, SessionOptionValue } from './agent-session-option-types'

export function resolveAgentSessionOptionDefaults(
  persisted: PersistedAgentSessionOptions | null | undefined,
  agent: AgentType
): Record<string, SessionOptionValue> | undefined {
  const entry = persisted?.[agent]
  const modelId = typeof entry?.model === 'string' && entry.model.trim() ? entry.model : undefined
  if (!modelId) {
    return undefined
  }
  const values: Record<string, SessionOptionValue> = { model: modelId }
  const storedValues = entry?.valuesByModel?.[modelId]
  if (storedValues && typeof storedValues === 'object') {
    for (const [id, value] of Object.entries(storedValues)) {
      if (sessionOptionValueIsValid(value)) {
        values[id] = value
      }
    }
  }
  return values
}

export function updateAgentSessionOptionDefaults(args: {
  persisted: PersistedAgentSessionOptions | null | undefined
  agent: AgentType
  modelId: string
  optionId: string
  value: SessionOptionValue
}): PersistedAgentSessionOptions {
  const currentAgent = args.persisted?.[args.agent]
  const currentModelValues = currentAgent?.valuesByModel?.[args.modelId] ?? {}
  const valuesByModel = {
    ...currentAgent?.valuesByModel,
    ...(args.optionId === 'model'
      ? {}
      : { [args.modelId]: { ...currentModelValues, [args.optionId]: args.value } })
  }
  return {
    ...args.persisted,
    [args.agent]: {
      ...currentAgent,
      model: args.optionId === 'model' ? String(args.value) : args.modelId,
      valuesByModel
    }
  }
}
