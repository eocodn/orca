import { useRouter } from 'expo-router'
import { View, Text, Pressable } from 'react-native'
import { ChevronRight, ListTodo, Plus, QrCode, Terminal } from 'lucide-react-native'
import { ClaudeIcon, OpenAIIcon } from './components/AgentIcons'
import { getActiveProviderRateLimits, getUsageBarState, hasActiveProviderUsage, type AccountsSnapshot, type ProviderKey, UsageBar } from './components/AccountUsage'
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
  accountsHosts: Array<{ host: HostProfile; snapshot: AccountsSnapshot }>
}

export function HomeScreenFooter({ resumeWorktree, primaryConnectedHost, primaryTaskProviders, openTasks, accountsHosts }: HomeScreenFooterProps) {
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

      {/* ─── Account usage ─── */}
      {accountsHosts.length > 0 ? (
        <>
    <Text style={[styles.sectionHeading, { marginTop: spacing.xl }]}>
      Account usage
    </Text>
    {accountsHosts.map(({ host, snapshot }) => {
      const claudeActiveId = snapshot.claude.activeAccountId
      const claudeActive =
        snapshot.claude.accounts.find((a) => a.id === claudeActiveId) ?? null
      const codexActiveId = snapshot.codex.activeAccountId
      const codexActive =
        snapshot.codex.accounts.find((a) => a.id === codexActiveId) ?? null
      const showHostName = accountsHosts.length > 1
      return (
        <Pressable
          key={host.id}
          style={({ pressed }) => [
            styles.accountsCard,
            pressed && styles.hostCardPressed
          ]}
          onPress={() => router.push(`/h/${host.id}/accounts`)}
        >
          {showHostName ? (
            <Text style={styles.accountsHostLabel} numberOfLines={1}>
              {host.name}
            </Text>
          ) : null}
          {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
            const active = provider === 'claude' ? claudeActive : codexActive
            const accounts =
              provider === 'claude'
                ? snapshot.claude.accounts
                : snapshot.codex.accounts
            const limits = getActiveProviderRateLimits(snapshot, provider)
            // Why: with no managed accounts, still render the row when the active target has live usage data.
            if (accounts.length === 0 && !hasActiveProviderUsage(limits)) {
              return null
            }
            const sessionBar = getUsageBarState(limits, 'session')
            const weeklyBar = getUsageBarState(limits, 'weekly')
            return (
              <View key={provider} style={styles.accountsRow}>
                <View style={styles.accountsIcon}>
                  {provider === 'claude' ? (
                    <ClaudeIcon size={18} />
                  ) : (
                    <OpenAIIcon size={18} color={colors.textPrimary} />
                  )}
                </View>
                <View style={styles.accountsInfo}>
                  <Text style={styles.accountsEmail} numberOfLines={1}>
                    {active?.email ?? 'System default'}
                  </Text>
                  <View style={styles.accountsBars}>
                    <UsageBar
                      label="5h"
                      usedPercent={sessionBar.usedPercent}
                      unavailable={sessionBar.unavailable}
                      loading={sessionBar.loading}
                    />
                    <UsageBar
                      label="7d"
                      usedPercent={weeklyBar.usedPercent}
                      unavailable={weeklyBar.unavailable}
                      loading={weeklyBar.loading}
                    />
                  </View>
                </View>
              </View>
            )
          })}
        </Pressable>
      )
    })}
        </>
      ) : null}
    </View>

  )
}
