import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileImageSource } from './mobile-image-source-picker'
import { useMobileImageAttachment } from './use-mobile-image-attachment'

type CurrentRef<T> = { readonly current: T }

type Args = {
  readonly client: RpcClient | null
  readonly activeHandle: string | null
  readonly canSend: boolean
  readonly connState: ConnectionState
  readonly deviceTokenRef: CurrentRef<string | null>
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly beforeTerminalSend: (terminal: string) => Promise<boolean>
  readonly showToast: (message: string, durationMs?: number) => void
  readonly onSuccess: () => void
  readonly onError: () => void
}

/** Wires image attachment to the visible terminal input. */
export function useMobileSessionImageAttachments({
  client,
  activeHandle,
  canSend,
  connState,
  deviceTokenRef,
  getActiveWorktreeConnectionId,
  beforeTerminalSend,
  showToast,
  onSuccess,
  onError
}: Args): { attachImage: (source: MobileImageSource) => Promise<void>; isAttaching: boolean } {
  const { attachImage, isAttaching } = useMobileImageAttachment({
    client,
    activeHandle,
    canSend,
    connState,
    deviceTokenRef,
    beforeTerminalSend,
    getActiveWorktreeConnectionId,
    showToast,
    onSuccess,
    onError
  })
  return { attachImage, isAttaching }
}
