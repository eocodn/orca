import { useMemo } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import {
  normalizeShortcutKeyInput,
  type TerminalShortcutModifier
} from '../terminal/terminal-accessory-keys'
import { colors } from '../theme/mobile-theme'
import {
  SHORTCUT_MODIFIERS,
  SPECIAL_KEY_BY_ID,
  SPECIAL_KEY_GROUPS
} from './custom-key-modal-data'
import { styles } from './custom-key-modal-styles'

type PickerProps = {
  onShortcut: () => void
  onMacro: () => void
  onManageShortcuts?: () => void
}

export function CustomKeyTypePicker({ onShortcut, onMacro, onManageShortcuts }: PickerProps) {
  return (
    <View style={styles.group}>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onShortcut}>
        <Text style={styles.rowLabel}>Shortcut Combo</Text>
        <Text style={styles.rowHint}>Build Ctrl, Alt, and Shift key chords</Text>
      </Pressable>
      <View style={styles.separator} />
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onMacro}>
        <Text style={styles.rowLabel}>Text Macro</Text>
        <Text style={styles.rowHint}>Send custom text command</Text>
      </Pressable>
      {onManageShortcuts ? (
        <>
          <View style={styles.separator} />
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onManageShortcuts}>
            <Text style={styles.rowLabel}>Manage Shortcuts</Text>
            <Text style={styles.rowHint}>Show, hide, or reorder shortcut keys</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  )
}

type ShortcutProps = {
  shortcutKey: string
  shortcutModifiers: TerminalShortcutModifier[]
  shortcutPreview: { label: string; bytes: string } | null
  onModifierToggle: (modifier: TerminalShortcutModifier) => void
  onKeyChange: (key: string) => void
  onSpecialKeys: () => void
  onSave: () => void
}

export function CustomKeyShortcutForm({
  shortcutKey,
  shortcutModifiers,
  shortcutPreview,
  onModifierToggle,
  onKeyChange,
  onSpecialKeys,
  onSave
}: ShortcutProps) {
  const orderedModifiers = useMemo(
    () => SHORTCUT_MODIFIERS.filter((modifier) => shortcutModifiers.includes(modifier.id)),
    [shortcutModifiers]
  )
  const previewKeyLabel = SPECIAL_KEY_BY_ID[shortcutKey]?.label ?? shortcutKey.toUpperCase()
  return (
    <View style={styles.shortcutForm}>
      <View style={styles.preview}>
        {orderedModifiers.map((modifier, index) => (
          <View key={modifier.id} style={styles.previewKeycapRow}>
            {index > 0 ? <Text style={styles.previewPlus}>+</Text> : null}
            <View style={[styles.keycap, styles.keycapModifier]}>
              <Text style={styles.keycapModifierText}>{modifier.label}</Text>
            </View>
          </View>
        ))}
        {orderedModifiers.length > 0 ? <Text style={styles.previewPlus}>+</Text> : null}
        <View style={[styles.keycap, !shortcutPreview && styles.keycapWarn]}>
          <Text style={[styles.keycapText, !shortcutPreview && styles.keycapTextWarn]}>{previewKeyLabel}</Text>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Modifiers</Text>
        <View style={styles.mods}>
          {SHORTCUT_MODIFIERS.map((modifier) => {
            const selected = shortcutModifiers.includes(modifier.id)
            return (
              <Pressable
                key={modifier.id}
                style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && styles.chipPressed]}
                onPress={() => onModifierToggle(modifier.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{modifier.label}</Text>
                {modifier.glyph ? <Text style={[styles.chipGlyph, selected && styles.chipGlyphSelected]}>{modifier.glyph}</Text> : null}
              </Pressable>
            )
          })}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Key</Text>
        <TextInput
          style={styles.keyInput}
          value={shortcutKey.length === 1 ? shortcutKey.toUpperCase() : ''}
          onChangeText={(value) => onKeyChange(value === '' ? '' : normalizeShortcutKeyInput(value) || shortcutKey)}
          placeholder={SPECIAL_KEY_BY_ID[shortcutKey]?.label ?? 'C'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={1}
        />
        <Pressable style={({ pressed }) => [styles.moreLink, pressed && styles.moreLinkPressed]} onPress={onSpecialKeys}>
          <Text style={styles.moreLinkText}>More keys — Tab, arrows, F1–F12…</Text>
        </Pressable>
      </View>
      <Pressable style={[styles.saveButton, !shortcutPreview && styles.saveButtonDisabled]} disabled={!shortcutPreview} onPress={onSave}>
        <Text style={[styles.saveButtonText, !shortcutPreview && styles.saveButtonTextDisabled]}>Add</Text>
      </Pressable>
    </View>
  )
}

export function CustomKeySpecialKeyPicker({ selectedKey, onPick }: { selectedKey: string; onPick: (id: string) => void }) {
  return (
    <View style={styles.specialKeysForm}>
      {SPECIAL_KEY_GROUPS.map((group) => (
        <View key={group.title} style={styles.specialGroup}>
          <Text style={styles.specialGroupTitle}>{group.title}</Text>
          <View style={styles.keyGrid}>
            {group.ids.map((id) => {
              const key = SPECIAL_KEY_BY_ID[id]
              if (!key) return null
              const selected = selectedKey === id
              return (
                <View key={id} style={[styles.keyCellWrap, { flexBasis: `${100 / group.columns}%` }]}>
                  <Pressable style={({ pressed }) => [styles.keyCell, selected && styles.keyCellSelected, pressed && !selected && styles.keyCellPressed]} onPress={() => onPick(id)} accessibilityLabel={key.accessibilityLabel} accessibilityState={{ selected }}>
                    <Text style={[styles.keyCellText, selected && styles.keyCellTextSelected]}>{key.label}</Text>
                  </Pressable>
                </View>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}

type MacroProps = { label: string; text: string; enter: boolean; onLabelChange: (value: string) => void; onTextChange: (value: string) => void; onEnterChange: (value: boolean) => void; onSave: () => void }
export function CustomKeyMacroForm({ label, text, enter, onLabelChange, onTextChange, onEnterChange, onSave }: MacroProps) {
  return (
    <View style={styles.group}>
      <View style={styles.macroForm}>
        <Text style={styles.fieldLabel}>Label</Text>
        <TextInput style={styles.fieldInput} value={label} onChangeText={onLabelChange} placeholder="e.g. Build" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} />
        <Text style={styles.fieldLabel}>Command</Text>
        <TextInput style={styles.fieldInput} value={text} onChangeText={onTextChange} placeholder="e.g. pnpm build" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Press Enter</Text>
          <Switch value={enter} onValueChange={onEnterChange} trackColor={{ false: colors.bgRaised, true: colors.textSecondary }} thumbColor={colors.textPrimary} />
        </View>
        <Pressable style={[styles.saveButton, !text.trim() && styles.saveButtonDisabled]} disabled={!text.trim()} onPress={onSave}>
          <Text style={[styles.saveButtonText, !text.trim() && styles.saveButtonTextDisabled]}>Add Shortcut</Text>
        </Pressable>
      </View>
    </View>
  )
}
