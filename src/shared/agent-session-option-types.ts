export type SessionOptionValue = string | boolean

export type SessionOptionSelectChoice = {
  value: string
  label: string
  description?: string
}

export type SessionOptionValueSource = 'applied' | 'dispatched' | 'reported' | 'unknown'

export type SessionOptionDisabledReason =
  | 'available-after-session-start'
  | 'set-when-session-starts'

export type SessionOptionDescriptor = {
  id: string
  label: string
  description?: string
  category?: 'model' | 'thought_level' | 'model_config' | 'mode'
  kind:
    | {
        type: 'select'
        currentValue?: string
        choices: SessionOptionSelectChoice[]
      }
    | { type: 'boolean'; currentValue?: boolean }
  valueSource: SessionOptionValueSource
  settable: boolean
  disabledReason?: SessionOptionDisabledReason
  action?: { type: 'agent-picker' | 'toggle-command' }
}

export type SessionOptionSetResult = {
  snapshot: SessionOptionDescriptor[]
}

export type PersistedAgentSessionOptions = Partial<
  Record<
    string,
    {
      model?: string
      valuesByModel?: Record<string, Record<string, SessionOptionValue>>
    }
  >
>

export type SessionOptionsSurface = {
  getSnapshot(): SessionOptionDescriptor[]
  setOption(id: string, value: SessionOptionValue): Promise<SessionOptionSetResult>
  invokeAction(id: string): Promise<SessionOptionSetResult>
  subscribe(listener: (snapshot: SessionOptionDescriptor[]) => void): () => void
}
