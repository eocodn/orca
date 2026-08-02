// Remote PTY transport facade; concrete session policies live in focused modules.
import type { IpcPtyTransportOptions, PtyTransport } from './pty-transport-types'
import { createRemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'
import { installRemoteRuntimePtyCreationRecovery } from './remote-runtime-pty-transport-creation-recovery'
import { installRemoteRuntimePtyHostSessionDiscovery } from './remote-runtime-pty-transport-host-session-discovery'
import { installRemoteRuntimePtyHostSessionPane } from './remote-runtime-pty-transport-host-session-pane'
import { installRemoteRuntimePtyIo } from './remote-runtime-pty-transport-io'
import { installRemoteRuntimePtyStreamRecovery } from './remote-runtime-pty-transport-stream-recovery'
import { createRemoteRuntimePtyTransportLifecycle } from './remote-runtime-pty-transport-lifecycle'

export function createRemoteRuntimePtyTransport(
  runtimeEnvironmentId: string,
  opts: IpcPtyTransportOptions = {}
): PtyTransport {
  const context = createRemoteRuntimePtyTransportContext(runtimeEnvironmentId, opts)
  installRemoteRuntimePtyCreationRecovery(context)
  installRemoteRuntimePtyHostSessionDiscovery(context)
  installRemoteRuntimePtyHostSessionPane(context)
  installRemoteRuntimePtyIo(context)
  installRemoteRuntimePtyStreamRecovery(context)
  return createRemoteRuntimePtyTransportLifecycle(context)
}
