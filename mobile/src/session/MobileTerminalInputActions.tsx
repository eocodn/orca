import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { ImagePlus } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'

type MobileTerminalInputActionsProps = {
  readonly canSend: boolean
  readonly isAttaching: boolean
  readonly buttonStyle: StyleProp<ViewStyle>
  readonly disabledButtonStyle: StyleProp<ViewStyle>
  readonly onAttachImage: () => void
  readonly onAttachFile: () => void
}

// Image attachment action shared by live and buffered input bars.
export function MobileTerminalInputActions({
  canSend,
  isAttaching,
  buttonStyle,
  disabledButtonStyle,
  onAttachImage,
  onAttachFile
}: MobileTerminalInputActionsProps) {
  return (
    <>
      <Pressable
        style={[buttonStyle, (!canSend || isAttaching) && disabledButtonStyle]}
        disabled={!canSend || isAttaching}
        // Tap opens the photo library; long-press picks a file. Uploads via host
        // RPC so SSH/remote sessions attach the same as local ones.
        onPress={onAttachImage}
        onLongPress={onAttachFile}
        delayLongPress={350}
        accessibilityLabel={isAttaching ? 'Sending image' : 'Attach a photo'}
        accessibilityHint="Long press to attach a file instead"
      >
        {isAttaching ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <ImagePlus size={17} color={colors.textSecondary} strokeWidth={2.4} />
        )}
      </Pressable>
    </>
  )
}
