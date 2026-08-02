// Concrete provider accounts pane view and orchestration.
// Provider sections keep provider-specific action and error flows local.
import { useEffect, useRef, useState } from 'react'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState,
  CodexSystemDefaultIdentity,
  GlobalSettings
} from '../../../../shared/types'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useAppStore } from '../../store'
import { toast } from 'sonner'
import {
  getAccountsClaudeSearchEntries,
  getAccountsCodexSearchEntries,
  getAccountsGeminiSearchEntries,
  getAccountsLocationSearchEntries,
  getAccountsGrokSearchEntries,
  getAccountsMiniMaxSearchEntries,
  getAccountsOpencodeSearchEntries,
  getAccountsPaneSearchEntries
} from './accounts-search'
import { getRemoteAccountsPaneScope } from './provider-account-scope'
import { ProviderHostScopeControl } from './ProviderHostScopeControl'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import {
  markLiveCodexSessionsForRestart,
  resolveCodexRestartPromptAccountLabel
} from '@/lib/codex-session-restart'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { getCodexAccountAuthWarning } from './codex-account-auth-warning'
import { getCodexConfigSyncWarning } from './codex-config-sync-warning'
import type { CodexConfigSyncStatus } from '../../../../shared/codex-config-sync-types'
import {
  getProviderAccountActiveIdForView,
  getProviderAccountRuntime,
  providerAccountIsActiveInView,
  providerAccountMatchesView,
  WSL_DEFAULT_DISTRO_KEY,
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
  selectClaudeProviderAccount,
  selectCodexProviderAccount,
  watchProviderAccounts
} from '@/runtime/runtime-provider-accounts-client'
import { AccountsProviderAccountSections } from './accounts-provider-account-sections'

export { getAccountsPaneSearchEntries }

