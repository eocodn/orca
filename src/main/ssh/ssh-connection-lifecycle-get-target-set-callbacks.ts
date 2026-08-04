import type { SshTarget } from '../../shared/ssh-types'
import type { SshResolvedConfig } from './ssh-config-parser'
import type { SshConnectionCallbacks } from './ssh-connection-utils'
import { cloneResolvedConfig } from './ssh-connection-lifecycle-foundation'

export const SshConnectionMethods2 = {
  getTarget(this: any): SshTarget {
    return { ...this.target }
  },
  getSystemSshResolvedConfig(this: any): SshResolvedConfig | null {
    return cloneResolvedConfig(this.systemSshResolvedConfig)
  },
  getHostKeyFingerprint(this: any): string | undefined {
    // Why: system SSH does not expose its negotiated key; a fingerprint from a
    // failed ssh2 attempt may identify a different load-balanced execution host.
    return this.useSystemSshTransport ? undefined : this.hostKeyFingerprint
  },
  setCallbacks(this: any, callbacks: SshConnectionCallbacks): void {
    this.callbacks = callbacks
  }
}
export type SshConnectionMethods2Surface = typeof SshConnectionMethods2
