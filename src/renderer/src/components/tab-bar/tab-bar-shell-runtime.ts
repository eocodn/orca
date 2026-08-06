import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/project-execution-runtime'

type LocalRuntimeState = Parameters<typeof getLocalProjectExecutionRuntimeContext>[0]
type LocalRuntimeWslContext = Parameters<typeof getLocalProjectExecutionRuntimeContext>[3]

export function resolveTabBarLocalProjectRuntime(args: {
  showWindowsShellMenu: boolean
  activeRuntimeEnvironmentId: string | null
  worktreeConnectionId: string | null
  activeRepoId: LocalRuntimeState['activeRepoId']
  activeWorktreeId: LocalRuntimeState['activeWorktreeId']
  projects: LocalRuntimeState['projects']
  repos: LocalRuntimeState['repos']
  settings: LocalRuntimeState['settings']
  worktreesByRepo: LocalRuntimeState['worktreesByRepo']
  worktreeId: string
  wslAvailable: LocalRuntimeWslContext['wslAvailable']
  availableWslDistros: LocalRuntimeWslContext['availableWslDistros']
  loading: boolean
}): ProjectExecutionRuntimeResolution | undefined {
  if (
    !args.showWindowsShellMenu ||
    args.activeRuntimeEnvironmentId?.trim() ||
    args.worktreeConnectionId
  ) {
    return undefined
  }
  return getLocalProjectExecutionRuntimeContext(
    {
      activeRepoId: args.activeRepoId,
      activeWorktreeId: args.activeWorktreeId,
      projects: args.projects,
      repos: args.repos,
      settings: args.settings,
      worktreesByRepo: args.worktreesByRepo
    },
    args.worktreeId,
    'win32',
    {
      wslAvailable: args.loading ? undefined : args.wslAvailable,
      availableWslDistros: args.loading ? null : args.availableWslDistros
    }
  )
}
