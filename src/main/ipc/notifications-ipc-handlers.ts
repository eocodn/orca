export * from './notifications-ipc-foundation'
export { triggerStartupNotificationRegistration } from './notifications-startup-registration'
import { registerNotificationDeliveryHandlers } from './notifications-delivery-ipc-handlers'
import { registerNotificationDispatchHandlers } from './notifications-dispatch-ipc-handlers'
import { registerNotificationSoundHandlers } from './notifications-sound-ipc-handlers'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence'

export function registerNotificationHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  registerNotificationDeliveryHandlers(store, runtime)
  registerNotificationDispatchHandlers(store, runtime)
  registerNotificationSoundHandlers(store, runtime)
}
