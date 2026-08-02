import { Ssh2PortForwardProvider } from './ssh2-port-forward-provider'
import { SystemSshPortForwardProvider } from './system-ssh-port-forward-provider'
import type { SshPortForwardProvider } from './ssh-port-forward-provider'

export function createDefaultSshPortForwardProviders(): SshPortForwardProvider[] {
  return [new Ssh2PortForwardProvider(), new SystemSshPortForwardProvider()]
}
