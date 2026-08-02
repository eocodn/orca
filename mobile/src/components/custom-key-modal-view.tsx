import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react-native'
import { View, Text, Pressable } from 'react-native'
import { colors } from '../theme/mobile-theme'
import { BottomDrawer } from './BottomDrawer'
import {
  buildTerminalShortcutKey,
  type TerminalShortcutModifier
} from '../terminal/terminal-accessory-keys'
import {
  loadCustomKeys,
  saveCustomKeys,
  type CustomKey,
  type CustomKeyModalStep
} from './custom-key-modal-data'
import { styles } from './custom-key-modal-styles'
import {
  CustomKeyMacroForm,
  CustomKeyShortcutForm,
  CustomKeyTypePicker,
  CustomKeySpecialKeyPicker
} from './custom-key-modal-forms'

export type { CustomKey } from './custom-key-modal-data'
export { loadCustomKeys, saveCustomKeys } from './custom-key-modal-data'

type Props = {
  visible: boolean
  onClose: () => void
  onKeysChanged: (keys: CustomKey[]) => void
  onManageShortcuts?: () => void
}

export function CustomKeyModal({ visible, onClose, onKeysChanged, onManageShortcuts }: Props) {
  const [step, setStep] = useState<CustomKeyModalStep>('choose-type')
  const [shortcutKey, setShortcutKey] = useState('c')
  const [shortcutModifiers, setShortcutModifiers] = useState<TerminalShortcutModifier[]>(['ctrl'])
  const [macroLabel, setMacroLabel] = useState('')
  const [macroText, setMacroText] = useState('')
  const [macroEnter, setMacroEnter] = useState(true)
  const [previousVisible, setPreviousVisible] = useState(visible)

  if (visible !== previousVisible) {
    setPreviousVisible(visible)
    if (visible) {
      setStep('choose-type')
      setShortcutKey('c')
      setShortcutModifiers(['ctrl'])
      setMacroLabel('')
      setMacroText('')
      setMacroEnter(true)
    }
  }

  const addKey = useCallback(
    async (key: Omit<CustomKey, 'id'>) => {
      const existing = await loadCustomKeys()
      const updated = [...existing, { ...key, id: `custom-${Date.now()}` }]
      await saveCustomKeys(updated)
      onKeysChanged(updated)
      onClose()
    },
    [onClose, onKeysChanged]
  )
  const shortcutPreview = useMemo(
    () => buildTerminalShortcutKey({ key: shortcutKey, modifiers: shortcutModifiers }),
    [shortcutKey, shortcutModifiers]
  )
  const showBack = step !== 'choose-type'
  const onBack = useCallback(() => {
    setStep(step === 'special-keys' ? 'shortcut-combo' : 'choose-type')
  }, [step])

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            onPress={onBack}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={18} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.backSpacer} />
        )}
        <Text style={styles.title}>
          {step === 'choose-type' && 'Add Shortcut'}
          {step === 'shortcut-combo' && 'Shortcut Combo'}
          {step === 'special-keys' && 'Pick a key'}
          {step === 'text-macro' && 'Text Macro'}
        </Text>
        <View style={styles.backSpacer} />
      </View>
      {step === 'choose-type' && (
        <CustomKeyTypePicker
          onShortcut={() => setStep('shortcut-combo')}
          onMacro={() => setStep('text-macro')}
          onManageShortcuts={onManageShortcuts}
        />
      )}
      {step === 'shortcut-combo' && (
        <CustomKeyShortcutForm
          shortcutKey={shortcutKey}
          shortcutModifiers={shortcutModifiers}
          shortcutPreview={shortcutPreview}
          onModifierToggle={(modifier) =>
            setShortcutModifiers((current) =>
              current.includes(modifier)
                ? current.filter((item) => item !== modifier)
                : [...current, modifier]
            )
          }
          onKeyChange={setShortcutKey}
          onSpecialKeys={() => setStep('special-keys')}
          onSave={() => {
            if (shortcutPreview) {
              void addKey({ label: shortcutPreview.label, bytes: shortcutPreview.bytes, enter: false })
            }
          }}
        />
      )}
      {step === 'special-keys' && (
        <CustomKeySpecialKeyPicker
          selectedKey={shortcutKey}
          onPick={(id) => {
            setShortcutKey(id)
            setStep('shortcut-combo')
          }}
        />
      )}
      {step === 'text-macro' && (
        <CustomKeyMacroForm
          label={macroLabel}
          text={macroText}
          enter={macroEnter}
          onLabelChange={setMacroLabel}
          onTextChange={setMacroText}
          onEnterChange={setMacroEnter}
          onSave={() => {
            const label = macroLabel.trim() || macroText.trim().slice(0, 12)
            if (label && macroText) {
              void addKey({ label, bytes: macroEnter ? `${macroText}\r` : macroText, enter: false })
            }
          }}
        />
      )}
    </BottomDrawer>
  )
}
