// Public controller facade; source/search presentation lives in the concrete view module.
export {
  default,
  canUseGitLabSmartSource,
  getRepoSlugCached
} from './smart-workspace-name-field-view'
export type {
  RepoOption,
  RowEntry,
  SmartWorkspaceNameSelection
} from './smart-workspace-name-field-view'
