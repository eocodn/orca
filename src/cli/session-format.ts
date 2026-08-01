import type { RuntimeSessionFlushResult, RuntimeSessionSnapshot } from '../shared/runtime-types'

function formatSnapshot(snapshot: RuntimeSessionSnapshot): string {
  return [
    `Host generation: ${snapshot.hostGeneration}`,
    `Revision: ${snapshot.revision}`,
    `Session snapshots: ${snapshot.snapshots.length}`
  ].join('\n')
}

export function formatSessionSnapshot(result: { snapshot: RuntimeSessionSnapshot }): string {
  return formatSnapshot(result.snapshot)
}

export function formatSessionFlush(result: { flush: RuntimeSessionFlushResult }): string {
  return `${formatSnapshot(result.flush)}\nFlushed: ${result.flush.flushed}`
}
