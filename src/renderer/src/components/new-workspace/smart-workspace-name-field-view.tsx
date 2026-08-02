// Public component facade; source lookup and selection orchestration live in the concrete module.
export {
  default,
  canUseGitLabSmartSource,
  getRepoSlugCached
} from './smart-workspace-name-field-source-view'
export type {
  RepoOption,
  RowEntry,
  SmartWorkspaceNameSelection
} from './smart-workspace-name-field-source-view'
