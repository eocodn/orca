import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/project-host-setup-options'

export const RUN_TARGET_ADD_HOST_KEY = 'add-host'

export type RunTargetRowModel =
  | { key: string; kind: 'ready'; option: ProjectHostSetupOption }
  | { key: string; kind: 'needs-setup'; option: NeedsSetupProjectHostOption }
  | { key: typeof RUN_TARGET_ADD_HOST_KEY; kind: 'add-host' }

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query)
}

export function buildRunTargetRows({
  hostOptions,
  query,
  hasAddHost
}: {
  hostOptions: readonly ProjectHostSetupOption[]
  query: string
  hasAddHost: boolean
}): { rows: RunTargetRowModel[] } {
  const trimmed = query.trim().toLowerCase()
  const rows = hostOptions
    .filter((option) => {
      if (!trimmed) return true
      const detail = option.kind === 'ready' ? option.path : option.detail
      return matches(option.label, trimmed) || matches(detail, trimmed)
    })
    .map((option) => ({
      key: option.id,
      kind: option.kind,
      option
    })) as RunTargetRowModel[]
  if (hasAddHost) rows.push({ key: RUN_TARGET_ADD_HOST_KEY, kind: 'add-host' })
  return { rows }
}
