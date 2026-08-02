// Concrete destructive-action confirmations for managed provider accounts.
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import type { ProviderAccountRuntimeView } from './provider-account-visibility'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'

export type AccountRemovalTarget = {
  id: string
  runtime: ProviderAccountRuntimeView
}

export type AccountsProviderAccountRemovalDialogsProps = {
  settings: GlobalSettings
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
  removeCodexProviderAccount: (
    settings: GlobalSettings,
    accountId: string
  ) => Promise<unknown>
  removeClaudeProviderAccount: (
    settings: GlobalSettings,
    accountId: string
  ) => Promise<unknown>
}

export function AccountsProviderAccountRemovalDialogs({
  settings,
  removeCodexTarget,
  setRemoveCodexTarget,
  removeClaudeTarget,
  setRemoveClaudeTarget,
  runCodexAccountAction,
  runClaudeAccountAction,
  removeCodexProviderAccount,
  removeClaudeProviderAccount
}: AccountsProviderAccountRemovalDialogsProps): React.JSX.Element {
  return (
    <>
      <Dialog
        open={removeCodexTarget !== null}
        onOpenChange={(open) => !open && setRemoveCodexTarget(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate('auto.components.settings.AccountsPane.0d47394635', 'Remove Codex Account?')}
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
                if (!target) return
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
              {translate('auto.components.settings.AccountsPane.63843e37e2', 'Remove Claude Account?')}
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
                if (!target) return
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
    </>
  )
}
