// Concrete provider runtime section.
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
import { matchesSettingsSearch } from './settings-search'


export function AccountsProviderRuntimeSection({ context }: { context: Record<string, any> }): React.JSX.Element | null {
  const {
    searchQuery,
    isRemoteAccountScope,
    accountRuntimeControls,
  } = context
  return (
  wslSupportedPlatform &&
      !isRemoteAccountScope &&
      matchesSettingsSearch(searchQuery, getAccountsLocationSearchEntries()) ? (
        <section key="account-runtime" id="accounts-runtime" className="space-y-3 scroll-mt-6">
          {accountRuntimeControls}
        </section>
      ) : null
  )
}
