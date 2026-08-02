import type { SshConnection } from './ssh-connection'
import { Ssh2PortForwardProvider } from './ssh2-port-forward-provider'
import { SystemSshPortForwardProvider } from './system-ssh-port-forward-provider'
import {
  SshPortForwardMutationCoordinator,
  type ForwardMutation
} from './ssh-port-forward-mutation-coordinator'
import type { PortForwardEntry } from '../../shared/ssh-types'
import type {
  PortForwardCloseReason,
  SshPortForwardProvider,
  StartedPortForward
} from './ssh-port-forward-provider'

export type { PortForwardEntry }
export type { PortForwardCloseReason }

type SshPortForwardManagerCallbacks = {
  onForwardClosed?: (entry: PortForwardEntry, reason: PortForwardCloseReason) => void
}

type PendingForwardStart = {
  connectionId: string
  cancelled: boolean
  settled: Promise<void>
}

export class SshPortForwardManager {
  private forwards = new Map<string, StartedPortForward>()
  private closingForwards = new Map<string, Promise<PortForwardEntry | null>>()
  private pendingForwardStarts = new Map<string, PendingForwardStart>()
  private forwardMutationCoordinator = new SshPortForwardMutationCoordinator()
  private nextId = 1
  private providers: SshPortForwardProvider[]
  private callbacks: SshPortForwardManagerCallbacks
  private disposed = false

  constructor(
    callbacks: SshPortForwardManagerCallbacks = {},
    providers: SshPortForwardProvider[] = [
      new Ssh2PortForwardProvider(),
      new SystemSshPortForwardProvider()
    ]
  ) {
    this.callbacks = callbacks
    this.providers = providers
  }

  setCallbacks(callbacks: SshPortForwardManagerCallbacks): void {
    this.callbacks = callbacks
  }

  async addForward(
    connectionId: string,
    conn: SshConnection,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    label?: string
  ): Promise<PortForwardEntry> {
    return this.addForwardWithId(
      `pf-${this.nextId++}`,
      connectionId,
      conn,
      localPort,
      remoteHost,
      remotePort,
      label
    )
  }

  private async addForwardWithId(
    id: string,
    connectionId: string,
    conn: SshConnection,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    label?: string,
    mutation?: ForwardMutation
  ): Promise<PortForwardEntry> {
    this.assertForwardMutationActive(mutation)
    const provider = this.providers.find((candidate) => candidate.canHandle(conn))
    if (!provider) {
      throw new Error('SSH connection is not established')
    }

    let resolveSettled!: () => void
    const pending: PendingForwardStart = {
      connectionId,
      cancelled: false,
      settled: new Promise<void>((resolve) => {
        resolveSettled = resolve
      })
    }
    this.pendingForwardStarts.set(id, pending)
    let forward: StartedPortForward | null = null
    try {
      forward = await provider.start(conn, {
        id,
        connectionId,
        localHost: '127.0.0.1',
        localPort,
        remoteHost,
        remotePort,
        label,
        onUnexpectedClose: (entry, reason) => {
          const active = this.forwards.get(id)
          if (active !== forward) {
            return
          }
          this.forwards.delete(id)
          this.callbacks.onForwardClosed?.(entry, reason)
        }
      })
      if (pending.cancelled || !this.isForwardMutationActive(mutation)) {
        await forward.close().catch((error) => {
          console.warn('[ssh] failed to close a cancelled port forward:', error)
        })
        throw new Error('port_forward_cancelled')
      }
      this.forwards.set(id, forward)
      return forward.entry
    } finally {
      if (this.pendingForwardStarts.get(id) === pending) {
        this.pendingForwardStarts.delete(id)
      }
      resolveSettled()
    }
  }

  async updateForward(
    id: string,
    conn: SshConnection,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    label?: string
  ): Promise<PortForwardEntry> {
    if (this.disposed) {
      throw new Error('port_forward_cancelled')
    }
    return this.forwardMutationCoordinator.run(id, this.forwards.get(id)?.entry.connectionId ?? '',
      (mutation) =>
        this.updateForwardNow(id, conn, localPort, remoteHost, remotePort, label, mutation)
    )
  }

