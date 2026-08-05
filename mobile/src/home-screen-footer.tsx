import { useRouter } from 'expo-router'
import { View, Text, Pressable } from 'react-native'
import { ChevronRight, ListTodo, Plus, QrCode, Terminal } from 'lucide-react-native'
import { TaskProviderLogo } from './components/TaskProviderLogo'
import type { HostProfile } from './transport/types'
import type { TaskProvider } from './tasks/mobile-task-providers'
import { repoColor, TASK_PROVIDER_LABELS, type WorktreeSummary } from './home-screen-data'
import { colors, spacing } from './theme/mobile-theme'
import { styles } from './home-screen-styles'

export type HomeScreenFooterProps = {
  resumeWorktree: { hostId: string; worktree: WorktreeSummary } | null
  primaryConnectedHost: HostProfile | null
  primaryTaskProviders: TaskProvider[]
  openTasks: (provider?: TaskProvider) => void
}

export function HomeScreenFooter({ resumeWorktree, primaryConnectedHost, primaryTaskProviders, openTasks }: HomeScreenFooterProps) {
  const router = useRouter()
const renderTaskHomeCard = () => (
  <Pressable
    disabled={!primaryConnectedHost}
    style={({ pressed }) => [
      styles.taskHomeCard,
      !primaryConnectedHost && styles.quickActionDisabled,
      pressed && styles.hostCardPressed
    ]}
    onPress={() => {
      openTasks()
    }}
  >
    <View style={styles.taskHomeIcon}>
      <ListTodo size={18} color={colors.textSecondary} />
    </View>
    <View style={styles.taskHomeMain}>
      <Text style={styles.taskHomeTitle}>Tasks</Text>
      <Text style={styles.taskHomeSubtitle} numberOfLines={1}>
        {primaryTaskProviders.length > 0
          ? primaryTaskProviders.map((provider) => TASK_PROVIDER_LABELS[provider]).join(' · ')
          : 'No task sources connected'}
      </Text>
    </View>
    <View style={styles.taskHomeTrailing}>
      <View
        style={styles.taskHomeProviderRow}
        accessibilityLabel={primaryTaskProviders
          .map((provider) => TASK_PROVIDER_LABELS[provider])
          .join(', ')}
      >
        {primaryTaskProviders.map((provider) => (
          <Pressable
            key={provider}
            accessibilityRole="button"
            accessibilityLabel={`Open ${TASK_PROVIDER_LABELS[provider]} tasks`}
            hitSlop={8}
            style={({ pressed }) => [
              styles.taskHomeProviderButton,
              pressed && styles.taskHomeProviderButtonPressed
            ]}
            onPress={(event) => {
              event.stopPropagation()
              openTasks(provider)
            }}
          >
            <TaskProviderLogo provider={provider} size={22} color={colors.textSecondary} />
          </Pressable>
        ))}
      </View>
    </View>
    <ChevronRight size={16} color={colors.textMuted} />
  </Pressable>
)
  return (

    <View>
      {/* ─── Resume card ─── */}
      {resumeWorktree ? (
        <>
    <Text style={[styles.sectionHeading, styles.sectionHeadingTightTop]}>Resume</Text>
    <Pressable
      style={({ pressed }) => [styles.resumeCard, pressed && styles.hostCardPressed]}
      onPress={() =>
        router.push(
          `/h/${resumeWorktree.hostId}/session/${encodeURIComponent(resumeWorktree.worktree.worktreeId)}`
        )
      }
    >
      <View style={styles.resumeIcon}>
        <Terminal size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.resumeMain}>
        <Text style={styles.resumeTitle} numberOfLines={1}>
          {resumeWorktree.worktree.displayName}
        </Text>
        <View style={styles.resumeSub}>
          <View
            style={[
              styles.repoDot,
              { backgroundColor: repoColor(resumeWorktree.worktree.repo) }
            ]}
          />
          <Text style={styles.resumeSubText} numberOfLines={1}>
            {resumeWorktree.worktree.repo}
            {'  ·  '}
            {resumeWorktree.worktree.branch}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
    <Text style={[styles.sectionHeading, styles.sectionHeadingTightTop]}>Tasks</Text>
    {renderTaskHomeCard()}
        </>
      ) : (
        <>
    <Text style={[styles.sectionHeading, styles.sectionHeadingTightTop]}>Tasks</Text>
    {renderTaskHomeCard()}
        </>
      )}

      {/* ─── Quick actions ─── */}
      <Text style={[styles.sectionHeading, { marginTop: spacing.xl }]}>Quick Actions</Text>
      <View style={styles.quickActions}>
        <Pressable
    style={({ pressed }) => [styles.quickAction, pressed && styles.hostCardPressed]}
    onPress={() => router.push('/pair-scan')}
        >
    <View style={styles.quickActionIcon}>
      <QrCode size={16} color={colors.textSecondary} />
    </View>
    <Text style={styles.quickActionLabel}>Pair Desktop</Text>
        </Pressable>
        <Pressable
    disabled={!primaryConnectedHost}
    style={({ pressed }) => [
      styles.quickAction,
      !primaryConnectedHost && styles.quickActionDisabled,
      pressed && styles.hostCardPressed
    ]}
    onPress={() => {
      if (primaryConnectedHost) {
        router.push(`/h/${primaryConnectedHost.id}?action=newWorktree`)
      }
    }}
        >
    <View style={styles.quickActionIcon}>
      <Plus size={16} color={colors.textSecondary} />
    </View>
    <Text style={styles.quickActionLabel}>New Workspace</Text>
        </Pressable>
      </View>

    </View>

  )
}
