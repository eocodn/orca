import { View, Text, FlatList } from 'react-native'
import type { EdgeInsets } from 'react-native-safe-area-context'
import type { ConnectionState, HostProfile } from '../src/transport/types'
import { classifyConnection } from '../src/transport/connection-health'
import { triggerMediumImpact } from '../src/platform/haptics'
import { MobileHostCard } from '../src/components/MobileHostCard'
import { spacing } from '../src/theme/mobile-theme'
import { formatDuration, type HostWorktreeInfo, type StatsSummary, type WorktreeSummary } from '../src/home-screen-data'
import { CardGap, styles } from '../src/home-screen-styles'
import { HomeScreenFooter } from '../src/home-screen-footer'
import type { TaskProvider } from '../src/tasks/mobile-task-providers'

type ResumeWorktree = { hostId: string; worktree: WorktreeSummary } | null

type Props = {
  hosts: HostProfile[]
  hostStates: Record<string, ConnectionState>
  hostAttempts: Record<string, number>
  hostLastConnected: Record<string, number | null>
  hostPaths: Record<string, string>
  worktreeInfo: Record<string, HostWorktreeInfo>
  stats: StatsSummary | null
  resumeWorktree: ResumeWorktree
  primaryConnectedHost: HostProfile | null
  primaryTaskProviders: TaskProvider[]
  insets: EdgeInsets
  isWideLayout: boolean
  contentMaxWidth: number
  onHostPress: (hostId: string) => void
  onHostLongPress: (host: HostProfile) => void
  onOpenTasks: (provider?: TaskProvider) => void
}

export function HomeScreenDashboardList({
  hosts,
  hostStates,
  hostAttempts,
  hostLastConnected,
  hostPaths,
  worktreeInfo,
  stats,
  resumeWorktree,
  primaryConnectedHost,
  primaryTaskProviders,
  insets,
  isWideLayout,
  contentMaxWidth,
  onHostPress,
  onHostLongPress,
  onOpenTasks
}: Props) {
  const sortedHosts = [...hosts].sort((a, b) => b.lastConnected - a.lastConnected)
  return (
    <FlatList
      data={sortedHosts}
      keyExtractor={(host) => host.id}
      contentContainerStyle={[
        styles.list,
        { paddingBottom: spacing.xl + insets.bottom },
        isWideLayout && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
      ]}
      ListHeaderComponent={
        <View>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Welcome back</Text>
          </View>
          {stats && (
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.totalAgentsSpawned.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Agents spawned</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{formatDuration(stats.totalAgentTimeMs)}</Text>
                <Text style={styles.statLabel}>Agent time</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.totalPRsCreated.toLocaleString()}</Text>
                <Text style={styles.statLabel}>PRs created</Text>
              </View>
            </View>
          )}
          <Text style={styles.sectionHeading}>Desktops</Text>
        </View>
      }
      ItemSeparatorComponent={CardGap}
      renderItem={({ item }) => {
        const state = hostStates[item.id] ?? 'connecting'
        const verdict = classifyConnection({
          state,
          reconnectAttempts: hostAttempts[item.id] ?? 0,
          lastConnectedAt: hostLastConnected[item.id] ?? null,
          endpoint: item.endpoint
        })
        const info = worktreeInfo[item.id]
        return (
          <MobileHostCard
            host={item}
            state={state}
            verdict={verdict}
            path={hostPaths[item.id] ?? 'lan'}
            worktreeCounts={info ? { total: info.totalWorktrees, active: info.activeCount } : undefined}
            onPress={() => onHostPress(item.id)}
            onLongPress={() => {
              triggerMediumImpact()
              onHostLongPress(item)
            }}
          />
        )
      }}
      ListFooterComponent={
        <HomeScreenFooter
          resumeWorktree={resumeWorktree}
          primaryConnectedHost={primaryConnectedHost}
          primaryTaskProviders={primaryTaskProviders}
          openTasks={onOpenTasks}
        />
      }
    />
  )
}
