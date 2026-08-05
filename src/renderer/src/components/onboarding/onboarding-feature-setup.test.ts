import { describe, expect, it, vi } from 'vitest'
import type { CliInstallStatus } from '../../../../shared/cli-install-types'
import {
  buildAgentFeatureSkillInstallCommand,
  ORCA_CLI_SKILL_NAME,
  ORCA_LINEAR_SKILL_NAME
} from '@/lib/agent-feature-install-commands'
import { BROWSER_USE_ENABLED_STORAGE_KEY } from '@/lib/browser-use-setup-state'
import {
  DEFAULT_ONBOARDING_FEATURE_SETUP_SELECTION,
  buildOnboardingFeatureSetupClipboardText,
  onboardingFeatureSetupRunTelemetry,
  onboardingFeatureSetupTelemetryFeature,
  onboardingFeatureSetupTelemetrySelection,
  runOnboardingFeatureSetup,
  type OnboardingFeatureSetupDeps,
  type OnboardingFeatureSetupSelection
} from './onboarding-feature-setup'

const ALL_SKILL_INSTALL_COMMAND = buildAgentFeatureSkillInstallCommand([
  ORCA_CLI_SKILL_NAME,
  ORCA_LINEAR_SKILL_NAME
])

const INSTALLED_CLI_STATUS: CliInstallStatus = {
  platform: 'darwin',
  commandName: 'orca',
  commandPath: '/usr/local/bin/orca',
  pathDirectory: '/usr/local/bin',
  pathConfigured: true,
  launcherPath: '/Applications/Orca.app/Contents/MacOS/Orca',
  installMethod: 'symlink',
  supported: true,
  state: 'installed',
  currentTarget: '/Applications/Orca.app/Contents/MacOS/Orca',
  unsupportedReason: null,
  detail: null
}

function createDeps(
  overrides: Partial<OnboardingFeatureSetupDeps> = {}
): OnboardingFeatureSetupDeps & {
  storage: Map<string, string>
  clipboardWrites: string[]
} {
  const storage = new Map<string, string>()
  const clipboardWrites: string[] = []
  return {
    storage,
    clipboardWrites,
    getCliStatus: vi.fn(async () => INSTALLED_CLI_STATUS),
    showCliRegistrationPrompt: vi.fn(async () => undefined),
    installCli: vi.fn(async () => INSTALLED_CLI_STATUS),
    writeClipboardText: vi.fn(async (text: string) => {
      clipboardWrites.push(text)
    }),
    setStorageItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    ...overrides
  }
}

