import { Eraser, Monitor, Smartphone } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'

type TerminalTab = { id: string; terminal: string | null }

/** Builds the terminal long-press menu. */
export function getMobileTerminalActionSheetActions<
  Target extends { handle: string },
  Tab extends TerminalTab
>(args: {
  target: Target | null
  tabs: readonly Tab[]
  onDismiss: () => void
  isPhoneMode: (handle: string) => boolean
  onToggleDisplayMode: (handle: string) => void
  onRename: (target: Target) => void
  onClear: (target: Target) => void
  onClose: (target: Target) => void
  onCloseSessionTab: (tab: Tab) => void
  bulkCloseActions?: (anchorTabId: string | undefined, dismiss: () => void) => ActionSheetAction[]
}): ActionSheetAction[] {
  const { target } = args
  if (!target) {
    return []
  }
  const phoneMode = args.isPhoneMode(target.handle)
  const sessionTab = args.tabs.find((tab) => tab.terminal === target.handle)
  return [
    {
      label: phoneMode ? 'Switch to Desktop' : 'Switch to Phone',
      icon: phoneMode ? Monitor : Smartphone,
      onPress: () => {
        args.onDismiss()
        args.onToggleDisplayMode(target.handle)
      }
    },
    {
      label: 'Rename',
      closeBeforePress: true,
      onPress: () => args.onRename(target)
    },
    {
      label: 'Clear Terminal',
      icon: Eraser,
      onPress: () => {
        args.onDismiss()
        args.onClear(target)
      }
    },
    {
      label: 'Close',
      destructive: true,
      onPress: () => {
        args.onDismiss()
        if (sessionTab) {
          args.onCloseSessionTab(sessionTab)
          return
        }
        args.onClose(target)
      }
    },
    ...(args.bulkCloseActions?.(sessionTab?.id, args.onDismiss) ?? [])
  ]
}
