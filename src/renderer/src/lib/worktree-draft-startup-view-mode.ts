import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'

export function resolveBackendDraftStartup(
  request: WorktreeCreationRequest
): WorktreeCreationRequest['startup'] {
  return request.startup
}
