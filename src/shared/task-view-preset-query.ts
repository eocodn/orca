import type { TaskViewPresetId } from './types'

export function getTaskPresetQuery(presetId: TaskViewPresetId | null): string {
  switch (presetId) {
    case 'all':
    case 'issues':
      return 'is:issue is:open'
    case 'my-issues':
      return 'assignee:@me is:issue is:open'
    case 'prs':
      return 'is:pr is:open'
    case 'my-prs':
      return 'author:@me is:pr is:open'
    case 'review':
      return 'review-requested:@me is:pr is:open'
    case null:
      return 'is:issue is:open'
  }
}
