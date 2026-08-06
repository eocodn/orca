/**
 * Public worktree sidebar boundary.
 *
 * Keep this module intentionally small: consumers import the stable sidebar
 * surface while the implementation can be split into focused modules without
 * changing navigation imports or test contracts.
 */
export {
  default,
  countRecordKeysByReference,
  resolvePendingSidebarReveal,
  shouldAdjustWorktreeSidebarMeasuredRowScroll,
  renderRowContainsWorktree,
  getPinnedWorktreeRevealCollapsedGroupKeys,
  getRenderRowKey,
  getWorktreeDragGroups,
  canKeepImportedWorktreesHidden,
  getWorktreeDragIndexes,
  installWorktreeVisibleRefreshVisibilityListener
} from './worktree-list-surface'

export {
  getScrollTopToRevealBounds,
  WORKTREE_SIDEBAR_REVEAL_TOP_INSET
} from './worktree-sidebar-reveal'
