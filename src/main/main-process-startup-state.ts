import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { Store } from './persistence'
import { StatsCollector } from './stats/collector'
import { ClaudeUsageStore } from './claude-usage/store'
import { CodexUsageStore } from './codex-usage/store'
import { OpenCodeUsageStore } from './opencode-usage/store'
import { CodexAccountService } from './codex-accounts/service'
import { CodexRuntimeHomeService } from './codex-accounts/runtime-home-service'
import { ClaudeAccountService } from './claude-accounts/service'
import { ClaudeRuntimeAuthService } from './claude-accounts/runtime-auth-service'
import { OrcaRuntimeService } from './runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime/runtime-rpc'
import { ServeReadinessPublisher } from './server/serve-readiness'
import { DesktopRelayService } from './runtime/relay/desktop-relay-service'
import type { RelayBrokerStatus } from './runtime/relay/relay-session-broker'
import { RateLimitService } from './rate-limits/service'
import { AutomationService } from './automations/service'
import { AgentAwakeService } from './agent-awake-service'
import { StarNagService } from './star-nag/service'
import { KeybindingService } from './keybindings/keybinding-service'
import { PluginService } from './plugins/plugin-service'
import { PluginKillListService } from './plugins/plugin-kill-list-service'
import { PluginMarketplaceService } from './plugins/plugin-marketplace-service'
import { PluginMarketplaceInstaller } from './plugins/plugin-marketplace-installer'
import { CrashReportStore } from './crash-reporting/crash-report-store'
import {
  DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD,
  DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
  GpuCrashFallbackTracker
} from './crash-reporting/gpu-crash-fallback-decision'
import { createServeDesktopActivationGate } from './startup/serve-desktop-activation'
import { getDevInstanceIdentity } from './startup/dev-instance-identity'
import { isQuittingForUpdate } from './updater'
import type { ExpectedTeardownScope } from './crash-reporting/process-gone-classification'
import { recordCoalescedCrashBreadcrumb } from './crash-reporting/crash-breadcrumb-store'
import type { SyntheticTitleSpinnerEntry } from './synthetic-title-spinner'
import type { SyntheticAgentTitleProfile } from '../shared/synthetic-agent-title'

type WebContentsTimedFlag = {
  mark: (webContentsId: number, durationMs?: number) => void
  clear: (webContentsId?: number) => void
  matches: (webContentsId: number, options?: { consume?: boolean }) => boolean
}

function createWebContentsTimedFlag(defaultDurationMs = 10_000): WebContentsTimedFlag {
  let state: { webContentsId: number; until: number } | null = null
  return {
    mark(webContentsId, durationMs = defaultDurationMs) {
      state = { webContentsId, until: Date.now() + durationMs }
    },
    clear(webContentsId) {
      if (webContentsId === undefined || state?.webContentsId === webContentsId) {
        state = null
      }
    },
    matches(webContentsId, options) {
      if (!state || Date.now() > state.until) {
        state = null
        return false
      }
      if (state.webContentsId !== webContentsId) {
        return false
      }
      if (options?.consume) {
        state = null
      }
      return true
    }
  }
}

