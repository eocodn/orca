import type { FeatureInteractionId } from '../../../shared/feature-interactions'
import type { OrcaRuntimeService } from '../orca-runtime'

export function getRuntimeFeatureInteractionId(
  method: string,
  result: unknown,
  _rawParams?: unknown
): FeatureInteractionId | null {
  if (method === 'browser.profileImportFromBrowser') {
    return hasBooleanResult(result, 'ok') ? 'cookie-import' : null
  }
  if (method === 'browser.profileClearDefaultCookies') {
    return hasBooleanResult(result, 'cleared') ? 'cookie-import' : null
  }
  return method.startsWith('orchestration.') ? 'agent-orchestration' : null
}

export function recordRuntimeFeatureInteraction(
  runtime: OrcaRuntimeService,
  method: string,
  result: unknown,
  alreadyRecorded?: Set<FeatureInteractionId>,
  rawParams?: unknown
): void {
  const id = getRuntimeFeatureInteractionId(method, result, rawParams)
  if (!id || alreadyRecorded?.has(id)) {
    return
  }
  try {
    runtime.recordFeatureInteraction(id)
    alreadyRecorded?.add(id)
  } catch {
    // Best-effort education state must not break runtime tools.
  }
}

function hasBooleanResult(value: unknown, key: string): boolean {
  return (
    value !== null && typeof value === 'object' && (value as Record<string, unknown>)[key] === true
  )
}
