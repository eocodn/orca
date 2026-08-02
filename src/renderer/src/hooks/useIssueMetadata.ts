/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: issue metadata hooks clear stale rows and track loading while async provider cache requests are in flight. */
export { clearGitHubMetadataCache, useRepoAssignees, useRepoLabels } from './github-issue-metadata'
export {
  clearLinearMetadataCache,
  useTeamLabels,
  useTeamMembers,
  useTeamsLabels,
  useTeamsMembers,
  useTeamsStates,
  useTeamStates
} from './linear-issue-metadata'
export type { MetadataState } from './issue-metadata-state'
export { useImmediateMutation } from './useImmediateMutation'
