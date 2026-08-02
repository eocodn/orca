import { View } from 'react-native'
import { useMobileSessionWorkspaceSetup } from './mobile-session-workspace-setup'
import { useMobileSessionWorkspaceTerminal } from './mobile-session-workspace-terminal'
import { useMobileSessionWorkspaceTabReconciliation } from './mobile-session-workspace-tab-reconciliation'
import { useMobileSessionWorkspaceBehavior } from './mobile-session-workspace-behavior'
import { useMobileSessionWorkspaceSurface } from './mobile-session-workspace-surface'
import { renderMobileSessionChrome } from './mobile-session-workspace-chrome'
import { renderMobileSessionContent } from './mobile-session-workspace-content'
import { renderMobileSessionModals } from './mobile-session-workspace-modals'
import { styles } from './mobile-session-styles'

export default function SessionScreen() {
  const setup = useMobileSessionWorkspaceSetup()
  const terminal = useMobileSessionWorkspaceTerminal({ ...setup })
  const tabs = useMobileSessionWorkspaceTabReconciliation({ ...setup, ...terminal })
  const behavior = useMobileSessionWorkspaceBehavior({ ...setup, ...terminal, ...tabs })
  const surface = useMobileSessionWorkspaceSurface({ ...setup, ...terminal, ...tabs, ...behavior })
  const context = { ...setup, ...terminal, ...tabs, ...behavior, ...surface, styles }

  return (
    <View ref={context.setMobileSessionRootRef} style={styles.container}>
      <View style={styles.kavInner}>
        {renderMobileSessionChrome(context)}
        {renderMobileSessionContent(context)}
      </View>
      {renderMobileSessionModals(context)}
    </View>
  )
}
