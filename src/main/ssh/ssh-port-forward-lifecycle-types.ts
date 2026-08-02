import type { PortForwardEntry } from '../../shared/ssh-types'
import type { PortForwardCloseReason } from './ssh-port-forward-provider'

export type SshPortForwardManagerCallbacks = {
  onForwardClosed?: (entry: PortForwardEntry, reason: PortForwardCloseReason) => void
}

export type PendingPortForwardStart = {
  connectionId: string
  cancelled: boolean
  settled: Promise<void>
}
