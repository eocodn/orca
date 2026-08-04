import type { Client as SshClient } from 'ssh2'
import type { SshConnectionState } from '../../shared/ssh-types'
import { getOrcaControlSocketPath } from './ssh-system-fallback'

export const SshConnectionMethods1 = {
  getState(this: any): SshConnectionState {
    return { ...this.state }
  },
  getClient(this: any): SshClient | null {
    return this.client
  },
  usesSystemSshTransport(this: any): boolean {
    return this.useSystemSshTransport
  },
  canRunConcurrentExecCommands(this: any): boolean {
    if (!this.useSystemSshTransport) {
      return true
    }
    return (
      getOrcaControlSocketPath(this.target, {
        ...this.getSystemSshBuildArgsOptions()
      }) !== null
    )
  }
}
export type SshConnectionMethods1Surface = typeof SshConnectionMethods1
