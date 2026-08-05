import { GitBranch } from 'lucide-react-native'
import type { ActionSheetAction } from './components/ActionSheetModal'

type Args = {
  hostId: string
  worktreeId: string
  worktreeName: string
  hostCapabilities?: readonly string[]
  navigate: (target: string) => void
  onDone: () => void
}

export function buildWorktreeNavigationActions(args: Args): ActionSheetAction[] {
  return [
    {
      label: 'Source Control',
      icon: GitBranch,
      onPress: () => {
        const params = new URLSearchParams({ name: args.worktreeName, origin: 'host' })
        args.navigate(
          `/h/${args.hostId}/source-control/${encodeURIComponent(args.worktreeId)}?${params.toString()}`
        )
        args.onDone()
      }
    }
  ]
}
