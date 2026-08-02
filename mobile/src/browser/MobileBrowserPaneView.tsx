import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type PanResponderInstance
} from 'react-native'
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import type { MobileBrowserViewMode } from './browser-screencast-request'
import type {
  BrowserFrameGeometry,
  BrowserPoint,
  BrowserTouchLayout,
  BrowserZoomState
} from './browser-touch-geometry'
import {
  buttonColor,
  styles,
  type FrameLayer
} from './mobile-browser-pane-support'
import {
  MobileBrowserPointerModifiers,
  type BrowserPointerModifier
} from './MobileBrowserPointerModifiers'
import { MobileBrowserKeyRow } from './MobileBrowserKeyRow'
import { MobileBrowserToolbarIconButton } from './MobileBrowserToolbarIconButton'
import { MobileBrowserViewModeSwitch } from './MobileBrowserViewModeSwitch'

export type MobileBrowserPaneViewTab = {
  canGoBack: boolean
  canGoForward: boolean
}

export type MobileBrowserDialog = {
  dialogType: string
  message: string
}

type Props = {
  tab: MobileBrowserPaneViewTab
  controlsDisabled: boolean
  browserViewMode: MobileBrowserViewMode
  addressValue: string
  addressSelection: { start: number; end: number } | undefined
  keyboardValue: string
  pointerModifiers: BrowserPointerModifier[]
  keyboardLift: number
  bottomInset: number
  busy: boolean
  ready: boolean
  error: string | null
  dialog: MobileBrowserDialog | null
  zoom: BrowserZoomState
  layoutRef: { current: BrowserTouchLayout | null }
  frameGeometry: BrowserFrameGeometry | null
  renderedFrameSource: { uri: string } | null
  panResponder: PanResponderInstance
  setRootViewRef: (node: View | null) => void
  onAddressChange: (value: string) => void
  onAddressFocus: () => void
  onAddressBlur: () => void
  onAddressSubmit: () => void
  onKeyboardChange: (value: string) => void
  onKeyboardSubmit: () => void
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onViewModeChange: (mode: MobileBrowserViewMode) => void
  onViewportLayout: (layout: BrowserTouchLayout) => void
  onTogglePointerModifier: (modifier: BrowserPointerModifier) => void
  onKeypress: (key: string) => void
  onSendKeyboardText: () => void
  onDialogCommand: (method: 'browser.dialogAccept' | 'browser.dialogDismiss') => void
  frameLayerStyle: (layer: FrameLayer) => unknown
  browserLayerRef: (layer: FrameLayer) => (node: View | null) => void
  frameLayerRef: (layer: FrameLayer) => (image: Image | null) => void
  frameLayerLoadHandler: (layer: FrameLayer) => () => void
  frameLayerErrorHandler: (layer: FrameLayer) => () => void
}

