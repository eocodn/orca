// Public provider-account pane facade; concrete state and dialogs live in account modules.
import { Separator } from '../ui/separator'
import { AccountsProviderAccountSections } from './accounts-provider-account-sections'
import {
  AccountsProviderAccountRemovalDialogs,
  type AccountsProviderAccountRemovalDialogsProps
} from './accounts-provider-account-removal-dialogs'
import {
  useAccountsProviderAccountRuntime,
  type AccountsPaneProps
} from './accounts-provider-account-runtime'
import { getAccountsPaneSearchEntries } from './accounts-search'

export { getAccountsPaneSearchEntries }
export type { AccountsPaneProps }

export function AccountsPane(props: AccountsPaneProps): React.JSX.Element {
  const runtime = useAccountsProviderAccountRuntime(props)
  const visibleSections = (
    <AccountsProviderAccountSections context={runtime.accountSectionsContext} />
  )
  const removalDialogs: AccountsProviderAccountRemovalDialogsProps = {
    settings: runtime.settings,
    removeCodexTarget: runtime.removeCodexTarget,
    setRemoveCodexTarget: runtime.setRemoveCodexTarget,
    removeClaudeTarget: runtime.removeClaudeTarget,
    setRemoveClaudeTarget: runtime.setRemoveClaudeTarget,
    runCodexAccountAction: runtime.runCodexAccountAction,
    runClaudeAccountAction: runtime.runClaudeAccountAction,
    removeCodexProviderAccount: runtime.removeCodexProviderAccount,
    removeClaudeProviderAccount: runtime.removeClaudeProviderAccount
  }

  return (
    <div className="space-y-8">
      <AccountsProviderAccountRemovalDialogs {...removalDialogs} />
      {visibleSections.map((section, index) => (
        <div key={index} className="space-y-8">
          {index > 0 ? <Separator /> : null}
          {section}
        </div>
      ))}
    </div>
  )
}
