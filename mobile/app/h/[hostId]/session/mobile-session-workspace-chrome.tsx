import { SafeAreaView, Pressable, ScrollView, Text, View } from 'react-native'
import {
  ChevronLeft,
  File,
  FileText,
  Folder,
  GitBranch,
  Globe,
  MoreHorizontal,
  Plus
} from 'lucide-react-native'
import { MobileAgentIcon } from '../../../../src/components/MobileAgentIcon'
import { StatusDot } from '../../../../src/components/StatusDot'
import { MobileSessionHeaderIconButton } from '../../../../src/session/MobileSessionHeaderIconButton'
import { QuickCommandsTabButton } from './QuickCommandsTabButton'
import { colors } from '../../../../src/theme/mobile-theme'
import { styles } from './mobile-session-styles'

type WorkspaceContext = Record<string, any>

export function renderMobileSessionChrome(context: WorkspaceContext) {
  const {
    setMobileSessionRootRef,
    requestLeaveSession,
    styles: styleOverride = styles,
    colors: colorOverride = colors,
    worktreeName,
    showConnectionRetry,
    hostId,
    forceReconnectHost,
    connState,
    terminalSummary,
    isFloatingWorkspaceRoute,
    activePanel,
    handlePanelTap,
    isFolderWorkspaceRoute,
    showHeaderMoreButton,
    setShowHeaderMoreActions,
    visibleTabs,
    tabStripRef,
    tabStripOffsetRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    scrollActiveTabIntoView,
    activeSessionTabIdRef,
    tabLayoutsRef,
    activeSessionTabId,
    switchSessionTab,
    triggerMediumImpact,
    openSessionTabActionSheetAfterKeyboardDismiss,
    resolveMobileTerminalTabAgentId,
    getMobileSessionTabTitle,
    creating,
    creatingBrowser,
    creatingMarkdown,
    setCreateError,
    setShowCreateTabDrawer,
    quickCommandsSupported,
    setShowQuickCommands,
    showToast
  } = context
  const ui = styleOverride
  const palette = colorOverride
  return (
    <View ref={setMobileSessionRootRef} style={styles.container}>
      <View style={styles.kavInner}>
        <SafeAreaView style={styles.sessionChrome} edges={['top']}>
          <View style={styles.sessionTopBar}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={requestLeaveSession}
              hitSlop={8}
              accessibilityLabel="Back to worktrees"
            >
              <ChevronLeft size={22} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>

            <View style={styles.sessionTitleBlock}>
              <Text style={styles.sessionTitle} numberOfLines={1}>
                {worktreeName || 'Terminal'}
              </Text>
              <Pressable
                style={styles.sessionMetaRow}
                disabled={!showConnectionRetry}
                onPress={() => {
                  if (hostId) {
                    void forceReconnectHost(hostId)
                  }
                }}
                accessibilityRole={showConnectionRetry ? 'button' : undefined}
                accessibilityLabel={showConnectionRetry ? 'Reconnect to desktop' : undefined}
              >
                <StatusDot state={connState} />
                <Text style={styles.sessionMetaText} numberOfLines={1}>
                  {terminalSummary}
                </Text>
              </Pressable>
            </View>
            {!isFloatingWorkspaceRoute && (
              <MobileSessionHeaderIconButton
                active={activePanel === 'files'}
                accessibilityLabel="Open file explorer"
                icon={Folder}
                onPress={() => handlePanelTap('files')}
              />
            )}
            {!isFolderWorkspaceRoute && !isFloatingWorkspaceRoute && (
              <MobileSessionHeaderIconButton
                active={activePanel === 'sourceControl'}
                accessibilityLabel="Open source control"
                icon={GitBranch}
                onPress={() => handlePanelTap('sourceControl')}
              />
            )}
            {showHeaderMoreButton ? (
              <MobileSessionHeaderIconButton
                active={activePanel === 'pr'}
                accessibilityLabel="More session actions"
                icon={MoreHorizontal}
                onPress={() => setShowHeaderMoreActions(true)}
              />
            ) : null}
          </View>

          {visibleTabs.length > 0 && (
            <View style={styles.tabBar}>
              {/* Why: tab taps must register on first press with the keyboard open instead of being eaten by dismissal (#5106). */}
              <ScrollView
                ref={tabStripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tabScroll}
                contentContainerStyle={styles.tabContent}
                keyboardShouldPersistTaps="handled"
                scrollEventThrottle={16}
                onScroll={(e) => {
                  tabStripOffsetRef.current = e.nativeEvent.contentOffset.x
                }}
                onLayout={(e) => {
                  tabStripViewportWidthRef.current = e.nativeEvent.layout.width
                  scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
                }}
                onContentSizeChange={(width) => {
                  tabStripContentWidthRef.current = width
                  scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
                }}
              >
                {visibleTabs.map((t) => (
                  <Pressable
                    key={t.id}
                    style={[styles.tab, t.id === activeSessionTabId && styles.tabActive]}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout
                      tabLayoutsRef.current.set(t.id, { x, width })
                      if (t.id === activeSessionTabIdRef.current) {
                        scrollActiveTabIntoView(t.id, false)
                      }
                    }}
                    onPress={() => switchSessionTab(t)}
                    onLongPress={() => {
                      triggerMediumImpact()
                      openSessionTabActionSheetAfterKeyboardDismiss(t)
                    }}
                    delayLongPress={400}
                  >
                    <View style={styles.tabLabelRow}>
                      {t.type === 'browser' && (
                        <Globe size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'markdown' && (
                        <FileText size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'file' && (
                        <File size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'terminal' &&
                        (() => {
                          const agentId = resolveMobileTerminalTabAgentId(t)
                          return agentId ? <MobileAgentIcon agentId={agentId} size={13} /> : null
                        })()}
                      <Text
                        style={[
                          styles.tabText,
                          t.id === activeSessionTabId && styles.tabTextActive
                        ]}
                        numberOfLines={1}
                      >
                        {getMobileSessionTabTitle(t)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Why: pinned outside the scroll strip so the new-agent button stays reachable however far the tabs scroll. */}
              <Pressable
                style={({ pressed }) => [
                  styles.newTerminalButton,
                  pressed && styles.newTerminalButtonPressed,
                  (creating || creatingBrowser || creatingMarkdown || connState !== 'connected') &&
                    styles.newTerminalButtonDisabled
                ]}
                disabled={
                  creating || creatingBrowser || creatingMarkdown || connState !== 'connected'
                }
                onPress={() => {
                  setCreateError('')
                  setShowCreateTabDrawer(true)
                }}
                accessibilityLabel="New tab"
              >
                <Plus size={16} color={colors.textSecondary} strokeWidth={2.2} />
              </Pressable>
              {/* Why: stable placement matters, while old hosts must stay gated because they strip agentPrompt. */}
              <QuickCommandsTabButton
                disabled={
                  creating || creatingBrowser || creatingMarkdown || connState !== 'connected'
                }
                onPress={() => {
                  if (quickCommandsSupported === true) {
                    setShowQuickCommands(true)
                    return
                  }
                  showToast(
                    quickCommandsSupported === false
                      ? 'Desktop update required for quick commands'
                      : 'Checking desktop capabilities — try again in a moment',
                    1600
                  )
                }}
              />
            </View>
          )}
        </SafeAreaView>
  )
}
