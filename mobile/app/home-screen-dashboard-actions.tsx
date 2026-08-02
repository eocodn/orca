import { RefreshCw, PowerOff, Edit3 } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { HostProfile, ConnectionState } from '../src/transport/types'
import { navigateToMobileHostEdit } from '../src/transport/host-edit-navigation'
import { ActionSheetModal, type ActionSheetAction } from '../src/components/ActionSheetModal'
import { ConfirmModal } from '../src/components/ConfirmModal'
import { endpointLabel } from '../src/home-screen-data'

type Props = {
  router: ReturnType<typeof useRouter>
  actionTarget: HostProfile | null
  confirmRemove: HostProfile | null
  hostStates: Record<string, ConnectionState>
  hostLastConnected: Record<string, number | null>
  forceReconnectHost: (hostId: string) => Promise<void> | void
  closeHostClient: (hostId: string) => void
  onCloseAction: () => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
  onRequestRemove: (host: HostProfile) => void
}

export function HomeScreenDashboardActions({
  router,
  actionTarget,
  confirmRemove,
  hostStates,
  hostLastConnected,
  forceReconnectHost,
  closeHostClient,
  onCloseAction,
  onConfirmRemove,
  onCancelRemove,
  onRequestRemove
}: Props) {
  const host = actionTarget
  const actions: ActionSheetAction[] = []
  if (host) {
    const state = hostStates[host.id] ?? 'connecting'
    const isLive = ['connected', 'connecting', 'handshaking', 'reconnecting'].includes(state)
    const hasEverConnected = (hostLastConnected[host.id] ?? null) != null
    actions.push({
      label: hasEverConnected && isLive ? 'Reconnect' : 'Connect',
      icon: RefreshCw,
      onPress: () => {
        onCloseAction()
        void forceReconnectHost(host.id)
      }
    })
    if (isLive) {
      actions.push({
        label: 'Disconnect',
        icon: PowerOff,
        onPress: () => {
          onCloseAction()
          closeHostClient(host.id)
        }
      })
    }
    actions.push({
      label: 'Edit host',
      icon: Edit3,
      closeBeforePress: true,
      onPress: () => {
        onCloseAction()
        navigateToMobileHostEdit(router, host.id)
      }
    })
    actions.push({
      label: 'Remove',
      destructive: true,
      closeBeforePress: true,
      onPress: () => onRequestRemove(host)
    })
  }
  return (
    <>
      <ActionSheetModal
        visible={host != null}
        title={host?.name}
        message={host ? endpointLabel(host.endpoint) : undefined}
        actions={actions}
        onClose={onCloseAction}
      />
      <ConfirmModal
        visible={confirmRemove != null}
        title="Remove Host"
        message={`Remove "${confirmRemove?.name}"? You can re-pair later.`}
        confirmLabel="Remove"
        destructive
        onConfirm={onConfirmRemove}
        onCancel={onCancelRemove}
      />
    </>
  )
}