  private async updateForwardNow(
    id: string,
    conn: SshConnection,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    label: string | undefined,
    mutation: ForwardMutation
  ): Promise<PortForwardEntry> {
    this.assertForwardMutationActive(mutation)
    const existing = this.forwards.get(id)
    if (!existing) {
      throw new Error(`Port forward "${id}" not found`)
    }
    const oldEntry = { ...existing.entry }

    // Why: use the async variant so the OS fully releases the port before
    // we try to rebind. Without this, same-port edits (e.g. label change)
    // fail with EADDRINUSE because server.close() is async.
    await this.removeForwardAsync(id)
    this.assertForwardMutationActive(mutation)

    try {
      return await this.addForwardWithId(
        oldEntry.id,
        oldEntry.connectionId,
        conn,
        localPort,
        remoteHost,
        remotePort,
        label,
        mutation
      )
    } catch (err) {
      if (!this.isForwardMutationActive(mutation)) {
        throw err
      }
      // Why: use addForwardWithId to preserve the original ID so the
      // renderer's references remain valid after a failed edit.
      try {
        await this.addForwardWithId(
          oldEntry.id,
          oldEntry.connectionId,
          conn,
          oldEntry.localPort,
          oldEntry.remoteHost,
          oldEntry.remotePort,
          oldEntry.label,
          mutation
        )
      } catch {
        // best-effort rollback
      }
      throw err
    }
  }

  removeForward(id: string): PortForwardEntry | null {
    this.forwardMutationCoordinator.cancel(id)
    const pending = this.pendingForwardStarts.get(id)
    if (pending) {
      pending.cancelled = true
    }
    if (this.closingForwards.has(id)) {
      return this.forwards.get(id)?.entry ?? null
    }
    const forward = this.forwards.get(id)
    if (!forward) {
      return null
    }
    forward.dispose()
    this.forwards.delete(id)
    return forward.entry
  }

  async removeForwardAndWait(id: string): Promise<PortForwardEntry | null> {
    this.forwardMutationCoordinator.cancel(id)
    return this.removeForwardAsync(id)
  }

  // Why: server.close()/process exit are async — callers that need to rebind
  // the same port (update/reconnect) must wait until the owner fully releases it.
  private removeForwardAsync(id: string): Promise<PortForwardEntry | null> {
    const pending = this.pendingForwardStarts.get(id)
    if (pending) {
      pending.cancelled = true
    }
    const closing = this.closingForwards.get(id)
    if (closing) {
      return closing
    }
    const forward = this.forwards.get(id)
    if (!forward) {
      return Promise.resolve(null)
    }
    const closePromise = forward
      .close()
      .then(() => forward.entry)
      .finally(() => {
        if (this.closingForwards.get(id) === closePromise) {
          this.closingForwards.delete(id)
          if (this.forwards.get(id) === forward) {
            this.forwards.delete(id)
          }
        }
      })
    this.closingForwards.set(id, closePromise)
    return closePromise
  }

  listForwards(connectionId?: string): PortForwardEntry[] {
    const entries: PortForwardEntry[] = []
    for (const { entry } of this.forwards.values()) {
      if (!connectionId || entry.connectionId === connectionId) {
        entries.push(entry)
      }
    }
    return entries
  }

  async removeAllForwards(connectionId: string): Promise<void> {
    const mutationIds = this.forwardMutationCoordinator.idsForConnection(connectionId)
    for (const id of mutationIds) {
      this.forwardMutationCoordinator.cancel(id, connectionId)
    }
    const pendingStarts = [...this.pendingForwardStarts.values()]
      .filter((pending) => pending.connectionId === connectionId)
      .map((pending) => {
        pending.cancelled = true
        return pending.settled
      })
    const toRemove = [...this.forwards.entries()]
      .filter(([, { entry }]) => entry.connectionId === connectionId)
      .map(([id]) => id)
    for (const id of toRemove) {
      this.forwardMutationCoordinator.cancel(id, connectionId)
    }
    const mutations = mutationIds.flatMap((id) => {
      const queue = this.forwardMutationCoordinator.waitFor(id)
      return queue ? [queue] : []
    })
    await Promise.all([
      ...toRemove.map((id) => this.removeForwardAsync(id)),
      ...pendingStarts,
      ...mutations
    ])
  }

  dispose(): void {
    this.disposed = true
    this.forwardMutationCoordinator.cancelAll()
    for (const pending of this.pendingForwardStarts.values()) {
      pending.cancelled = true
    }
    const ids = [...this.forwards.keys()]
    for (const id of ids) {
      this.removeForward(id)
    }
  }

  private isForwardMutationActive(mutation: ForwardMutation | undefined): boolean {
    return !this.disposed && mutation?.cancelled !== true
  }

  private assertForwardMutationActive(mutation: ForwardMutation | undefined): void {
    if (!this.isForwardMutationActive(mutation)) {
      throw new Error('port_forward_cancelled')
    }
  }

}
