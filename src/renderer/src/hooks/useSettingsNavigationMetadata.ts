import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { isMacUserAgent, isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import {
  isWindowsTerminalCapabilityHost,
  useWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { useWindowsTerminalCapabilityOwnerKey } from './useWindowsTerminalCapabilityOwnerKey'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useLinearProviderConnected } from '@/hooks/useLinearProviderConnected'
import { isWebClientLocation } from '@/lib/web-client-location'
import { buildSettingsNavigationMetadata } from './settings-navigation-metadata-builder'

export { isWebClientLocation }

export { buildSettingsNavigationMetadata }

export function useSettingsNavigationMetadata(): SettingsNavSection[] {
  const { i18n } = useTranslation()
  const activeLocale = i18n.language
  const repos = useAppStore((state) => state.repos)
  const settings = useAppStore((state) => state.settings)
  const isMac = isMacUserAgent()
  const isWindows = isWindowsUserAgent()
  const isWebClient = isWebClientLocation()
  const isLinearConnected = useLinearProviderConnected()
  const windowsTerminalCapabilityOwnerKey = useWindowsTerminalCapabilityOwnerKey(
    settings?.activeRuntimeEnvironmentId
  )
  const runtimeTarget = getActiveRuntimeTarget(settings)
  const capabilityLoadTarget = isWebClient ? { kind: 'local' as const } : runtimeTarget
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    isWindows || isWebClient || runtimeTarget.kind === 'environment',
    false,
    windowsTerminalCapabilityOwnerKey,
    capabilityLoadTarget
  )
  const isLocalWindowsHost = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: { kind: 'local' },
    hostPlatform:
      isWebClient || runtimeTarget.kind === 'local'
        ? windowsTerminalCapabilities.hostPlatform
        : null
  })
  const isWindowsTerminalHost = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: runtimeTarget,
    hostPlatform: windowsTerminalCapabilities.hostPlatform
  })

  return useMemo(
    () =>
      buildSettingsNavigationMetadata({
        isMac,
        isWindows,
        isLocalWindowsHost,
        isWindowsTerminalHost,
        isWebClient,
        isDev: import.meta.env.DEV,
        isLinearConnected,
        repos
      }),
    [
      isMac,
      isWindows,
      isLocalWindowsHost,
      isWindowsTerminalHost,
      isWebClient,
      isLinearConnected,
      repos,
      activeLocale
    ]
  )
}