describe('onboarding feature setup runner', () => {
  it('defaults every setup item on so first-launch setup is ready to run', () => {
    expect(DEFAULT_ONBOARDING_FEATURE_SETUP_SELECTION).toEqual({
      browserUse: true,
      linearTickets: false
    })
  })

  it('builds one skill command for selected onboarding feature setup skills', () => {
    const text = buildOnboardingFeatureSetupClipboardText({
      browserUse: true,
      linearTickets: true
    })

    expect(text).toBe(ALL_SKILL_INSTALL_COMMAND)
    expect(text).toBe(
      'npx skills add https://github.com/stablyai/orca --skill orca-cli --skill orca-linear --global'
    )
  })

  it('builds privacy-safe telemetry payloads for selected feature setup items', () => {
    const selection: OnboardingFeatureSetupSelection = {
      browserUse: true,
      linearTickets: true
    }

    expect(onboardingFeatureSetupTelemetryFeature('browserUse')).toBe('browser_use')
    expect(onboardingFeatureSetupTelemetrySelection(selection)).toEqual({
      browser_use: true,
      linear_tickets: true,
      selected_count: 1
    })
    expect(
      onboardingFeatureSetupRunTelemetry(selection, {
        selectedIds: ['browserUse', 'linearTickets'],
        cliTouched: true,
        skillCommandsCopied: false,
        skillInstallCommand: ALL_SKILL_INSTALL_COMMAND,
        warnings: [{ featureId: 'skills', message: 'Clipboard unavailable' }]
      })
    ).toEqual({
      browser_use: true,
      linear_tickets: true,
      selected_count: 1,
      cli_touched: true,
      skill_commands_copied: false,
      skill_install_command_prepared: true,
      warning_count: 1
    })
  })

  it('runs selected feature setup through injected deps only', async () => {
    const result = await runOnboardingFeatureSetup(
      { browserUse: true, linearTickets: true },
      createDeps()
    )

    expect(result).toEqual({
      selectedIds: ['browserUse', 'linearTickets'],
      cliTouched: false,
      skillCommandsCopied: true,
      skillInstallCommand: ALL_SKILL_INSTALL_COMMAND,
      warnings: []
    })
  })

  it('clears feature markers when no setup items are selected', async () => {
    const deps = createDeps()

    const result = await runOnboardingFeatureSetup(
      { browserUse: false, linearTickets: false },
      deps
    )

    expect(result).toEqual({
      selectedIds: [],
      cliTouched: false,
      skillCommandsCopied: false,
      skillInstallCommand: null,
      warnings: []
    })
    expect(deps.storage.get(BROWSER_USE_ENABLED_STORAGE_KEY)).toBe('0')
    expect(deps.getCliStatus).not.toHaveBeenCalled()
    expect(deps.showCliRegistrationPrompt).not.toHaveBeenCalled()
    expect(deps.clipboardWrites).toEqual([])
  })

  it('warns when selected skill commands cannot be copied', async () => {
    const deps = createDeps({
      writeClipboardText: vi.fn(async () => {
        throw new Error('Clipboard unavailable')
      })
    })

    const result = await runOnboardingFeatureSetup({ browserUse: true, linearTickets: false }, deps)

    expect(result.skillCommandsCopied).toBe(false)
    expect(result.skillInstallCommand).toBe(
      buildAgentFeatureSkillInstallCommand([ORCA_CLI_SKILL_NAME])
    )
    expect(result.warnings).toEqual([
      {
        featureId: 'skills',
        message: 'Clipboard unavailable'
      }
    ])
    expect(deps.clipboardWrites).toEqual([])
  })

  it('shows CLI registration context before installing a missing CLI during onboarding', async () => {
    const staleStatus: CliInstallStatus = {
      ...INSTALLED_CLI_STATUS,
      state: 'stale',
      currentTarget: '/tmp/other-orca',
      detail: '/usr/local/bin/orca points to a different launcher.'
    }
    const showCliRegistrationPrompt = vi.fn(async () => undefined)
    const installCli = vi.fn(async () => INSTALLED_CLI_STATUS)
    const deps = createDeps({
      getCliStatus: vi.fn(async () => staleStatus),
      showCliRegistrationPrompt,
      installCli
    })

    const result = await runOnboardingFeatureSetup({ browserUse: true, linearTickets: false }, deps)

    expect(result.cliTouched).toBe(true)
    expect(showCliRegistrationPrompt).toHaveBeenCalledTimes(1)
    expect(installCli).toHaveBeenCalledTimes(1)
    expect(showCliRegistrationPrompt.mock.invocationCallOrder[0]).toBeLessThan(
      installCli.mock.invocationCallOrder[0]
    )
  })

  it('warns without changing PATH when the Windows registry read is unknown', async () => {
    const unknownStatus: CliInstallStatus = {
      ...INSTALLED_CLI_STATUS,
      platform: 'win32',
      pathConfigured: null,
      detail: 'Orca could not read the Windows user PATH registry value.'
    }
    const deps = createDeps({ getCliStatus: vi.fn(async () => unknownStatus) })

    const result = await runOnboardingFeatureSetup({ browserUse: true, linearTickets: false }, deps)

    expect(result.cliTouched).toBe(false)
    expect(result.warnings).toContainEqual({ featureId: 'cli', message: unknownStatus.detail })
    expect(deps.showCliRegistrationPrompt).not.toHaveBeenCalled()
    expect(deps.installCli).not.toHaveBeenCalled()
  })
})