export function MobileBrowserPaneView({
  tab,
  controlsDisabled,
  browserViewMode,
  addressValue,
  addressSelection,
  keyboardValue,
  pointerModifiers,
  keyboardLift,
  bottomInset,
  busy,
  ready,
  error,
  dialog,
  zoom,
  layoutRef,
  frameGeometry,
  renderedFrameSource,
  panResponder,
  setRootViewRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onAddressSubmit,
  onKeyboardChange,
  onKeyboardSubmit,
  onGoBack,
  onGoForward,
  onReload,
  onViewModeChange,
  onViewportLayout,
  onTogglePointerModifier,
  onKeypress,
  onSendKeyboardText,
  onDialogCommand,
  frameLayerStyle,
  browserLayerRef,
  frameLayerRef,
  frameLayerLoadHandler,
  frameLayerErrorHandler
}: Props) {
  return (
    <View ref={setRootViewRef} style={styles.root}>
      <View style={styles.toolbar}>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoBack}
          label="Back"
          onPress={onGoBack}
        >
          <ChevronLeft size={15} color={buttonColor(!controlsDisabled && tab.canGoBack)} />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton
          disabled={controlsDisabled || !tab.canGoForward}
          label="Forward"
          onPress={onGoForward}
        >
          <ChevronRight size={15} color={buttonColor(!controlsDisabled && tab.canGoForward)} />
        </MobileBrowserToolbarIconButton>
        <MobileBrowserToolbarIconButton disabled={controlsDisabled} label="Reload" onPress={onReload}>
          <RefreshCw size={15} color={buttonColor(!controlsDisabled)} />
        </MobileBrowserToolbarIconButton>
        <TextInput
          style={styles.addressInput}
          value={addressValue}
          onChangeText={onAddressChange}
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          onSubmitEditing={onAddressSubmit}
          selectTextOnFocus
          selection={addressSelection}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
          numberOfLines={1}
          returnKeyType="go"
          placeholder="URL"
          placeholderTextColor={colors.textMuted}
          editable={!controlsDisabled}
        />
        <MobileBrowserViewModeSwitch
          disabled={controlsDisabled}
          value={browserViewMode}
          onChange={onViewModeChange}
        />
      </View>

      <View
        style={styles.viewport}
        onLayout={(event) => {
          const next = {
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height
          }
          const current = layoutRef.current
          if (current && current.width === next.width && current.height === next.height) {
            return
          }
          onViewportLayout(next)
        }}
        {...panResponder.panHandlers}
      >
        {renderedFrameSource ? (
          <View style={styles.browserImageHost}>
            {frameGeometry ? (
              <View
                pointerEvents="none"
                style={[
                  styles.browserZoomOffset,
                  {
                    width: frameGeometry.renderedWidth,
                    height: frameGeometry.renderedHeight,
                    transform: [{ translateX: zoom.offsetX }, { translateY: zoom.offsetY }]
                  }
                ]}
              >
                <View
                  style={[
                    styles.browserFrameBox,
                    {
                      width: frameGeometry.renderedWidth,
                      height: frameGeometry.renderedHeight,
                      transform: [{ scale: zoom.scale }]
                    }
                  ]}
                >
                  {([0, 1] as const).map((layer) => (
                    <View
                      key={layer}
                      ref={browserLayerRef(layer)}
                      pointerEvents="none"
                      style={frameLayerStyle(layer)}
                    >
                      <Image
                        ref={frameLayerRef(layer)}
                        source={renderedFrameSource}
                        resizeMode="stretch"
                        fadeDuration={0}
                        onLoad={frameLayerLoadHandler(layer)}
                        onError={frameLayerErrorHandler(layer)}
                        style={[
                          styles.browserImage,
                          {
                            width: frameGeometry.renderedWidth,
                            height: frameGeometry.renderedHeight
                          }
                        ]}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              ([0, 1] as const).map((layer) => (
                <View
                  key={layer}
                  ref={browserLayerRef(layer)}
                  pointerEvents="none"
                  style={frameLayerStyle(layer)}
                >
                  <Image
                    ref={frameLayerRef(layer)}
                    source={renderedFrameSource}
                    resizeMode="contain"
                    fadeDuration={0}
                    onLoad={frameLayerLoadHandler(layer)}
                    onError={frameLayerErrorHandler(layer)}
                    style={styles.browserImageFill}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
        {!renderedFrameSource || busy || error ? (
          <View pointerEvents="none" style={styles.overlay}>
            {busy || (!ready && !error) ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : null}
        {dialog ? (
          <View style={styles.dialogOverlay}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>Browser Dialog</Text>
              <Text style={styles.dialogMessage}>{dialog.message}</Text>
              <View style={styles.dialogActions}>
                {dialog.dialogType !== 'alert' ? (
                  <Pressable
                    style={({ pressed }) => [styles.dialogButton, pressed && styles.dialogButtonPressed]}
                    onPress={() => onDialogCommand('browser.dialogDismiss')}
                  >
                    <Text style={styles.dialogButtonText}>Cancel</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.dialogButton,
                    styles.dialogButtonPrimary,
                    pressed && styles.dialogButtonPressed
                  ]}
                  onPress={() => onDialogCommand('browser.dialogAccept')}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogButtonPrimaryText]}>OK</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.keyboardDock,
          { paddingBottom: bottomInset, transform: [{ translateY: -keyboardLift }] }
        ]}
      >
        <MobileBrowserPointerModifiers
          disabled={controlsDisabled}
          selectedModifiers={pointerModifiers}
          onToggle={onTogglePointerModifier}
        />
        <MobileBrowserKeyRow disabled={controlsDisabled} onKeypress={onKeypress} />
        <View style={styles.inputRow}>
          <TextInput
            style={styles.keyboardInput}
            value={keyboardValue}
            onChangeText={onKeyboardChange}
            placeholder="Type on page…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!controlsDisabled}
            onSubmitEditing={onKeyboardSubmit}
          />
          <Pressable
            style={[styles.sendButton, (controlsDisabled || !keyboardValue) && styles.disabled]}
            disabled={controlsDisabled || !keyboardValue}
            onPress={onSendKeyboardText}
            accessibilityLabel="Send text to browser"
          >
            <ArrowUp size={18} color={buttonColor(!controlsDisabled && !!keyboardValue)} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}
