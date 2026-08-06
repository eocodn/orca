import { translate } from '@/i18n/i18n'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/types'

export type RuntimeScope = {
  label: string
  description: string
}

export type RuntimeRateLimitScope = RuntimeScope

export function getIntegrationRuntimeScope(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): RuntimeScope {
  const runtimeId = settings?.activeRuntimeEnvironmentId?.trim()
  if (runtimeId) {
    return {
      label: translate(
        'auto.components.settings.runtimeScope.remoteServer',
        'Remote server: {{value0}}',
        {
          value0: runtimeId
        }
      ),
      description: translate(
        'auto.components.settings.runtimeScope.remoteCredentials',
        'Credentials for this integration are owned by this remote server. Use Settings > Remote Orca Servers > Advanced to edit another default runtime scope.'
      )
    }
  }
  return {
    label: getLocalExecutionHostLabel(),
    description: translate(
      'auto.components.settings.runtimeScope.localCredentials',
      'Credentials for this integration are owned by this desktop client. Use Settings > Remote Orca Servers > Advanced to edit server-owned credentials.'
    )
  }
}

export function getRuntimeRateLimitScope(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  providerLabel: string
): RuntimeRateLimitScope {
  const runtimeId = settings?.activeRuntimeEnvironmentId?.trim()
  if (runtimeId) {
    return {
      label: translate(
        'auto.components.settings.runtimeScope.remoteServer',
        'Remote server: {{value0}}',
        {
          value0: runtimeId
        }
      ),
      description: translate(
        'auto.components.settings.runtimeScope.remoteRateLimit',
        '{{value0}} API budget is fetched from the CLI on this remote server. Use Settings > Remote Orca Servers > Advanced to view another default runtime budget.',
        { value0: providerLabel }
      )
    }
  }
  return {
    label: getLocalExecutionHostLabel(),
    description: translate(
      'auto.components.settings.runtimeScope.localRateLimit',
      '{{value0}} API budget is fetched from the CLI on this desktop client. Use Settings > Remote Orca Servers > Advanced to view server-owned budgets.',
      { value0: providerLabel }
    )
  }
}
