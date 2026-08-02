// Stateful provider-account runtime: scope, subscriptions, credentials, and mutations.
import { useEffect, useRef, useState } from 'react'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState,
  GlobalSettings
} from '../../../../shared/types'
import type { CodexConfigSyncStatus } from '../../../../shared/codex-config-sync-types'
import { useAppStore } from '../../store'
import { toast } from 'sonner'
import { getRemoteAccountsPaneScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { getCodexAccountAuthWarning } from './codex-account-auth-warning'
import { getCodexConfigSyncWarning } from './codex-config-sync-warning'
import {
  getProviderAccountActiveIdForView,
  getProviderAccountRuntime,
  providerAccountIsActiveInView,
  providerAccountMatchesView,
  type ProviderAccountRuntimeView
} from './provider-account-visibility'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  emptyClaudeAccountsState,
  emptyCodexAccountsState,
  hasRemoteProviderAccountOwner,
  removeClaudeProviderAccount,
  removeCodexProviderAccount,
  watchProviderAccounts
} from '@/runtime/runtime-provider-accounts-client'
import {
  getClaudeAccountErrorDescription,
  getClaudeAccountLabel,
  getCodexAccountErrorDescription,
  getSelectedAccountRuntime,
  isClaudeAccountCancellation,
  EMPTY_WSL_DISTROS,
  type LocalAccountRuntime
} from './accounts-pane-state'
import { AccountsProviderAccountRuntimeControls } from './accounts-provider-account-runtime-controls'
import {
  markLiveCodexSessionsForRestart,
  resolveCodexRestartPromptAccountLabel
} from '@/lib/codex-session-restart'
import type { AccountRemovalTarget } from './accounts-provider-account-removal-dialogs'

export type AccountsPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  wslSupportedPlatform?: boolean
  wslAvailable?: boolean
  wslDistros?: string[]
  wslCapabilitiesLoading?: boolean
  accountOwnerPlatform?: NodeJS.Platform | null
}

export type AccountsProviderAccountRuntime = {
  settings: GlobalSettings
  accountSectionsContext: Record<string, unknown>
  removeCodexTarget: AccountRemovalTarget | null
  setRemoveCodexTarget: (target: AccountRemovalTarget | null) => void
  removeClaudeTarget: AccountRemovalTarget | null
  setRemoveClaudeTarget: (target: AccountRemovalTarget | null) => void
  runCodexAccountAction: (
    action: `remove:${string}`,
    operation: () => Promise<unknown>,
    runtime: ProviderAccountRuntimeView
  ) => Promise<void>
  runClaudeAccountAction: (
    action: `remove:${string}`,
    operation: () => Promise<unknown>,
    runtime: ProviderAccountRuntimeView
  ) => Promise<void>
  removeCodexProviderAccount: typeof removeCodexProviderAccount
  removeClaudeProviderAccount: typeof removeClaudeProviderAccount
}

