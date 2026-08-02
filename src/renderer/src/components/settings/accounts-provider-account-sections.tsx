// Concrete provider accounts section composition.


import { AccountsProviderRuntimeSection } from './accounts-provider-runtime-section'
import { AccountsProviderClaudeSection } from './accounts-provider-claude-section'
import { AccountsProviderCodexSection } from './accounts-provider-codex-section'
import { AccountsProviderCredentialSections } from './accounts-provider-credential-sections'

export function AccountsProviderAccountSections({ context }: { context: Record<string, any> }): React.JSX.Element[] {
  return [
    <AccountsProviderRuntimeSection key="account-runtime" context={context} />,
    <AccountsProviderClaudeSection key="claude-accounts" context={context} />,
    <AccountsProviderCodexSection key="codex-accounts" context={context} />,
    ...AccountsProviderCredentialSections({ context })
  ].filter((section): section is React.JSX.Element => section !== null)
}