import {
  formatMiniMaxRelativeRefresh,
  MiniMaxCookieHelpPopover,
  getHostRuntimeLabel,
  getCodexSystemDefaultSubtitle,
  getClaudeAccountLabel,
  getCodexAccountRuntimeLabel,
  getClaudeAccountRuntimeLabel,
  getCodexAccountErrorDescription,
  getClaudeAccountErrorDescription,
  isClaudeAccountCancellation,
  getSelectedAccountRuntime,
  EMPTY_WSL_DISTROS,
  MINIMAX_CONSOLE_URL,
  type LocalAccountRuntime
} from './accounts-pane-state'
export function AccountsPane({
  settings,
  updateSettings,
  wslSupportedPlatform = false,
  wslAvailable = false,
  wslDistros = EMPTY_WSL_DISTROS,
  wslCapabilitiesLoading = false,
  accountOwnerPlatform = null
}: AccountsPaneProps): React.JSX.Element {
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
  // Why: with a Remote Orca Server active the server owns provider accounts
  // (see #7973); every list/select/remove below must scope to it, not host/WSL.
  const isRemoteAccountScope = hasRemoteProviderAccountOwner(settings)
  const activeRuntimeEnvironmentId = settings.activeRuntimeEnvironmentId?.trim() || null
  // Why: keep the real name separate from the prose fallback below; the scope
  // label must not interpolate the fallback.
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
  // Why: host runtime labels are standalone UI labels; interpolated prose needs sentence casing.
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
  // Why: users read the remote-scoped list as their desktop accounts being
  // deleted (#8186); say they are intact and link the default-runtime control.
  // The web client has no desktop-owned accounts and cannot select Local
  // desktop, so promising a switch back would be a dead end there.
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
  // Why: capture the account's runtime slot when the dialog opens; the roster
  // can change underneath an open dialog and lose the slot to diff for restarts.
  const [removeCodexTarget, setRemoveCodexTarget] = useState<{
    id: string
    runtime: ProviderAccountRuntimeView
  } | null>(null)
  const [removeClaudeTarget, setRemoveClaudeTarget] = useState<{
    id: string
    runtime: ProviderAccountRuntimeView
  } | null>(null)
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
  // Why: System default lights only when no account row is active; while a remote
  // owner's platform is unknown WSL rows hide fail-closed, so check the full roster.
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
  // Why: the system default's real identity is host-scoped (it reflects the
  // runtime's own ~/.codex), so only surface it in the host view. Per-distro
  // WSL falls back to the generic label.
  const systemCodexIdentity =
    accountRuntime.runtime === 'host' ? codexAccounts.systemDefault : undefined
  // Why: remote snapshots own their system-default identity, but the desktop's
  // rate-limit poll must not be misattributed to a remote account owner.
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
  // Why: the mirror keeps serving the last synced settings when ~/.codex is
  // unusable, so without this the user only sees their edits being ignored.
  const [codexConfigSync, setCodexConfigSync] = useState<CodexConfigSyncStatus | null>(null)
  useEffect(() => {
    // Why: the status resolves the host's own ~/.codex and shared runtime home.
    // A WSL or remote scope mirrors different homes entirely, so showing it there
    // would name a config file that has nothing to do with the selected runtime.
    if (isRemoteAccountScope || accountRuntime.runtime !== 'host') {
      setCodexConfigSync(null)
      return
    }
    let cancelled = false
    void window.api.codexConfigSync
      .status()
      .then((status) => {
        if (!cancelled) {
          setCodexConfigSync(status)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCodexConfigSync(null)
        }
      })
    return () => {
      cancelled = true
    }
    // Why: the status resolves whichever home the ACTIVE selection mirrors into
    // (per-account, shared, or none for the real-home lane), so switching
    // accounts must refetch or the banner describes the previous account.
  }, [isRemoteAccountScope, accountRuntime.runtime, activeCodexAccountId, codexAccountsLoaded])
  const codexConfigSyncWarning = getCodexConfigSyncWarning(codexConfigSync)
  const systemCodexMissingSignIn = activeCodexAuthWarning === 'missing-sign-in'
  const systemCodexNeedsSignIn = activeCodexAccountId === null && Boolean(activeCodexAuthWarning)
  const accountRuntimeUnavailable =
    accountRuntime.runtime === 'wsl' && !wslAvailable && !wslCapabilitiesLoading

  const recordOpenCodeSettingEdit = (field: 'cookie' | 'workspaceId'): void => {
    if (recordedOpenCodeSettingEditsRef.current.has(field)) {
      return
    }
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
          translate(
            'auto.components.settings.AccountsPane.8e6f0cb1d8',
            'MiniMax cookie was not saved.'
          )
        )
      }
      setMiniMaxConfigured(status.configured)
      setMiniMaxCookieDraft('')
      recordFeatureInteraction('usage-tracking')
      toast.success(
        translate('auto.components.settings.AccountsPane.8d61637a77', 'MiniMax cookie saved.')
      )
    } catch (error) {
      toast.error(
        translate(
          'auto.components.settings.AccountsPane.b43e761fe5',
          'MiniMax cookie update failed.'
        ),
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
        translate(
          'auto.components.settings.AccountsPane.b43e761fe5',
          'MiniMax cookie update failed.'
        ),
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
    // Why: remote snapshots stream usage refreshes after the synchronous ready
    // message, so the watcher stays open for the pane's lifetime; the local
    // path resolves once and the close() is a no-op.
    const watcher = watchProviderAccounts(
      { activeRuntimeEnvironmentId },
      {
        onSnapshot: (snapshot) => {
          // Why: a failed provider's half is a substituted empty roster, not
          // authoritative data; keep prior state and leave the loaded gate shut.
          if (!snapshot.failedProviders?.includes('codex')) {
            setCodexAccounts(snapshot.codex)
            setCodexAccountsLoaded(true)
          }
          if (!snapshot.failedProviders?.includes('claude')) {
            setClaudeAccounts(snapshot.claude)
          }
        },
        onError: (error) => {
          toast.error(
            translate(
              'auto.components.settings.AccountsPane.loadAccountsFailed',
              'Could not load provider accounts.'
            ),
            {
              description: String((error as Error)?.message ?? error)
            }
          )
        }
      }
    )

    return () => {
      watcher.close()
    }
  }, [activeRuntimeEnvironmentId])

  const syncCodexAccounts = async (next: CodexRateLimitAccountsState): Promise<void> => {
    setCodexAccounts(next)
    setCodexAccountsLoaded(true)
    // Why: remote mutations never change local GlobalSettings account fields.
    if (!isRemoteAccountScope) {
      await fetchSettings()
    }
  }

  const syncClaudeAccounts = async (next: ClaudeRateLimitAccountsState): Promise<void> => {
    setClaudeAccounts(next)
    if (!isRemoteAccountScope) {
      await fetchSettings()
    }
  }

  const formatAccountTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const accountRuntimeControls = wslSupportedPlatform ? (
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
                ...(wslSupportedPlatform
                  ? [
                      {
                        value: 'wsl',
                        label: translate('auto.components.settings.AccountsPane.8619f9afa9', 'WSL'),
                        disabled: wslCapabilitiesLoading || !wslAvailable
                      } as const
                    ]
                  : [])
              ]}
            />
            {wslSupportedPlatform && accountRuntime.runtime === 'wsl' ? (
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
  ) : null

  // Why: remote Windows flattens host and WSL rows, so mutation follow-up must
  // compare the selected row's runtime slot instead of the forced host view.
  const runCodexAccountAction = async (
    action: typeof codexAction,
    operation: () => Promise<CodexRateLimitAccountsState>,
    actionRuntime: ProviderAccountRuntimeView = accountRuntime
  ): Promise<void> => {
    const previousActiveAccountId = getProviderAccountActiveIdForView(codexAccounts, actionRuntime)
    setCodexAction(action)
    try {
      const next = await operation()
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
        // Why: `add` creates the managed home against the machine's own distro,
        // so the slot it wrote is the created account's — not this row's, which
        // may still say "WSL default". Found by diffing the roster rather than
        // by the row's active id, which resolves to null once two distro slots
        // are filled and would send the notice to the wrong lane.
        const newAccounts =
          action === 'adding'
            ? next.accounts.filter(
                (account) => !codexAccounts.accounts.some((prior) => prior.id === account.id)
              )
            : []
        // Why exactly one: an unloaded prior roster makes every account look new,
        // and picking one of those would aim the notice at an unrelated lane.
        // Falling back to the row is the pre-existing behaviour, not a new risk.
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
          // Why: two accounts can share an email, so the labels alone cannot
          // tell the store whether this switch lands back on the launch account.
          previousAccountId: previousActiveAccountId ?? null,
          nextAccountId: nextActiveAccountId ?? null,
          // Why: the mutation wrote this row's slot only, so panes on any other
          // lane still launch under the account they already had.
          target: addedAccount ? getProviderAccountRuntime(addedAccount) : actionRuntime,
          // Why: clearing a distro-less WSL row nulls every distro slot at once.
          clearsEveryWslDistro: action === 'select:system'
        })
      }
    } catch (error) {
      toast.error(
        translate(
          'auto.components.settings.AccountsPane.5bf8764953',
          'Codex account update failed.'
        ),
        {
          description: getCodexAccountErrorDescription(error)
        }
      )
    } finally {
      setCodexAction('idle')
    }
  }

  const runClaudeAccountAction = async (
    action: typeof claudeAction,
    operation: () => Promise<ClaudeRateLimitAccountsState>,
    actionRuntime: ProviderAccountRuntimeView = accountRuntime
  ): Promise<void> => {
    const previousActiveAccountId = getProviderAccountActiveIdForView(claudeAccounts, actionRuntime)
    setClaudeAction(action)
    try {
      const next = await operation()
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
        toast.info(
          translate('auto.components.settings.AccountsPane.f921d32606', 'Claude account updated.'),
          {
            description: translate(
              'auto.components.settings.AccountsPane.b15ce90870',
              '{{value0}} -> {{value1}}. Restart live Claude terminals before continuing old sessions.',
              {
                value0: getClaudeAccountLabel(claudeAccounts, previousActiveAccountId),
                value1: getClaudeAccountLabel(next, nextActiveAccountId)
              }
            )
          }
        )
      }
    } catch (error) {
      if (isClaudeAccountCancellation(error)) {
        return
      }
      toast.error(
        translate(
          'auto.components.settings.AccountsPane.2743cdc0af',
          'Claude account update failed.'
        ),
        {
          description: getClaudeAccountErrorDescription(error)
        }
      )
    } finally {
      setClaudeAction('idle')
    }
  }

  const accountSectionsContext = {
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
    status,
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
    clearMiniMaxCookie,  }
  const visibleSections = <AccountsProviderAccountSections context={accountSectionsContext} />

  return (
    <div className="space-y-8">
      <Dialog
        open={removeCodexTarget !== null}
        onOpenChange={(open) => !open && setRemoveCodexTarget(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.AccountsPane.0d47394635',
                'Remove Codex Account?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.AccountsPane.380a7736cc',
                'Removing this account permanently deletes its managed Codex home, including all Codex session history and MCP logins stored inside. This cannot be undone. If the account is currently active, Orca falls back to the system default Codex login.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveCodexTarget(null)}>
              {translate('auto.components.settings.AccountsPane.dbb9626ed1', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removeCodexTarget
                if (!target) {
                  return
                }
                setRemoveCodexTarget(null)
                void runCodexAccountAction(
                  `remove:${target.id}`,
                  () => removeCodexProviderAccount(settings, target.id),
                  target.runtime
                )
              }}
            >
              {translate('auto.components.settings.AccountsPane.c2d2751587', 'Remove Account')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removeClaudeTarget !== null}
        onOpenChange={(open) => !open && setRemoveClaudeTarget(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.AccountsPane.63843e37e2',
                'Remove Claude Account?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.AccountsPane.854ebbcc45',
                'Orca will delete the managed Claude auth for this saved account. If it is currently active, Orca falls back to the system default Claude login.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveClaudeTarget(null)}>
              {translate('auto.components.settings.AccountsPane.dbb9626ed1', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removeClaudeTarget
                if (!target) {
                  return
                }
                setRemoveClaudeTarget(null)
                void runClaudeAccountAction(
                  `remove:${target.id}`,
                  () => removeClaudeProviderAccount(settings, target.id),
                  target.runtime
                )
              }}
            >
              {translate('auto.components.settings.AccountsPane.c2d2751587', 'Remove Account')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {visibleSections.map((section, index) => (
        <div key={index} className="space-y-8">
          {index > 0 ? <Separator /> : null}
          {section}
        </div>
      ))}
    </div>
  )
}