export function useAccountsProviderAccountRuntime({
  settings,
  updateSettings,
  wslSupportedPlatform = false,
  wslAvailable = false,
  wslDistros = EMPTY_WSL_DISTROS,
  wslCapabilitiesLoading = false,
  accountOwnerPlatform = null
}: AccountsPaneProps): AccountsProviderAccountRuntime {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const codexRateLimits = useAppStore((s) => s.rateLimits.codex)
  const codexRateLimitTarget = useAppStore((s) => s.rateLimits.codexTarget)
  const miniMaxRateLimits = useAppStore((s) => s.rateLimits.minimax)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const recordedOpenCodeSettingEditsRef = useRef<Set<'cookie' | 'workspaceId'>>(new Set())
  const [miniMaxCookieDraft, setMiniMaxCookieDraft] = useState('')
  const [miniMaxConfigured, setMiniMaxConfigured] = useState(false)
  const [miniMaxCredentialBusy, setMiniMaxCredentialBusy] = useState(false)
  const localAccountRuntime = getSelectedAccountRuntime(
    settings,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading
  )
  const isRemoteAccountScope = hasRemoteProviderAccountOwner(settings)
  const activeRuntimeEnvironmentId = settings.activeRuntimeEnvironmentId?.trim() || null
  const remoteServerName = isRemoteAccountScope
    ? (runtimeEnvironments.find((environment) => environment.id === activeRuntimeEnvironmentId)
        ?.name ?? null)
    : null
  const remoteServerLabel = isRemoteAccountScope
    ? (remoteServerName ??
      translate('auto.components.settings.AccountsPane.remoteServerFallback', 'the remote server'))
    : null
  const accountRuntime: LocalAccountRuntime = isRemoteAccountScope
    ? { runtime: 'host', label: remoteServerLabel ?? '' }
    : localAccountRuntime
  const accountRuntimeSentenceLabel =
    !isRemoteAccountScope &&
    accountRuntime.runtime === 'host' &&
    !navigator.userAgent.includes('Windows')
      ? `${accountRuntime.label.charAt(0).toLocaleLowerCase()}${accountRuntime.label.slice(1)}`
      : accountRuntime.label
  const localAccountRuntimeSentenceLabel =
    localAccountRuntime.runtime === 'host' && !navigator.userAgent.includes('Windows')
      ? `${localAccountRuntime.label.charAt(0).toLocaleLowerCase()}${localAccountRuntime.label.slice(1)}`
      : localAccountRuntime.label
  const remoteAccountScopeNotice =
    isRemoteAccountScope && !isWebClientLocation() ? (
      <ProviderHostScopeControl
        labelPrefix={translate(
          'auto.components.settings.AccountsPane.accountScopePrefix',
          'Account scope'
        )}
        scope={getRemoteAccountsPaneScope(remoteServerName)}
        className="text-xs"
      />
    ) : null

  const [codexAccounts, setCodexAccounts] =
    useState<CodexRateLimitAccountsState>(emptyCodexAccountsState)
  const [codexAccountsLoaded, setCodexAccountsLoaded] = useState(false)
  const [codexAction, setCodexAction] = useState<
    'idle' | 'adding' | `reauth:${string}` | `remove:${string}` | `select:${string | 'system'}`
  >('idle')
  const [claudeAccounts, setClaudeAccounts] =
    useState<ClaudeRateLimitAccountsState>(emptyClaudeAccountsState)
  const [claudeAction, setClaudeAction] = useState<
    'idle' | 'adding' | `reauth:${string}` | `remove:${string}` | `select:${string | 'system'}`
  >('idle')
  const [removeCodexTarget, setRemoveCodexTarget] = useState<AccountRemovalTarget | null>(null)
  const [removeClaudeTarget, setRemoveClaudeTarget] = useState<AccountRemovalTarget | null>(null)
  const accountVisibilityOptions = {
    remoteOwner: isRemoteAccountScope,
    ownerPlatform: accountOwnerPlatform
  }
  const visibleClaudeAccounts = claudeAccounts.accounts.filter((account) =>
    providerAccountMatchesView(account, accountRuntime, accountVisibilityOptions)
  )
  const visibleCodexAccounts = codexAccounts.accounts.filter((account) =>
    providerAccountMatchesView(account, accountRuntime, accountVisibilityOptions)
  )
  const activeCodexAccountId = getProviderAccountActiveIdForView(codexAccounts, accountRuntime)
  const ownerPlatformUnknown = isRemoteAccountScope && accountOwnerPlatform === null
  const systemCodexActive = !(
    ownerPlatformUnknown ? codexAccounts.accounts : visibleCodexAccounts
  ).some((account) =>
    providerAccountIsActiveInView(account, codexAccounts, accountRuntime, accountVisibilityOptions)
  )
  const systemClaudeActive = !(
    ownerPlatformUnknown ? claudeAccounts.accounts : visibleClaudeAccounts
  ).some((account) =>
    providerAccountIsActiveInView(account, claudeAccounts, accountRuntime, accountVisibilityOptions)
  )
  const systemCodexIdentity =
    accountRuntime.runtime === 'host' ? codexAccounts.systemDefault : undefined
  const activeCodexAuthWarning = codexAccountsLoaded
    ? getCodexAccountAuthWarning({
        limits: isRemoteAccountScope ? null : codexRateLimits,
        target: codexRateLimitTarget,
        runtime: accountRuntime,
        activeAccountId: activeCodexAccountId,
        accountId: activeCodexAccountId,
        authKind: activeCodexAccountId === null ? systemCodexIdentity?.authKind : undefined
      })
    : null
  const [codexConfigSync, setCodexConfigSync] = useState<CodexConfigSyncStatus | null>(null)

  useEffect(() => {
    if (isRemoteAccountScope || accountRuntime.runtime !== 'host') {
      setCodexConfigSync(null)
      return
    }
    let cancelled = false
    void window.api.codexConfigSync
      .status()
      .then((status) => {
        if (!cancelled) setCodexConfigSync(status)
      })
      .catch(() => {
        if (!cancelled) setCodexConfigSync(null)
      })
    return () => {
      cancelled = true
    }
  }, [isRemoteAccountScope, accountRuntime.runtime, activeCodexAccountId, codexAccountsLoaded])

  const codexConfigSyncWarning = getCodexConfigSyncWarning(codexConfigSync)
  const systemCodexMissingSignIn = activeCodexAuthWarning === 'missing-sign-in'
  const systemCodexNeedsSignIn = activeCodexAccountId === null && Boolean(activeCodexAuthWarning)
  const accountRuntimeUnavailable =
    accountRuntime.runtime === 'wsl' && !wslAvailable && !wslCapabilitiesLoading

  const recordOpenCodeSettingEdit = (field: 'cookie' | 'workspaceId'): void => {
    if (recordedOpenCodeSettingEditsRef.current.has(field)) return
    recordedOpenCodeSettingEditsRef.current.add(field)
    recordFeatureInteraction('usage-tracking')
  }

  const refreshMiniMaxCredentialStatus = async (): Promise<void> => {
    try {
      const status = await window.api.minimaxCredentials.getStatus()
      setMiniMaxConfigured(status.configured)
    } catch (error) {
      console.error('Failed to load MiniMax credential status:', error)
    }
  }

  const saveMiniMaxCookie = async (): Promise<void> => {
    if (!miniMaxCookieDraft.trim()) {
      toast.error(
        translate('auto.components.settings.AccountsPane.2f24f244a4', 'MiniMax cookie is required.')
      )
      return
    }
    setMiniMaxCredentialBusy(true)
    try {
      const status = await window.api.minimaxCredentials.saveCookie(miniMaxCookieDraft.trim())
      if (!status.configured) {
        throw new Error(
          translate('auto.components.settings.AccountsPane.8e6f0cb1d8', 'MiniMax cookie was not saved.')
        )
      }
      setMiniMaxConfigured(status.configured)
      setMiniMaxCookieDraft('')
      recordFeatureInteraction('usage-tracking')
      toast.success(translate('auto.components.settings.AccountsPane.8d61637a77', 'MiniMax cookie saved.'))
    } catch (error) {
      toast.error(
        translate('auto.components.settings.AccountsPane.b43e761fe5', 'MiniMax cookie update failed.'),
        { description: String((error as Error)?.message ?? error) }
      )
    } finally {
      setMiniMaxCredentialBusy(false)
    }
  }

  const clearMiniMaxCookie = async (): Promise<void> => {
    setMiniMaxCredentialBusy(true)
    try {
      const status = await window.api.minimaxCredentials.clearCookie()
      setMiniMaxConfigured(status.configured)
      setMiniMaxCookieDraft('')
      recordFeatureInteraction('usage-tracking')
    } catch (error) {
      toast.error(
        translate('auto.components.settings.AccountsPane.b43e761fe5', 'MiniMax cookie update failed.'),
        { description: String((error as Error)?.message ?? error) }
      )
    } finally {
      setMiniMaxCredentialBusy(false)
    }
  }

  useEffect(() => {
    void refreshMiniMaxCredentialStatus()
  }, [])

  useEffect(() => {
    const watcher = watchProviderAccounts(
      { activeRuntimeEnvironmentId },
      {
        onSnapshot: (snapshot) => {
          if (!snapshot.failedProviders?.includes('codex')) {
            setCodexAccounts(snapshot.codex)
            setCodexAccountsLoaded(true)
          }
          if (!snapshot.failedProviders?.includes('claude')) {
            setClaudeAccounts(snapshot.claude)
          }
        },
        onError: (error) => {
          toast.error(translate('auto.components.settings.AccountsPane.loadAccountsFailed', 'Could not load provider accounts.'), {
            description: String((error as Error)?.message ?? error)
          })
        }
      }
    )
    return () => watcher.close()
  }, [activeRuntimeEnvironmentId])

  const syncCodexAccounts = async (next: CodexRateLimitAccountsState): Promise<void> => {
    setCodexAccounts(next)
    setCodexAccountsLoaded(true)
    if (!isRemoteAccountScope) await fetchSettings()
  }

  const syncClaudeAccounts = async (next: ClaudeRateLimitAccountsState): Promise<void> => {
    setClaudeAccounts(next)
    if (!isRemoteAccountScope) await fetchSettings()
  }

  const formatAccountTimestamp = (timestamp: number): string =>
    new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })

  const accountRuntimeControls = (
    <AccountsProviderAccountRuntimeControls
      wslSupportedPlatform={wslSupportedPlatform}
      wslAvailable={wslAvailable}
      wslDistros={wslDistros}
      wslCapabilitiesLoading={wslCapabilitiesLoading}
      accountRuntime={accountRuntime}
      updateSettings={updateSettings}
    />
  )

  const runCodexAccountAction = async (
    action: typeof codexAction,
    operation: () => Promise<unknown>,
    actionRuntime: ProviderAccountRuntimeView = accountRuntime
  ): Promise<void> => {
    const previousActiveAccountId = getProviderAccountActiveIdForView(codexAccounts, actionRuntime)
    setCodexAction(action)
    try {
      const next = (await operation()) as CodexRateLimitAccountsState
      await syncCodexAccounts(next)
      recordFeatureInteraction('codex-account-switching')
      const nextActiveAccountId = getProviderAccountActiveIdForView(next, actionRuntime)
      const shouldPromptRestart =
        action === 'adding' ||
        (action.startsWith('select:') && previousActiveAccountId !== nextActiveAccountId) ||
        (action.startsWith('reauth:') &&
          nextActiveAccountId !== null &&
          action === `reauth:${nextActiveAccountId}`) ||
        (action.startsWith('remove:') && previousActiveAccountId !== nextActiveAccountId)
      if (shouldPromptRestart) {
        const newAccounts =
          action === 'adding'
            ? next.accounts.filter(
                (account) => !codexAccounts.accounts.some((prior) => prior.id === account.id)
              )
            : []
        const addedAccount = newAccounts.length === 1 ? newAccounts[0] : undefined
        void markLiveCodexSessionsForRestart({
          previousAccountLabel: resolveCodexRestartPromptAccountLabel(
            codexAccounts.accounts,
            previousActiveAccountId
          ),
          nextAccountLabel: resolveCodexRestartPromptAccountLabel(
            next.accounts,
            nextActiveAccountId
          ),
          previousAccountId: previousActiveAccountId ?? null,
          nextAccountId: nextActiveAccountId ?? null,
          target: addedAccount ? getProviderAccountRuntime(addedAccount) : actionRuntime,
          clearsEveryWslDistro: action === 'select:system'
        })
      }
    } catch (error) {
      toast.error(translate('auto.components.settings.AccountsPane.5bf8764953', 'Codex account update failed.'), {
        description: getCodexAccountErrorDescription(error)
      })
    } finally {
      setCodexAction('idle')
    }
  }

  const runClaudeAccountAction = async (
    action: typeof claudeAction,
    operation: () => Promise<unknown>,
    actionRuntime: ProviderAccountRuntimeView = accountRuntime
  ): Promise<void> => {
    const previousActiveAccountId = getProviderAccountActiveIdForView(claudeAccounts, actionRuntime)
    setClaudeAction(action)
    try {
      const next = (await operation()) as ClaudeRateLimitAccountsState
      await syncClaudeAccounts(next)
      recordFeatureInteraction('claude-account-switching')
      const nextActiveAccountId = getProviderAccountActiveIdForView(next, actionRuntime)
      const shouldPromptRestart =
        action === 'adding' ||
        previousActiveAccountId !== nextActiveAccountId ||
        (action.startsWith('reauth:') &&
          nextActiveAccountId !== null &&
          action === `reauth:${nextActiveAccountId}`)
      if (shouldPromptRestart) {
        toast.info(translate('auto.components.settings.AccountsPane.f921d32606', 'Claude account updated.'), {
          description: translate(
            'auto.components.settings.AccountsPane.b15ce90870',
            '{{value0}} -> {{value1}}. Restart live Claude terminals before continuing old sessions.',
            {
              value0: getClaudeAccountLabel(claudeAccounts, previousActiveAccountId),
              value1: getClaudeAccountLabel(next, nextActiveAccountId)
            }
          )
        })
      }
    } catch (error) {
      if (isClaudeAccountCancellation(error)) return
      toast.error(translate('auto.components.settings.AccountsPane.2743cdc0af', 'Claude account update failed.'), {
        description: getClaudeAccountErrorDescription(error)
      })
    } finally {
      setClaudeAction('idle')
    }
  }

  const accountSectionsContext = {
    settings,
    updateSettings,
    wslSupportedPlatform,
    wslCapabilitiesLoading,
    searchQuery,
    isRemoteAccountScope,
    accountRuntimeControls,
    accountRuntime,
    accountRuntimeSentenceLabel,
    remoteAccountScopeNotice,
    claudeAccounts,
    claudeAction,
    setRemoveClaudeTarget,
    accountVisibilityOptions,
    visibleClaudeAccounts,
    systemClaudeActive,
    accountRuntimeUnavailable,
    formatAccountTimestamp,
    runClaudeAccountAction,
    codexRateLimits,
    codexRateLimitTarget,
    codexAccounts,
    codexAction,
    setRemoveCodexTarget,
    visibleCodexAccounts,
    activeCodexAccountId,
    systemCodexActive,
    systemCodexIdentity,
    activeCodexAuthWarning,
    codexConfigSync,
    codexConfigSyncWarning,
    systemCodexMissingSignIn,
    systemCodexNeedsSignIn,
    runCodexAccountAction,
    miniMaxRateLimits,
    recordFeatureInteraction,
    miniMaxCookieDraft,
    setMiniMaxCookieDraft,
    miniMaxConfigured,
    miniMaxCredentialBusy,
    localAccountRuntimeSentenceLabel,
    recordOpenCodeSettingEdit,
    saveMiniMaxCookie,
    clearMiniMaxCookie
  }

  return {
    settings,
    accountSectionsContext,
    removeCodexTarget,
    setRemoveCodexTarget,
    removeClaudeTarget,
    setRemoveClaudeTarget,
    runCodexAccountAction,
    runClaudeAccountAction,
    removeCodexProviderAccount,
    removeClaudeProviderAccount
  }
}
