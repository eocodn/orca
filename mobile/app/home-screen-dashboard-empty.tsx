import { View, Text, Pressable } from 'react-native'
import { QrCode } from 'lucide-react-native'
import type { EdgeInsets } from 'react-native-safe-area-context'
import { colors } from '../src/theme/mobile-theme'
import { ONBOARDING_STEPS, styles } from '../src/home-screen-styles'

type Props = {
  insets: EdgeInsets
  isWideLayout: boolean
  contentMaxWidth: number
  onPair: () => void
}

export function HomeScreenDashboardEmpty({
  insets,
  isWideLayout,
  contentMaxWidth,
  onPair
}: Props) {
  return (
    <View
      style={[
        styles.emptyContainer,
        { paddingBottom: insets.bottom },
        isWideLayout && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
      ]}
    >
      <View style={styles.emptyHero}>
        <Text style={styles.emptyTitle}>Connect your desktop</Text>
        <Text style={styles.emptyBody}>
          Pair with Orca on your computer to check on your agents, jump into any terminal, and
          drive work from your phone.
        </Text>
        <Pressable style={styles.primaryButton} onPress={onPair}>
          <QrCode size={17} color={colors.bgBase} />
          <Text style={styles.primaryButtonText}>Pair Desktop</Text>
        </Pressable>
      </View>

      <View style={styles.stepsSection}>
        <Text style={styles.sectionHeading}>How it works</Text>
        {ONBOARDING_STEPS.map((step, index) => (
          <View key={step.title} style={[styles.stepRow, index > 0 && styles.stepRowBorder]}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{index + 1}</Text>
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDesc}>{step.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}