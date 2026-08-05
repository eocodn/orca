import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ChevronsRight,
  Keyboard as KeyboardIcon,
  X,
  Monitor,
  Plus,
  Smartphone
} from 'lucide-react-native'
import { MobileBrowserPane } from '../../../../src/browser/MobileBrowserPane'
import { MobileTerminalInputActions } from '../../../../src/session/MobileTerminalInputActions'
import { SessionDockColumn } from '../../../../src/session/SessionDockColumn'
import { TerminalPaneView } from '../../../../src/session/TerminalPaneView'
import { createTerminalLiveAccessoryInput } from '../../../../src/terminal/terminal-live-accessory-input'
import {
  getTerminalCommandKeyboardType,
  getTerminalLiveInputKeyboardType
} from '../../../../src/terminal/terminal-keyboard-type'
import { colors } from '../../../../src/theme/mobile-theme'
import { FileReader, MarkdownReader } from './mobile-session-file-readers'
import { styles } from './mobile-session-styles'
import { dismissMobileSessionCreateWarningState } from '../../../../src/session/mobile-session-create-warning-state'
import { isTerminalPhoneDisplayMode } from '../../../../src/session/mobile-session-route-helpers'
import { triggerMediumImpact } from '../../../../src/platform/haptics'

type WorkspaceContext = Record<string, any>

