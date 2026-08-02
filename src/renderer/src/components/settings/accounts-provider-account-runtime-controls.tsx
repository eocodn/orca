// Concrete WSL account-location controls shared by provider sections.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { WSL_DEFAULT_DISTRO_KEY } from './provider-account-visibility'
import { translate } from '@/i18n/i18n'
import { getHostRuntimeLabel, type LocalAccountRuntime } from './accounts-pane-state'
import type { GlobalSettings } from '../../../../shared/types'

type AccountRuntimeControlsProps = {
  wslSupportedPlatform: boolean
  wslAvailable: boolean
  wslDistros: string[]
  wslCapabilitiesLoading: boolean
  accountRuntime: LocalAccountRuntime
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function AccountsProviderAccountRuntimeControls({
  wslSupportedPlatform,
  wslAvailable,
  wslDistros,
  wslCapabilitiesLoading,
  accountRuntime,
  updateSettings
}: AccountRuntimeControlsProps): React.JSX.Element | null {
  if (!wslSupportedPlatform) {
    return null
  }

  return (
    <SearchableSetting
      title={translate('auto.components.settings.AccountsPane.f54b4fbd71', 'Account Location')}
      description={translate(
        'auto.components.settings.AccountsPane.2cd197025c',
        'Choose whether provider accounts are inspected and added in {{value0}} or WSL.',
        { value0: getHostRuntimeLabel() }
      )}
      keywords={['account', 'location', 'windows', 'wsl', 'linux', 'provider', 'auth']}
    >
      <SettingsRow
        label={translate('auto.components.settings.AccountsPane.46cf7e7495', 'Account location')}
        alignTop
        description={
          accountRuntime.runtime === 'wsl' && !wslAvailable && !wslCapabilitiesLoading
            ? translate(
                'auto.components.settings.AccountsPane.0c67a2a1aa',
                'WSL is not available on this machine.'
              )
            : translate(
                'auto.components.settings.AccountsPane.0b4591ff93',
                'Choose which local environment to inspect and where new managed Claude and Codex accounts are added.'
              )
        }
        control={
          <div className="flex w-44 flex-col items-stretch gap-2">
            <SettingsSegmentedControl
              ariaLabel={translate(
                'auto.components.settings.AccountsPane.46cf7e7495',
                'Account location'
              )}
              value={accountRuntime.runtime}
              onChange={(value) => updateSettings({ localAccountRuntime: value })}
              equalWidth
              options={[
                { value: 'host', label: getHostRuntimeLabel() },
                {
                  value: 'wsl',
                  label: translate('auto.components.settings.AccountsPane.8619f9afa9', 'WSL'),
                  disabled: wslCapabilitiesLoading || !wslAvailable
                } as const
              ]}
            />
            {accountRuntime.runtime === 'wsl' ? (
              <Select
                value={accountRuntime.wslDistro ?? WSL_DEFAULT_DISTRO_KEY}
                onValueChange={(value) =>
                  updateSettings({
                    localAccountRuntime: 'wsl',
                    localAccountWslDistro: value === WSL_DEFAULT_DISTRO_KEY ? null : value
                  })
                }
                disabled={wslCapabilitiesLoading || !wslAvailable}
              >
                <SelectTrigger size="sm" className="w-full min-w-44">
                  <SelectValue
                    placeholder={
                      wslCapabilitiesLoading
                        ? translate(
                            'auto.components.settings.AccountsPane.ad47a33f72',
                            'Loading WSL'
                          )
                        : translate(
                            'auto.components.settings.AccountsPane.2358ac71d2',
                            'WSL default'
                          )
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WSL_DEFAULT_DISTRO_KEY}>
                    {translate('auto.components.settings.AccountsPane.2358ac71d2', 'WSL default')}
                  </SelectItem>
                  {wslDistros.map((distro) => (
                    <SelectItem key={distro} value={distro}>
                      {distro}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        }
      />
    </SearchableSetting>
  )
}
