// Concrete Codex account section.
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import {
  AlertTriangle,
  ExternalLink,
  HelpCircle,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import {
  ClaudeIcon,
  GeminiIcon,
  MiniMaxIcon,
  OpenAIIcon,
  OpenCodeGoIcon
} from '../status-bar/icons'
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
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { getCodexAccountAuthWarning } from './codex-account-auth-warning'
import {
  getProviderAccountActiveIdForView,
  getProviderAccountRuntime,
  providerAccountIsActiveInView,
  providerAccountMatchesView,
  WSL_DEFAULT_DISTRO_KEY,
  type ProviderAccountRuntimeView
} from './provider-account-visibility'
import { translate } from '@/i18n/i18n'
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


export function AccountsProviderCodexSection({ context }: { context: Record<string, any> }): React.JSX.Element | null {
  const {
    searchQuery,
    codexRateLimits,
    codexRateLimitTarget,
    isRemoteAccountScope,
    accountRuntime,
    accountRuntimeSentenceLabel,
    remoteAccountScopeNotice,
    codexAccounts,
    codexAction,
    setRemoveCodexTarget,
    accountVisibilityOptions,
    visibleCodexAccounts,
    activeCodexAccountId,
    systemCodexActive,
    systemCodexIdentity,
    activeCodexAuthWarning,
    codexConfigSync,
    codexConfigSyncWarning,
    systemCodexMissingSignIn,
    systemCodexNeedsSignIn,
    accountRuntimeUnavailable,
    status,
    formatAccountTimestamp,
    runCodexAccountAction,
  } = context
  return (
  matchesSettingsSearch(searchQuery, getAccountsCodexSearchEntries()) ? (
        <section key="codex-accounts" id="accounts-codex" className="space-y-4 scroll-mt-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <OpenAIIcon size={16} />
              {translate('auto.components.settings.AccountsPane.ef91cfa06b', 'Codex')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.cedfab35ab',
                'Optional. Orca can use your normal Codex login; add accounts only if you want quick switching in Orca.'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {isRemoteAccountScope
                ? translate(
                    'auto.components.settings.AccountsPane.remoteScopeAuthContext',
                    'Each account keeps its own sign-in context on {{value0}}.',
                    { value0: accountRuntimeSentenceLabel }
                  )
                : translate(
                    'auto.components.settings.AccountsPane.340d6f7a85',
                    'Each account keeps its own local sign-in context in Orca. Account auth stays on this device.'
                  )}
            </p>
          </div>

          <SearchableSetting
            title={translate('auto.components.settings.AccountsPane.3180536c7a', 'Codex Accounts')}
            description={translate(
              'auto.components.settings.AccountsPane.d0d53b7eb0',
              'Manage which Codex account Orca uses for live rate limit fetching.'
            )}
            // Why: this single SearchableSetting backs the whole Codex section,
            // including the "Active Codex Account" sub-control (account picker
            // below). Roll every Codex search entry's title/description/keywords
            // into one haystack so a search for "Active Codex Account" doesn't
            // render the section header with no body underneath it.
            keywords={getAccountsCodexSearchEntries().flatMap((entry) => [
              entry.title,
              entry.description ?? '',
              ...(entry.keywords ?? [])
            ])}
            className="space-y-3 py-2"
          >
            {/* Why: Settings deep-links can target this subsection directly from
            the status-bar account switcher. Keeping a stable DOM anchor here
            avoids dumping the user at the top of Accounts and making them hunt
            for the actual Codex account controls. */}
            {activeCodexAuthWarning ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {systemCodexMissingSignIn
                    ? translate(
                        'auto.components.settings.AccountsPane.codexSystemDefaultNeedsSignIn',
                        'No Codex sign-in was found for {{value0}}.',
                        { value0: accountRuntimeSentenceLabel }
                      )
                    : activeCodexAccountId
                      ? translate(
                          'auto.components.settings.AccountsPane.75ca9b718e',
                          'Codex reported that the active account needs a fresh sign-in. Re-authenticate it before starting new Codex sessions.'
                        )
                      : translate(
                          'auto.components.settings.AccountsPane.e4a28e8894',
                          'Codex reported that the {{value0}} login needs a fresh sign-in. Sign in again before starting new Codex sessions.',
                          { value0: accountRuntimeSentenceLabel }
                        )}
                </span>
              </div>
            ) : null}
            {codexConfigSyncWarning ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {codexConfigSyncWarning === 'missing-source'
                    ? translate(
                        'auto.components.settings.AccountsPane.codexConfigSyncMissingSource',
                        'Codex is still using the settings it last synced because {{value0}} is missing. Restore that file to resume syncing.',
                        { value0: codexConfigSync?.systemConfigPath ?? '' }
                      )
                    : codexConfigSyncWarning === 'blank-source'
                      ? translate(
                          'auto.components.settings.AccountsPane.codexConfigSyncBlankSource',
                          'Codex is still using the settings it last synced because {{value0}} is empty. That is expected while a synced folder finishes downloading.',
                          { value0: codexConfigSync?.systemConfigPath ?? '' }
                        )
                      : translate(
                          'auto.components.settings.AccountsPane.codexConfigSyncUnreadableSource',
                          "Codex is still using the settings it last synced because {{value0}} could not be read. Check that file's permissions.",
                          { value0: codexConfigSync?.systemConfigPath ?? '' }
                        )}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label>
                  {translate('auto.components.settings.AccountsPane.94d351af4a', 'Accounts')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {isRemoteAccountScope
                    ? translate(
                        'auto.components.settings.AccountsPane.remoteScopeAccounts',
                        'Showing accounts managed by {{value0}}. Add or re-authenticate accounts on that server.',
                        { value0: accountRuntimeSentenceLabel }
                      )
                    : translate(
                        'auto.components.settings.AccountsPane.c0a52abfc5',
                        'Showing accounts for {{value0}}. New accounts are added there.',
                        { value0: accountRuntimeSentenceLabel }
                      )}
                </p>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  void runCodexAccountAction('adding', () =>
                    window.api.codexAccounts.add({
                      runtime: accountRuntime.runtime,
                      wslDistro: accountRuntime.wslDistro
                    })
                  )
                }
                disabled={
                  // Why: interactive `codex login` needs a desktop browser and
                  // would authenticate against this device, not the server.
                  isRemoteAccountScope ||
                  codexAction !== 'idle' ||
                  wslCapabilitiesLoading ||
                  accountRuntimeUnavailable
                }
                className="gap-1.5"
              >
                {codexAction === 'adding' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Plus className="size-3" />
                )}
                {translate('auto.components.settings.AccountsPane.b0e948a4f9', 'Add Account')}
              </Button>
            </div>
            {remoteAccountScopeNotice}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  void runCodexAccountAction('select:system', () =>
                    selectCodexProviderAccount(settings, {
                      accountId: null,
                      runtime: accountRuntime.runtime,
                      wslDistro: accountRuntime.wslDistro
                    })
                  )
                }
                disabled={codexAction !== 'idle' || accountRuntimeUnavailable}
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                  systemCodexNeedsSignIn
                    ? 'border-destructive/50 bg-destructive/5'
                    : systemCodexActive
                      ? 'border-foreground/20 bg-accent/15'
                      : 'border-border/70 hover:border-border hover:bg-accent/8'
                } disabled:cursor-default disabled:opacity-100`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {translate(
                        'auto.components.settings.AccountsPane.f2a265f8c7',
                        'System default'
                      )}
                    </span>
                    {systemCodexActive ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none text-foreground/80"
                      >
                        {translate('auto.components.settings.AccountsPane.e74831fb6b', 'Active')}
                      </Badge>
                    ) : null}
                    {systemCodexNeedsSignIn ? (
                      <Badge
                        variant="destructive"
                        className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none"
                      >
                        {translate(
                          'auto.components.settings.AccountsPane.93c47b333a',
                          'Needs sign-in'
                        )}
                      </Badge>
                    ) : null}
                  </div>
                  <span
                    className={`truncate text-[11px] ${
                      systemCodexNeedsSignIn ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  >
                    {systemCodexNeedsSignIn
                      ? systemCodexMissingSignIn
                        ? translate(
                            'auto.components.settings.AccountsPane.codexSystemDefaultNeedsSignIn',
                            'No Codex sign-in was found for {{value0}}.',
                            { value0: accountRuntimeSentenceLabel }
                          )
                        : translate(
                            'auto.components.settings.AccountsPane.fd62f37c24',
                            'Codex reported this {{value0}} login is out of date.',
                            { value0: accountRuntimeSentenceLabel }
                          )
                      : getCodexSystemDefaultSubtitle(
                          systemCodexIdentity,
                          accountRuntimeSentenceLabel
                        )}
                  </span>
                </div>
              </button>
              {visibleCodexAccounts.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
                  {isRemoteAccountScope
                    ? translate(
                        'auto.components.settings.AccountsPane.remoteEmptyCodexAccounts',
                        'No managed Codex accounts on {{value0}}. It uses its system default Codex login; add accounts on that server.',
                        { value0: accountRuntimeSentenceLabel }
                      )
                    : translate(
                        'auto.components.settings.AccountsPane.b4c9450319',
                        "No managed Codex accounts for {{value0}}. Orca will use that environment's system default Codex login until you add one here.",
                        { value0: accountRuntimeSentenceLabel }
                      )}
                </div>
              ) : (
                visibleCodexAccounts.map((account) => {
                  const isActive = providerAccountIsActiveInView(
                    account,
                    codexAccounts,
                    accountRuntime,
                    accountVisibilityOptions
                  )
                  // Why: same remote gate as the section-level warning — the
                  // desktop's rate-limit poll says nothing about server accounts.
                  const accountAuthWarning = isRemoteAccountScope
                    ? null
                    : getCodexAccountAuthWarning({
                        limits: codexRateLimits,
                        target: codexRateLimitTarget,
                        runtime: accountRuntime,
                        activeAccountId: activeCodexAccountId,
                        accountId: account.id
                      })
                  const needsReauthentication = Boolean(accountAuthWarning)
                  const isReauthing = codexAction === `reauth:${account.id}`
                  const isRemoving = codexAction === `remove:${account.id}`
                  const isBusy = codexAction !== 'idle' || accountRuntimeUnavailable

                  return (
                    <div
                      key={account.id}
                      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                        needsReauthentication
                          ? 'border-destructive/50 bg-destructive/5'
                          : isActive
                            ? 'border-foreground/20 bg-accent/15'
                            : 'border-border/70 hover:border-border hover:bg-accent/8'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-3 max-md:flex-col max-md:items-start">
                        <button
                          type="button"
                          onClick={() => {
                            const accountRuntimeView = getProviderAccountRuntime(account)
                            void runCodexAccountAction(
                              `select:${account.id}`,
                              () =>
                                selectCodexProviderAccount(settings, {
                                  accountId: account.id,
                                  ...accountRuntimeView
                                }),
                              accountRuntimeView
                            )
                          }}
                          disabled={isBusy}
                          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:cursor-default"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{account.email}</span>
                            <Badge
                              variant="outline"
                              className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none text-foreground/70"
                            >
                              {getCodexAccountRuntimeLabel(account, accountRuntime.label)}
                            </Badge>
                            {isActive ? (
                              <Badge
                                variant="outline"
                                className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none text-foreground/80"
                              >
                                {translate(
                                  'auto.components.settings.AccountsPane.e74831fb6b',
                                  'Active'
                                )}
                              </Badge>
                            ) : null}
                            {needsReauthentication ? (
                              <Badge
                                variant="destructive"
                                className="h-4 shrink-0 rounded px-1.5 text-[10px] font-medium leading-none"
                              >
                                {translate(
                                  'auto.components.settings.AccountsPane.589eba1eee',
                                  'Needs re-auth'
                                )}
                              </Badge>
                            ) : null}
                          </div>
                          <div
                            className={`flex min-w-0 items-center gap-1.5 text-[11px] max-sm:flex-wrap ${
                              needsReauthentication ? 'text-destructive' : 'text-muted-foreground'
                            }`}
                          >
                            {needsReauthentication ? (
                              <span className="truncate">
                                {translate(
                                  'auto.components.settings.AccountsPane.3d245ef7d9',
                                  'Codex reported this sign-in is out of date'
                                )}
                              </span>
                            ) : account.workspaceLabel ? (
                              <span className="truncate">{account.workspaceLabel}</span>
                            ) : null}
                            {needsReauthentication || account.workspaceLabel ? (
                              <span className="shrink-0 opacity-50">•</span>
                            ) : null}
                            <span className="shrink-0">
                              {formatAccountTimestamp(account.lastAuthenticatedAt)}
                            </span>
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center justify-end gap-1 max-md:w-full max-md:flex-wrap">
                          {/* Why: selecting an account is the primary action in this row.
                          Keeping maintenance actions visually lighter prevents re-auth/remove
                          controls from overpowering the selection affordance in a dense list. */}
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={(event) => {
                              event.stopPropagation()
                              void runCodexAccountAction(
                                `reauth:${account.id}`,
                                () =>
                                  window.api.codexAccounts.reauthenticate({
                                    accountId: account.id
                                  }),
                                getProviderAccountRuntime(account)
                              )
                            }}
                            disabled={isRemoteAccountScope || isBusy}
                            className="h-6 px-2 text-muted-foreground hover:text-foreground"
                          >
                            {isReauthing ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3" />
                            )}
                            {translate(
                              'auto.components.settings.AccountsPane.8a0f870153',
                              'Re-authenticate'
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={(event) => {
                              event.stopPropagation()
                              setRemoveCodexTarget({
                                id: account.id,
                                runtime: getProviderAccountRuntime(account)
                              })
                            }}
                            disabled={isBusy}
                            className="h-6 px-2 text-muted-foreground hover:text-destructive"
                          >
                            {isRemoving ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" />
                            )}
                            {translate('auto.components.settings.AccountsPane.db209ee572', 'Remove')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </SearchableSetting>
        </section>
      ) : null
  )
}
