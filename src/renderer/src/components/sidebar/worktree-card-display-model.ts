import { translate } from '@/i18n/i18n'

export function getLineageChildLabels(
  count: number,
  collapsed: boolean
): { ariaLabel: string; shortLabel: string } {
  const noun =
    count === 1
      ? translate('auto.components.sidebar.WorktreeList.0c6ee14f23', 'child')
      : translate('auto.components.sidebar.WorktreeList.045a8aed48', 'children')
  const ariaLabel =
    count === 1
      ? translate(
          collapsed
            ? 'auto.components.sidebar.WorktreeList.20bebf9c7f'
            : 'auto.components.sidebar.WorktreeList.e97297cb75',
          collapsed ? 'Show {{value0}} child workspace' : 'Hide {{value0}} child workspace',
          { value0: count }
        )
      : translate(
          collapsed
            ? 'auto.components.sidebar.WorktreeList.c1f4a31623'
            : 'auto.components.sidebar.WorktreeList.0cd15956d4',
          collapsed ? 'Show {{value0}} child workspaces' : 'Hide {{value0}} child workspaces',
          { value0: count }
        )
  return { ariaLabel, shortLabel: `${count} ${noun}` }
}

export function hasDetailedMetaRowContent(values: {
  repoBadge: boolean
  hostContext: boolean
  folderContent: boolean
  branch: boolean
  identity: boolean
  detached: boolean
  conflict: boolean
  cache: boolean
  details: boolean
}): boolean {
  return (
    values.repoBadge ||
    values.hostContext ||
    values.folderContent ||
    values.branch ||
    values.identity ||
    values.detached ||
    values.conflict ||
    values.cache ||
    values.details
  )
}