export function renderMobileSessionContent(context: WorkspaceContext) {
  const {
    client,
    worktreeId,
    hostId,
    worktreeName,
    connState,
    activePanel,
    sessionContentRowWidth,
    canDockPanel,
    setActivePanel,
    handleSessionContentRowLayout,
    createWarning,
    setCreateWarningState,
    showLoadingState,
    showEmptyState,
    createError,
    createTabBusy,
    setCreateError,
    setShowCreateTabDrawer,
    toastMessage,
    toastAnimatedStyle,
    terminalModes,
    toggleLiveInput,
    canPaste,
    handlePaste,
    activeMarkdownTab,
    markdownDocs,
    readMarkdownTab,
    updateMarkdownLocalContent,
    saveMarkdownTab,
    copyMarkdownLocalContent,
    discardMarkdownLocalContent,
    keyboardLift,
    activeFileTab,
    fileDocs,
    addDiffCommentForFile,
    deleteDiffCommentForFile,
    copyDiffCommentsToClipboard,
    sendDiffCommentsToAgent,
    diffComments,
    diffCommentBusy,
    activeBrowserTab,
    browserScreencastSupported,
    insets,
    showToast,
    activePendingTerminalTab,
    terminals,
    terminalFrameHeightRef,
    setTerminalFrameWidth,
    notifyTerminalFrameHeight,
    activeHandle,
    activeTerminalKeyboardLift,
    terminalTextScale,
    setTerminalTextScale,
    saveTerminalTextScale,
    setTerminalWebViewRef,
    handleTerminalWebReady,
    handleSelectionMode,
    handleSelectionCopy,
    handleSelectionEvicted,
    handleModesChanged,
    handleKeyboardAvoidanceMetrics,
    handleHaptic,
    handleTerminalInput,
    handleTerminalQueryReply,
    handleTerminalTap,
    handleFileTap,
    handleTerminalOpenUrl,
    dismissSoftwareKeyboard,
    canSend,
    toggleDisplayMode,
    handleAccessoryKey,
    startAccessoryRepeat,
    stopAccessoryRepeat,
    visibleBuiltInAccessoryKeys,
    customKeys,
    setDeleteKeyTarget,
    setShowCustomKeyModal,
    liveInputEnabled,
    focusLiveInput,
    isAttaching,
    liveInputRef,
    liveInputCapture,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    commandInputRef,
    autocompleteEnabled,
    input,
    setInput,
    canCompose,
    handleSend,
    handleFileOpenStart,
    handleOpenedFileDiff,
    attachImage,
  } = context
  return (
    <View style={styles.sessionContentRow} onLayout={handleSessionContentRowLayout}>
      <View style={styles.sessionContentMain}>
        {createWarning ? (
          <View style={styles.createWarningBanner}>
            <AlertTriangle size={16} color={colors.statusAmber} strokeWidth={2.2} />
            <Text style={styles.createWarningText}>{createWarning}</Text>
            <Pressable
              style={styles.createWarningDismiss}
              onPress={() => setCreateWarningState(dismissMobileSessionCreateWarningState)}
              accessibilityLabel="Dismiss workspace creation warning"
              hitSlop={8}
            >
              <X size={16} color={colors.textMuted} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}

        {showLoadingState ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : showEmptyState ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No tabs in this session</Text>
            {createError ? <Text style={styles.createError}>{createError}</Text> : null}
            <View style={styles.emptyActions}>
              <Pressable
                style={[
                  styles.createButton,
                  (createTabBusy || connState !== 'connected') && styles.createButtonDisabled
                ]}
                disabled={createTabBusy || connState !== 'connected'}
                onPress={() => {
                  setCreateError('')
                  setShowCreateTabDrawer(true)
                }}
              >
                <Text style={styles.createButtonText}>
                  {createTabBusy ? 'Creating...' : 'Create Tab'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : activeMarkdownTab ? (
          <View style={styles.markdownFrame}>
            <MarkdownReader
              documentId={activeMarkdownTab.id}
              doc={markdownDocs.get(activeMarkdownTab.id)}
              onRefresh={() => void readMarkdownTab(activeMarkdownTab)}
              onChange={(content) => updateMarkdownLocalContent(activeMarkdownTab.id, content)}
              onSave={() => void saveMarkdownTab(activeMarkdownTab)}
              onCopy={() => void copyMarkdownLocalContent(activeMarkdownTab.id)}
              onDiscard={() => discardMarkdownLocalContent(activeMarkdownTab)}
              keyboardLift={keyboardLift}
            />
            {toastMessage && (
              <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                <Text style={styles.toastText}>{toastMessage}</Text>
              </Animated.View>
            )}
          </View>
        ) : activeFileTab ? (
          <View style={styles.markdownFrame}>
            <FileReader
              doc={fileDocs.get(activeFileTab.id)}
              title={activeFileTab.title || 'File'}
              relativePath={activeFileTab.relativePath}
              language={activeFileTab.language}
              diffCommentActions={
                activeFileTab.diffSource === 'staged' || activeFileTab.diffSource === 'unstaged'
                  ? {
                      comments: diffComments,
                      busy: diffCommentBusy,
                      onAdd: addDiffCommentForFile,
                      onDelete: deleteDiffCommentForFile,
                      onCopyAll: copyDiffCommentsToClipboard,
                      onSendAll: sendDiffCommentsToAgent
                    }
                  : undefined
              }
            />
            {toastMessage && (
              <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                <Text style={styles.toastText}>{toastMessage}</Text>
              </Animated.View>
            )}
          </View>
        ) : activeBrowserTab ? (
          <View style={styles.browserFrame}>
            {/* Why: pane owns imperative frame refs; don't render a stale frame while the old stream effect cleans up. */}
            <MobileBrowserPane
              key={activeBrowserTab.browserPageId ?? activeBrowserTab.id}
              client={client}
              worktreeId={worktreeId}
              tab={activeBrowserTab}
              screencastSupported={browserScreencastSupported}
              keyboardLift={keyboardLift}
              bottomInset={insets.bottom}
              onToast={showToast}
            />
            {toastMessage && (
              <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                <Text style={styles.toastText}>{toastMessage}</Text>
              </Animated.View>
            )}
          </View>
        ) : activePendingTerminalTab ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.emptyText}>
              {activePendingTerminalTab.title || 'Loading terminal'}
            </Text>
          </View>
        ) : (
          <View
            style={styles.terminalFrame}
            onLayout={(e) => {
              terminalFrameHeightRef.current = e.nativeEvent.layout.height
              // Why: notify height imperatively so dock settling re-fits the PTY without rerendering SessionScreen.
              const nextWidth = Math.round(e.nativeEvent.layout.width)
              const nextHeight = Math.round(e.nativeEvent.layout.height)
              setTerminalFrameWidth((prev) => (prev === nextWidth ? prev : nextWidth))
              notifyTerminalFrameHeight(nextHeight)
            }}
          >
            {terminals.map((terminal) => (
              <TerminalPaneView
                key={terminal.handle}
                handle={terminal.handle}
                active={terminal.handle === activeHandle}
                keyboardLift={terminal.handle === activeHandle ? activeTerminalKeyboardLift : 0}
                terminalTheme={terminal.terminalTheme}
                textScale={terminalTextScale}
                onTextScaleChange={(scale) => {
                  // Why: pinch-to-zoom reports a new preset; persist it so the size sticks across panes and launches.
                  setTerminalTextScale(scale)
                  void saveTerminalTextScale(scale)
                }}
                onRef={setTerminalWebViewRef}
                onWebReady={handleTerminalWebReady}
                onSelectionMode={handleSelectionMode}
                onSelectionCopy={handleSelectionCopy}
                onSelectionEvicted={handleSelectionEvicted}
                onModesChanged={handleModesChanged}
                onKeyboardAvoidanceMetrics={handleKeyboardAvoidanceMetrics}
                onHaptic={handleHaptic}
                onTerminalInput={handleTerminalInput}
                onTerminalQueryReply={handleTerminalQueryReply}
                onTerminalTap={handleTerminalTap}
                onFileTap={handleFileTap}
                onOpenUrl={handleTerminalOpenUrl}
              />
            ))}
            {toastMessage && (
              <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                <Text style={styles.toastText}>{toastMessage}</Text>
              </Animated.View>
            )}
          </View>
        )}

        {/* Why: translate instead of resize so keyboard toggles don't trigger a server-side PTY viewport change. */}
        {!activeMarkdownTab && !activeFileTab && !activeBrowserTab && (
          <View
            style={[
              styles.commandDock,
              { paddingBottom: insets.bottom, transform: [{ translateY: -keyboardLift }] }
            ]}
          >
            {/* Accessory keys */}
            <View style={styles.accessoryBar}>
              {/* Why: fixed keyboard escape hatch; outside ScrollView + shortcut path so it can't scroll away or be hidden (#5106). */}
              {keyboardLift > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.keyboardDismissKey,
                    pressed && styles.accessoryKeyPressed
                  ]}
                  onPress={dismissSoftwareKeyboard}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss keyboard"
                  accessibilityHint="Hides the software keyboard and keeps the current terminal session open."
                >
                  <View style={styles.keyboardDismissGlyph}>
                    <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
                    <ChevronDown
                      size={10}
                      color={colors.textSecondary}
                      strokeWidth={2.5}
                      style={styles.keyboardDismissChevron}
                    />
                  </View>
                </Pressable>
              )}
              {/* Why: default tap handling makes the first accessory-key tap dismiss the keyboard and get swallowed (#5106). */}
              <ScrollView
                style={styles.accessoryScroll}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.accessoryContent}
                keyboardShouldPersistTaps="always"
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.accessoryKey,
                    pressed && styles.accessoryKeyPressed,
                    !canSend && styles.accessoryKeyDisabled
                  ]}
                  disabled={!canSend}
                  onPress={() => {
                    if (activeHandle) {
                      void toggleDisplayMode(activeHandle)
                    }
                  }}
                  accessibilityLabel={
                    isTerminalPhoneDisplayMode(activeHandle, terminalModes)
                      ? 'Switch to desktop mode'
                      : 'Switch to phone mode'
                  }
                >
                  {isTerminalPhoneDisplayMode(activeHandle, terminalModes) ? (
                    <Monitor size={14} color={canSend ? colors.textSecondary : colors.textMuted} />
                  ) : (
                    <Smartphone
                      size={14}
                      color={canSend ? colors.textSecondary : colors.textMuted}
                    />
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.accessoryKey,
                    liveInputEnabled && styles.accessoryKeyActive,
                    pressed && styles.accessoryKeyPressed,
                    !canCompose && styles.accessoryKeyDisabled
                  ]}
                  // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
                  disabled={!canCompose}
                  onPress={toggleLiveInput}
                  accessibilityLabel={
                    liveInputEnabled
                      ? 'Switch to buffered command input'
                      : 'Switch to live terminal input'
                  }
                >
                  <ChevronsRight
                    size={14}
                    color={
                      liveInputEnabled
                        ? colors.bgBase
                        : canCompose
                          ? colors.textSecondary
                          : colors.textMuted
                    }
                  />
                </Pressable>
                {canPaste && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.accessoryKey,
                      pressed && styles.accessoryKeyPressed,
                      !canSend && styles.accessoryKeyDisabled
                    ]}
                    disabled={!canSend}
                    onPress={() => void handlePaste()}
                    accessibilityLabel="Paste from clipboard"
                  >
                    <Text
                      style={[styles.accessoryKeyText, !canSend && styles.accessoryKeyTextDisabled]}
                    >
                      Paste
                    </Text>
                  </Pressable>
                )}
                {visibleBuiltInAccessoryKeys.map((key) => (
                  <Pressable
                    key={key.id}
                    style={({ pressed }) => [
                      styles.accessoryKey,
                      pressed && styles.accessoryKeyPressed,
                      !canSend && styles.accessoryKeyDisabled
                    ]}
                    disabled={!canSend}
                    onPressIn={() => {
                      if (!key.repeatable) {
                        return
                      }
                      const input = createTerminalLiveAccessoryInput(key)
                      void handleAccessoryKey(input)
                      startAccessoryRepeat(input)
                    }}
                    onPressOut={() => {
                      if (key.repeatable) {
                        stopAccessoryRepeat()
                      }
                    }}
                    onPress={() => {
                      if (key.repeatable) {
                        return
                      }
                      void handleAccessoryKey(createTerminalLiveAccessoryInput(key))
                    }}
                    accessibilityLabel={key.accessibilityLabel ?? `Send ${key.label}`}
                  >
                    <Text
                      style={[styles.accessoryKeyText, !canSend && styles.accessoryKeyTextDisabled]}
                    >
                      {key.label}
                    </Text>
                  </Pressable>
                ))}
                {customKeys.map((key) => (
                  <Pressable
                    key={key.id}
                    style={({ pressed }) => [
                      styles.accessoryKey,
                      styles.customAccessoryKey,
                      pressed && styles.accessoryKeyPressed,
                      !canSend && styles.accessoryKeyDisabled
                    ]}
                    disabled={!canSend}
                    onPress={() => void handleAccessoryKey({ bytes: key.bytes })}
                    onLongPress={() => {
                      triggerMediumImpact()
                      setDeleteKeyTarget(key)
                    }}
                    delayLongPress={400}
                    accessibilityLabel={`Send ${key.label}`}
                  >
                    <Text
                      style={[styles.accessoryKeyText, !canSend && styles.accessoryKeyTextDisabled]}
                    >
                      {key.label}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [
                    styles.accessoryKey,
                    pressed && styles.accessoryKeyPressed
                  ]}
                  onPress={() => setShowCustomKeyModal(true)}
                  accessibilityLabel="Add custom shortcut"
                >
                  <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
                </Pressable>
              </ScrollView>
            </View>

            {/* Input bar */}
            {liveInputEnabled ? (
              <View style={[styles.inputBar, styles.liveInputBar]}>
                <Pressable
                  style={({ pressed }) => [
                    styles.liveInputFocusTarget,
                    pressed && styles.liveInputFocusTargetPressed,
                    !canSend && styles.liveInputFocusTargetDisabled
                  ]}
                  disabled={!canSend}
                  onPress={focusLiveInput}
                  accessibilityRole="button"
                  accessibilityLabel="Show keyboard for live terminal input"
                  accessibilityHint="Typed text is sent directly to the active terminal"
                >
                  <KeyboardIcon size={16} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
                <MobileTerminalInputActions
                  canSend={canSend}
                  isAttaching={isAttaching}
                  buttonStyle={styles.attachButton}
                  disabledButtonStyle={styles.sendButtonDisabled}
                  onAttachImage={() => void attachImage('library')}
                  onAttachFile={() => void attachImage('files')}
                />
                <TextInput
                  ref={liveInputRef}
                  style={styles.liveInputCapture}
                  value={liveInputCapture}
                  onChangeText={handleLiveInputChange}
                  onKeyPress={handleLiveInputKeyPress}
                  onSubmitEditing={handleLiveInputSubmit}
                  placeholder=""
                  showSoftInputOnFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  smartInsertDelete={false}
                  // Keep IME switching available for the Android live-input capture.
                  autoComplete="off"
                  keyboardType={getTerminalLiveInputKeyboardType(Platform.OS)}
                  returnKeyType="default"
                  blurOnSubmit={false}
                  editable={canSend}
                  importantForAutofill="no"
                />
              </View>
            ) : (
              <View style={styles.inputBar}>
                <TextInput
                  ref={commandInputRef}
                  // Android caches IME inputType at mount, so toggling autocomplete must remount there.
                  key={
                    Platform.OS === 'android'
                      ? autocompleteEnabled
                        ? 'cmd-input-ac-on'
                        : 'cmd-input-ac-off'
                      : 'cmd-input'
                  }
                  style={styles.textInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type a command…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={autocompleteEnabled}
                  spellCheck={autocompleteEnabled}
                  smartInsertDelete={false}
                  // Why: not autofill content, but keyboard must stay default so non-Latin IMEs remain selectable.
                  autoComplete="off"
                  keyboardType={getTerminalCommandKeyboardType(Platform.OS, autocompleteEnabled)}
                  returnKeyType="send"
                  // Why: composing is local — an outage must not lock the field or discard typed text (#6713).
                  editable={canCompose}
                  onSubmitEditing={() => void handleSend()}
                />
                <MobileTerminalInputActions
                  canSend={canSend}
                  isAttaching={isAttaching}
                  buttonStyle={styles.attachButton}
                  disabledButtonStyle={styles.sendButtonDisabled}
                  onAttachImage={() => void attachImage('library')}
                  onAttachFile={() => void attachImage('files')}
                />
                <Pressable
                  style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                  disabled={!canSend}
                  onPress={() => void handleSend()}
                  accessibilityLabel="Send command"
                >
                  <ArrowUp size={18} color={colors.textSecondary} strokeWidth={2.5} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
      {canDockPanel && activePanel !== null && (
        <SessionDockColumn
          activePanel={activePanel}
          hostId={hostId}
          worktreeId={worktreeId}
          name={worktreeName || ''}
          availableWidth={sessionContentRowWidth}
          onRequestClose={() => setActivePanel(null)}
          onFileOpenStart={handleFileOpenStart}
          onOpenedFileDiff={handleOpenedFileDiff}
        />
      )}
    </View>
  )
}
