/** Whether a known terminal handle should be dropped after a `terminal.list` refresh. */
export function shouldPruneTerminalHandle(args: {
  handle: string
  liveHandles: ReadonlySet<string>
}): boolean {
  return !args.liveHandles.has(args.handle)
}

/** Binds one `terminal.list` refresh's context so callers can test many handles. */
export function createTerminalPrunePredicate(context: {
  liveHandles: ReadonlySet<string>
}): (handle: string) => boolean {
  return (handle) => shouldPruneTerminalHandle({ handle, ...context })
}

/** The handles this refresh treats as alive. */
export function resolveRetainedTerminalHandles(context: {
  liveHandles: ReadonlySet<string>
}): ReadonlySet<string> {
  return context.liveHandles
}

/** Drops per-handle keyboard metrics for pruned terminals. */
export function pruneTerminalKeyboardMetrics<T>(
  previous: Map<string, T>,
  shouldPrune: (handle: string) => boolean
): Map<string, T> {
  let next: Map<string, T> | null = null
  for (const handle of previous.keys()) {
    if (!shouldPrune(handle)) {
      continue
    }
    next ??= new Map(previous)
    next.delete(handle)
  }
  return next ?? previous
}
