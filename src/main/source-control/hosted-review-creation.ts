import type {
  CreateHostedReviewInput,
  CreateHostedReviewResult
} from '../../shared/hosted-review'
import { supportsHostedReviewCreation } from '../../shared/hosted-review-creation-providers'
import { getForgeProviderForRepository } from './forge-provider'
import {
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from './hosted-review-git-options'

import { hostedReviewExecutionContext, reviewCopy, validateCurrentBranchCanCreateReview } from './hosted-review-eligibility'
export { getHostedReviewCreationEligibility } from './hosted-review-eligibility'

export async function createHostedReview(
  repoPath: string,
  input: CreateHostedReviewInput,
  connectionId?: string | null,
  options: HostedReviewExecutionOptions = {}
): Promise<CreateHostedReviewResult> {
  if (!supportsHostedReviewCreation(input.provider)) {
    return {
      ok: false,
      code: 'unsupported_provider',
      error: 'Creating reviews for this provider is not supported yet.'
    }
  }
  const provider = await getForgeProviderForRepository({
    repoPath,
    connectionId,
    ...hostedReviewExecutionContext(options)
  })
  if (provider?.id !== input.provider || !provider.createReview) {
    const copy = reviewCopy(input.provider)
    return {
      ok: false,
      code: 'unsupported_provider',
      error: `Creating ${copy.reviewLabel}s requires a ${copy.providerName} remote.`
    }
  }
  const blocked = await validateCurrentBranchCanCreateReview(repoPath, connectionId, input, options)
  if (blocked) {
    return blocked
  }
  const localGitOptions = getHostedReviewLocalGitOptions(options)
  return Object.keys(localGitOptions).length > 0
    ? provider.createReview(repoPath, input, connectionId, options)
    : provider.createReview(repoPath, input, connectionId)
}