export const startupState = {
  mainWindow: null as BrowserWindow | null,
  isQuitting: false,
  store: null as Store | null,
  stats: null as StatsCollector | null,
  claudeUsage: null as ClaudeUsageStore | null,
  codexUsage: null as CodexUsageStore | null,
  openCodeUsage: null as OpenCodeUsageStore | null,
  codexAccounts: null as CodexAccountService | null,
  codexRuntimeHome: null as CodexRuntimeHomeService | null,
  claudeAccounts: null as ClaudeAccountService | null,
  claudeRuntimeAuth: null as ClaudeRuntimeAuthService | null,
  runtime: null as OrcaRuntimeService | null,
  rateLimits: null as RateLimitService | null,
  runtimeRpc: null as OrcaRuntimeRpcServer | null,
  serveReadinessPublisher: new ServeReadinessPublisher(),
  desktopRelayService: null as DesktopRelayService | null,
  desktopRelayStatus: 'offline' as RelayBrokerStatus,
  pendingUnpairedDeviceAuthFailure: false,
  headlessBrowserDisplayAvailable: false,
  starNag: null as StarNagService | null,
  agentAwakeService: null as AgentAwakeService | null,
  crashReports: null as CrashReportStore | null,
  unsubscribeAgentAwakeStatusChanges: null as (() => void) | null,
  unsubscribeSystemResumeBroadcast: null as (() => void) | null,
  watcherShutdownPromise: null as Promise<void> | null,
  watcherShutdownDone: false,
  automations: null as AutomationService | null,
  pluginService: null as PluginService | null,
  pluginKillListService: null as PluginKillListService | null,
  pluginMarketplaceService: null as PluginMarketplaceService | null,
  pluginMarketplaceInstaller: null as PluginMarketplaceInstaller | null,
  keybindings: null as KeybindingService | null,
  expectedRendererReload: createWebContentsTimedFlag(),
  recoveryReloadInFlight: createWebContentsTimedFlag(),
  pendingOpenSettings: createWebContentsTimedFlag(),
  firstWindowStartupServicesReady: Promise.resolve(),
  managedWslCliReconciliationReady: Promise.resolve(),
  managedWslCliStartupBarrierReady: Promise.resolve(),
  managedWslCliReconciliationStatus: 'settled' as 'pending' | 'settled' | 'failed',
  gpuCrashFallbackTracker: new GpuCrashFallbackTracker({
    windowMs: DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
    threshold: DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD
  }),
  gpuFallbackActiveThisLaunch: false,
  gpuFeatureStatus: null as Electron.GPUFeatureStatus | null,
  localPtyStartupReady: Promise.resolve(),
  localPtyProviderStartupReady: Promise.resolve(),
  isServeMode: process.argv.includes('--serve'),
  devInstanceIdentity: getDevInstanceIdentity(is.dev),
  devAgentHookEndpointNamespace: undefined as string | undefined,
  trayCreateFallbackMs: 12_000,
  startupDiagnosticsEnabled: false,
  desktopActivationGate: null as ReturnType<typeof createServeDesktopActivationGate> | null,
  daemonDisconnectDone: false,
  syntheticTitleSpinnerByPaneKey: new Map<
    string,
    SyntheticTitleSpinnerEntry<SyntheticAgentTitleProfile>
  >(),
  syntheticTitleSpinnerTimer: null as ReturnType<typeof setInterval> | null
}

export function markExpectedRendererReload(webContentsId: number, durationMs = 10_000): void {
  startupState.expectedRendererReload.mark(webContentsId, durationMs)
}

export function clearExpectedRendererReload(webContentsId?: number): void {
  startupState.expectedRendererReload.clear(webContentsId)
}

export function getExpectedTeardownScope(webContentsId?: number): ExpectedTeardownScope {
  if (startupState.isQuitting || isQuittingForUpdate()) {
    return 'app-shutdown'
  }
  if (webContentsId === undefined) {
    return 'none'
  }
  return startupState.expectedRendererReload.matches(webContentsId)
    ? 'renderer-reload'
    : 'none'
}

export function markRecoveryReloadInFlight(webContentsId: number, durationMs = 10_000): void {
  startupState.recoveryReloadInFlight.mark(webContentsId, durationMs)
}

export function isRecoveryReloadInFlight(webContentsId: number): boolean {
  return startupState.recoveryReloadInFlight.matches(webContentsId, { consume: true })
}

export function recordAgentStateCrashBreadcrumb(agentType: string, state: string): void {
  recordCoalescedCrashBreadcrumb({
    name: 'agent_state_changed',
    data: { agentType, state },
    coalesceKey: `agent:${agentType}:${state}`,
    minIntervalMs: 30_000
  })
}
