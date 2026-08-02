// Concrete provider credential sections.
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
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
import { GrokAccountsSection } from './GrokAccountsSection'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'


export function AccountsProviderCredentialSections({ context }: { context: Record<string, any> }): React.JSX.Element[] {
  const {
    searchQuery,
    miniMaxRateLimits,
    recordFeatureInteraction,
    miniMaxCookieDraft,
    setMiniMaxCookieDraft,
    miniMaxConfigured,
    miniMaxCredentialBusy,
    localAccountRuntimeSentenceLabel,
    recordOpenCodeSettingEdit,
    status,
    saveMiniMaxCookie,
    clearMiniMaxCookie,
  } = context
  return [
    matchesSettingsSearch(searchQuery, getAccountsGeminiSearchEntries()) ? (
        <section key="gemini" id="accounts-gemini" className="space-y-4 scroll-mt-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <GeminiIcon size={16} />
              {translate('auto.components.settings.AccountsPane.0c64dc2a64', 'Gemini')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.973741a871',
                'Configure Gemini provider settings.'
              )}
            </p>
          </div>

          <SearchableSetting
            title={translate(
              'auto.components.settings.AccountsPane.0c7f915b01',
              'Use Gemini CLI credentials'
            )}
            description={translate(
              'auto.components.settings.AccountsPane.d676c41fc6',
              'Extracts OAuth credentials from your local Gemini CLI installation to authenticate with Google. This uses credentials issued to the Gemini CLI app, not Orca. May break if Google updates the CLI. Use at your own risk.'
            )}
            keywords={[
              'gemini',
              'cli',
              'oauth',
              'credentials',
              'experimental',
              'rate limit',
              'status bar'
            ]}
            className="flex items-center justify-between gap-4 py-2"
          >
            <div className="space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.AccountsPane.96f3649526',
                  'Use Gemini CLI credentials (experimental)'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.AccountsPane.c2aee76420',
                  'Extracts OAuth credentials from your local Gemini CLI installation to authenticate with Google for {{value0}}. This uses credentials issued to the Gemini CLI app, not Orca. May break if Google updates the CLI. Use at your own risk.',
                  { value0: localAccountRuntimeSentenceLabel }
                )}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.geminiCliOAuthEnabled}
              onClick={() => {
                recordFeatureInteraction('usage-tracking')
                updateSettings({
                  geminiCliOAuthEnabled: !settings.geminiCliOAuthEnabled
                })
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
                settings.geminiCliOAuthEnabled ? 'bg-foreground' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
                  settings.geminiCliOAuthEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </SearchableSetting>
        </section>
      ) : null,
  matchesSettingsSearch(searchQuery, getAccountsOpencodeSearchEntries()) ? (
        <section key="opencode-go" id="accounts-opencode-go" className="space-y-4 scroll-mt-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <OpenCodeGoIcon size={16} />
              {translate('auto.components.settings.AccountsPane.4ac10b4d08', 'OpenCode Go')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.ea631977b5',
                'Configure OpenCode Go provider settings.'
              )}
            </p>
          </div>

          <SearchableSetting
            title={translate(
              'auto.components.settings.AccountsPane.36223200ac',
              'OpenCode Go Session Cookie'
            )}
            description={translate(
              'auto.components.settings.AccountsPane.b2b1aa936d',
              'Paste your opencode.ai session cookie for rate limit fetching.'
            )}
            keywords={['opencode', 'cookie', 'session', 'rate limit', 'status bar']}
            className="space-y-2"
          >
            <Label>
              {translate(
                'auto.components.settings.AccountsPane.67e3c33670',
                'OpenCode Go session cookie'
              )}
            </Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={settings.opencodeSessionCookie}
                onChange={(e) => {
                  recordOpenCodeSettingEdit('cookie')
                  updateSettings({ opencodeSessionCookie: e.target.value })
                }}
                placeholder={translate(
                  'auto.components.settings.AccountsPane.a7e38affcd',
                  'Fe26.2**… token or auth=Fe26.2**… header'
                )}
                spellCheck={false}
                className="flex-1 text-xs"
              />
              {settings.opencodeSessionCookie && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    recordFeatureInteraction('usage-tracking')
                    updateSettings({ opencodeSessionCookie: '' })
                  }}
                  className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  {translate('auto.components.settings.AccountsPane.b398b834c9', 'Clear')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.0023cc336e',
                'Paste either the raw token value (e.g.'
              )}{' '}
              <code className="text-xs">
                {translate('auto.components.settings.AccountsPane.922b51e02d', 'Fe26.2**…')}
              </code>
              {translate(
                'auto.components.settings.AccountsPane.338820326a',
                ') or the full cookie header (e.g.'
              )}{' '}
              <code className="text-xs">
                {translate('auto.components.settings.AccountsPane.8951c5309f', 'auth=Fe26.2**…')}
              </code>
              {translate(
                'auto.components.settings.AccountsPane.7ce0e1907c',
                "). Find it in your browser's DevTools → Network → any opencode.ai request → Cookie header. OpenCode Go auth is web-based and shared across Windows and WSL terminals."
              )}
            </p>
          </SearchableSetting>

          <SearchableSetting
            title={translate(
              'auto.components.settings.AccountsPane.02cb127710',
              'OpenCode Go Workspace ID'
            )}
            description={translate(
              'auto.components.settings.AccountsPane.d70a5287a4',
              'Optional workspace ID override if the automatic lookup fails.'
            )}
            keywords={['opencode', 'workspace', 'id', 'wrk', 'rate limit', 'status bar']}
            className="space-y-2"
          >
            <Label>
              {translate('auto.components.settings.AccountsPane.dbdb0b0bd8', 'Workspace ID override')}
            </Label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={settings.opencodeWorkspaceId}
                onChange={(e) => {
                  recordOpenCodeSettingEdit('workspaceId')
                  updateSettings({ opencodeWorkspaceId: e.target.value })
                }}
                placeholder={translate(
                  'auto.components.settings.AccountsPane.a122332371',
                  'wrk_… (leave blank for automatic lookup)'
                )}
                spellCheck={false}
                className="flex-1 text-xs"
              />
              {settings.opencodeWorkspaceId && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    recordFeatureInteraction('usage-tracking')
                    updateSettings({ opencodeWorkspaceId: '' })
                  }}
                  className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  {translate('auto.components.settings.AccountsPane.b398b834c9', 'Clear')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.51c9104e13',
                'Find this in the URL after logging into opencode.ai (e.g.'
              )}{' '}
              <code className="text-xs">
                {translate(
                  'auto.components.settings.AccountsPane.ae3b21eb6c',
                  'opencode.ai/workspace/wrk_…/go'
                )}
              </code>
              ).
            </p>
          </SearchableSetting>
        </section>
      ) : null,
  matchesSettingsSearch(searchQuery, getAccountsMiniMaxSearchEntries()) ? (
        <section key="minimax" id="accounts-minimax" className="space-y-4 scroll-mt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <MiniMaxIcon size={16} />
                {translate('auto.components.settings.AccountsPane.5d63bbfbec', 'MiniMax')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.AccountsPane.15e831350e',
                  'Configure MiniMax usage tracking from platform.minimax.io.'
                )}
              </p>
            </div>
            <a
              href={MINIMAX_CONSOLE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {translate('auto.components.settings.AccountsPane.0d8e77bc40', 'Open console')}
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-muted/20 p-3',
              miniMaxConfigured ? 'border-border/60' : 'border-border/40'
            )}
          >
            <ShieldCheck
              className={cn(
                'mt-0.5 size-4 shrink-0',
                miniMaxConfigured ? 'text-foreground' : 'text-muted-foreground'
              )}
            />
            <div className="space-y-0.5">
              <p className="text-xs font-medium">
                {miniMaxConfigured
                  ? translate('auto.components.settings.AccountsPane.0b8c1c7e02', 'Stored locally')
                  : translate('auto.components.settings.AccountsPane.1fd1b1b6b4', 'Cookie not set')}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.AccountsPane.5e08b0fe57',
                  'Stored locally and sent only to platform.minimax.io for usage refreshes.'
                )}
              </p>
            </div>
          </div>

          <SearchableSetting
            title={translate(
              'auto.components.settings.AccountsPane.21d6eb141e',
              'MiniMax Session Cookie'
            )}
            description={translate(
              'auto.components.settings.AccountsPane.33bba5ad83',
              'Paste your MiniMax session cookie for local rate-limit fetching.'
            )}
            keywords={['minimax', 'cookie', 'session', 'rate limit', 'status bar']}
            className="space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Label>
                  {translate(
                    'auto.components.settings.AccountsPane.21d6eb141e',
                    'MiniMax Session Cookie'
                  )}
                </Label>
                <Badge
                  variant={miniMaxConfigured ? 'secondary' : 'outline'}
                  className="h-5 gap-1 rounded-full px-2 text-[10px] font-medium text-muted-foreground"
                >
                  {miniMaxConfigured ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                  {miniMaxConfigured
                    ? translate('auto.components.settings.AccountsPane.73ea15f24b', 'Saved')
                    : translate('auto.components.settings.AccountsPane.23afe8f226', 'Not saved')}
                </Badge>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <HelpCircle className="size-3" />
                    {translate('auto.components.settings.AccountsPane.43d7a45b97', 'How to copy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" sideOffset={6} className="w-80 p-0">
                  <MiniMaxCookieHelpPopover />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                value={miniMaxCookieDraft}
                onChange={(e) => setMiniMaxCookieDraft(e.target.value)}
                placeholder={translate(
                  'auto.components.settings.AccountsPane.b8a4f21c3e',
                  'Paste the Cookie header from DevTools'
                )}
                spellCheck={false}
                className="flex-1 text-xs"
              />
              <Button
                size="xs"
                onClick={() => void saveMiniMaxCookie()}
                disabled={miniMaxCredentialBusy || !miniMaxCookieDraft.trim()}
                className="h-7 shrink-0 text-xs"
              >
                {miniMaxCredentialBusy ? <Loader2 className="size-3 animate-spin" /> : null}
                {miniMaxConfigured
                  ? translate('auto.components.settings.AccountsPane.f38b9cc4bd', 'Replace')
                  : translate('auto.components.settings.AccountsPane.590a3130f9', 'Save')}
              </Button>
              {miniMaxConfigured ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void clearMiniMaxCookie()}
                  disabled={miniMaxCredentialBusy}
                  className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  {translate('auto.components.settings.AccountsPane.316ca4e610', 'Forget cookie')}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.79418c782a',
                'Open platform.minimax.io/console/usage in your browser, sign in, then copy the Cookie request header from DevTools (Network → any remains request → Cookie).'
              )}
            </p>
            {miniMaxConfigured &&
            miniMaxRateLimits?.status === 'ok' &&
            miniMaxRateLimits.error === null ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.AccountsPane.53f7b8c7a2',
                  'Last refresh: {{value0}}',
                  { value0: formatMiniMaxRelativeRefresh(miniMaxRateLimits.updatedAt, Date.now()) }
                )}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.AccountsPane.31d24a4e87',
                'Cookie expires when you sign out in the browser.'
              )}
            </p>
          </SearchableSetting>

          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  {translate('auto.components.settings.AccountsPane.9dd50d3f75', 'Advanced')}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.AccountsPane.174fb408f9',
                    'Leave these defaults alone unless MiniMax usage refresh points at the wrong workspace or model.'
                  )}
                </p>
              </div>
            </div>

            <SearchableSetting
              title={translate(
                'auto.components.settings.AccountsPane.bf160bb6c0',
                'Group ID override'
              )}
              description={translate(
                'auto.components.settings.AccountsPane.b1e2743313',
                'Optional. Leave blank to use minimax_group_id_v2 from the cookie.'
              )}
              keywords={['minimax', 'group', 'id', 'rate limit']}
              className="space-y-2"
            >
              <Label>
                {translate('auto.components.settings.AccountsPane.bf160bb6c0', 'Group ID override')}
              </Label>
              <Input
                type="text"
                value={settings.minimaxGroupId}
                onChange={(e) => updateSettings({ minimaxGroupId: e.target.value })}
                placeholder={translate(
                  'auto.components.settings.AccountsPane.0747d6391a',
                  'Use group ID from cookie'
                )}
                spellCheck={false}
                className="text-xs"
              />
            </SearchableSetting>

            <SearchableSetting
              title={translate(
                'auto.components.settings.AccountsPane.4ff2af7524',
                'Usage model names'
              )}
              description={translate(
                'auto.components.settings.AccountsPane.5cf4b0f85f',
                'Optional comma-separated model names. Leave as general unless MiniMax returns a model-specific error.'
              )}
              keywords={['minimax', 'model', 'general', 'rate limit']}
              className="space-y-2"
            >
              <Label>
                {translate('auto.components.settings.AccountsPane.4ff2af7524', 'Usage model names')}
              </Label>
              <Input
                type="text"
                value={settings.minimaxUsageModels}
                onChange={(e) => updateSettings({ minimaxUsageModels: e.target.value })}
                placeholder={translate('auto.components.settings.AccountsPane.3c92b0d31c', 'general')}
                spellCheck={false}
                className="text-xs"
              />
            </SearchableSetting>
          </div>
        </section>
      ) : null,
  matchesSettingsSearch(searchQuery, getAccountsGrokSearchEntries()) ? (
        <GrokAccountsSection key="grok" />
      ) : null,
    matchesSettingsSearch(searchQuery, getAccountsGrokSearchEntries()) ? (
      <GrokAccountsSection key="grok" />
    ) : null
  ].filter((section): section is React.JSX.Element => section !== null)
}
