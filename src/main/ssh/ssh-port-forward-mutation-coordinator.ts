export type ForwardMutation = {
  connectionId: string
  cancelled: boolean
}

export class SshPortForwardMutationCoordinator {
  private queues = new Map<string, Promise<unknown>>()
  private active = new Map<string, Set<ForwardMutation>>()

  run<T>(
    id: string,
    connectionId: string,
    operation: (mutation: ForwardMutation) => Promise<T>
  ): Promise<T> {
    const mutation: ForwardMutation = { connectionId, cancelled: false }
    const mutations = this.active.get(id) ?? new Set<ForwardMutation>()
    mutations.add(mutation)
    this.active.set(id, mutations)
    const predecessor = this.queues.get(id)?.catch(() => undefined) ?? Promise.resolve()
    let tracked = predecessor.then(() => operation(mutation))
    tracked = tracked.finally(() => {
      if (this.queues.get(id) === tracked) {
        this.queues.delete(id)
      }
      const current = this.active.get(id)
      current?.delete(mutation)
      if (current?.size === 0) {
        this.active.delete(id)
      }
    })
    this.queues.set(id, tracked)
    return tracked
  }

  idsForConnection(connectionId: string): string[] {
    return [...this.active.entries()]
      .filter(([, mutations]) =>
        [...mutations].some((mutation) => mutation.connectionId === connectionId)
      )
      .map(([id]) => id)
  }

  cancel(id: string, connectionId?: string): void {
    const mutations = this.active.get(id)
    if (!mutations) {
      return
    }
    for (const mutation of mutations) {
      if (connectionId === undefined || mutation.connectionId === connectionId) {
        mutation.cancelled = true
      }
    }
  }

  waitFor(id: string): Promise<void> | undefined {
    const queue = this.queues.get(id)
    return queue?.then(
      () => undefined,
      () => undefined
    )
  }

  cancelAll(): void {
    for (const id of this.active.keys()) {
      this.cancel(id)
    }
  }
}
