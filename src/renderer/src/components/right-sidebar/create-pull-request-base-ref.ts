import type { BaseRefSearchResult } from '../../../../shared/types'
import { normalizeHostedReviewBaseRef } from '../../../../shared/hosted-review-refs'

export function stripBaseRef(ref: string): string {
  return normalizeHostedReviewBaseRef(ref)
}

export function resolveCreateReviewDefaultBaseRef({
  currentBaseRef,
  eligibilityDefaultBaseRef
}: {
  currentBaseRef?: string | null
  eligibilityDefaultBaseRef?: string | null
}): string {
  // Prefer the remote-validated default so local-only parents do not become review targets.
  return stripBaseRef(eligibilityDefaultBaseRef?.trim() || currentBaseRef?.trim() || '')
}

export function normalizeCreateReviewBaseSearchResults(
  results: readonly BaseRefSearchResult[]
): string[] {
  const seen = new Set<string>()
  const branches: string[] = []
  for (const result of results) {
    const branch = stripBaseRef((result.localBranchName || result.refName).trim())
    if (!branch || seen.has(branch)) {
      continue
    }
    seen.add(branch)
    branches.push(branch)
  }
  return branches
}
