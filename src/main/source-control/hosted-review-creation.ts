import type {
  CreateHostedReviewInput,
  CreateHostedReviewResult,
  HostedReviewCreationBlockedReason,
  HostedReviewCreationEligibility,
  HostedReviewCreationEligibilityArgs,
  HostedReviewLookupOutcome,
  HostedReviewProvider
} from '../../shared/hosted-review'
import {
  normalizeHostedReviewBaseRef,
  normalizeHostedReviewHeadRef
} from '../../shared/hosted-review-refs'
import {
  supportsHostedReviewCreation,
  type HostedReviewCreationProvider
} from '../../shared/hosted-review-creation-providers'
import { isAzureDevOpsReviewCreationAuthenticated } from '../azure-devops/pull-request-creation'
import { isGiteaReviewCreationAuthenticated } from '../gitea/pull-request-creation'
import { getEnterpriseGitHubRepoSlug } from '../github/github-enterprise-repository'
import { acquire, ghExecFileAsync, gitExecFileAsync, release } from '../github/gh-utils'
import { isNoUpstreamError, normalizeGitErrorMessage } from '../../shared/git-remote-error'
import type { GitUpstreamStatus } from '../../shared/types'
import { gitOptionalLocksDisabledEnv } from '../git/runner'
import { parsePorcelainV1Records, type PorcelainV1Record } from '../git/porcelain-v1-records'
import { findExistingWorktreeSymlinkPaths } from '../git/worktree-symlink-detection'
import { resolveDefaultBaseRefViaExec } from '../git/repo'
import { getUpstreamStatus } from '../git/upstream'
import { getProjectSlug } from '../gitlab/client'
import {
  acquire as acquireGlab,
  glabExecFileAsync,
  glabRepoExecOptions,
  release as releaseGlab
} from '../gitlab/gl-utils'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { detectHostedReviewProvider, getForgeProviderForRepository } from './forge-provider'
import { getHostedReviewForBranch } from './hosted-review'
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
