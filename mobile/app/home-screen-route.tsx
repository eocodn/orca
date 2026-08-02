import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, StyleSheet, Pressable, FlatList, Alert } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import {
  QrCode,
  Settings,
  ChevronRight,
  Terminal,
  Plus,
  RefreshCw,
  PowerOff,
  Edit3,
  ListTodo
} from 'lucide-react-native'
import { ClaudeIcon, OpenAIIcon } from '../src/components/AgentIcons'
import {
  type AccountsSnapshot,
  type ProviderKey,
  decodeAccountsSnapshot,
  getActiveProviderRateLimits,
  getUsageBarState,
  hasActiveProviderUsage,
  hasRenderableUsage,
  UsageBar
} from '../src/components/AccountUsage'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadHosts } from '../src/transport/host-store'
import { navigateToMobileHostEdit } from '../src/transport/host-edit-navigation'
import { removeHostAndCloseClient } from '../src/transport/host-removal-lifecycle'
import { pickResumeWorktree } from '../src/worktree/resume-worktree'
import type { RpcClient } from '../src/transport/rpc-client'
import { sendSingleFlightRequest } from '../src/transport/request-single-flight'
import {
  useAllHostClients,
  useCloseHost,
  useForceReconnect,
  usePrimeHosts
} from '../src/transport/client-context'
import { classifyConnection } from '../src/transport/connection-health'
import { subscribeToDesktopNotifications } from '../src/notifications/mobile-notifications'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../src/onboarding/mobile-onboarding-plan'
import type { ConnectionState, HostProfile } from '../src/transport/types'
import { triggerMediumImpact } from '../src/platform/haptics'
import { OrcaLogo } from '../src/components/OrcaLogo'
import { MobileHostCard } from '../src/components/MobileHostCard'
import { TaskProviderLogo } from '../src/components/TaskProviderLogo'
import { ActionSheetModal, type ActionSheetAction } from '../src/components/ActionSheetModal'
import { ConfirmModal } from '../src/components/ConfirmModal'
import { setCachedWorktrees, getCachedWorktrees } from '../src/cache/worktree-cache'
import { loadHomeSnapshot, saveHomeSnapshot } from '../src/cache/home-snapshot-cache'
import { colors, spacing, radii } from '../src/theme/mobile-theme'
import {
  filterAvailableTaskProviders,
  normalizeVisibleTaskProviders,
  type TaskProvider
} from '../src/tasks/mobile-task-providers'
import { useResponsiveLayout } from '../src/layout/responsive-layout'

import { endpointLabel, formatDuration, clientKey, fetchStats, fetchWorktreeInfo, fetchAccountsSnapshot, fetchTaskProviders, repoColor, type StatsSummary, type WorktreeSummary, type HostWorktreeInfo, TASK_PROVIDER_LABELS } from '../src/home-screen-data'
import { CardGap, ONBOARDING_STEPS, styles } from '../src/home-screen-styles'
import { HomeScreenFooter } from '../src/home-screen-footer'
export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Why: cap/center content on wide/tablet canvases so cards don't stretch edge-to-edge on iPad.
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [actionTarget, setActionTarget] = useState<HostProfile | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<HostProfile | null>(null)
  const [hostStates, setHostStates] = useState<Record<string, ConnectionState>>({})
  const [hostAttempts, setHostAttempts] = useState<Record<string, number>>({})
  const [hostLastConnected, setHostLastConnected] = useState<Record<string, number | null>>({})
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [worktreeInfo, setWorktreeInfo] = useState<Record<string, HostWorktreeInfo>>({})
  const [accountsByHost, setAccountsByHost] = useState<Record<string, AccountsSnapshot>>({})
  const [taskProvidersByHost, setTaskProvidersByHost] = useState<Record<string, TaskProvider[]>>({})
  const [lastVisited, setLastVisited] = useState<{ hostId: string; worktreeId: string } | null>(
    null
  )
  // Why: focus can fire repeatedly while an async gate is pending; one probe per
  // mount avoids duplicate storage/permission reads and competing navigation.
  const onboardingOptInCheckedRef = useRef(false)

  // Why: shared clients from the per-host store, not N independent WebSockets. See docs/mobile-shared-client-per-host.md.
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  const allClients = useAllHostClients(hostIds)
  const hostPaths = useMemo(
    () => Object.fromEntries(allClients.map(({ hostId, path }) => [hostId, path])),
    [allClients]
  )
  const closeHostClient = useCloseHost()
  const forceReconnectHost = useForceReconnect()
  const primeHosts = usePrimeHosts()
  // Why: prime the cache with loaded HostProfiles to avoid a second serialized Keychain pass (multi-second connect latency) on cold start.
  useEffect(() => {
    if (hosts.length > 0) {
      primeHosts(hosts)
    }
  }, [hosts, primeHosts])
  const allClientsRef = useRef<Array<{ hostId: string; client: RpcClient }>>([])
  // Why: keep the focus callback stable (no refetch per render) while still exposing the latest host clients.
  allClientsRef.current = allClients.map((entry) => ({
    hostId: entry.hostId,
    client: entry.client
  }))

  // Why: hydrate from a persisted snapshot on cold-start so Resume + Account cards paint immediately instead of flashing empty.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true
    let cancelled = false
    void loadHomeSnapshot().then((snap) => {
      if (cancelled || !snap) {
        return
      }
      setWorktreeInfo((prev) => (Object.keys(prev).length > 0 ? prev : snap.worktreeInfo))
      setAccountsByHost((prev) => (Object.keys(prev).length > 0 ? prev : snap.accountsByHost))
      for (const [hostId, info] of Object.entries(snap.worktreeInfo)) {
        const wt = info.lastActiveWorktree
        if (wt) {
          // Why: seed the in-memory cache so resumeWorktree's lastVisited fast-path finds the worktree object.
          setCachedWorktrees(hostId, [wt])
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Why: persist the merged snapshot on each update so the next cold-start has fresh seed data (cache debounces writes).
  useEffect(() => {
    if (Object.keys(worktreeInfo).length === 0 && Object.keys(accountsByHost).length === 0) {
      return
    }
    saveHomeSnapshot({
      worktreeInfo,
      accountsByHost,
      savedAt: Date.now()
    })
  }, [worktreeInfo, accountsByHost])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void loadHosts().then(async (h) => {
        if (stale) {
          return
        }
        setHosts(h)
        if (h.length === 0 || onboardingOptInCheckedRef.current) {
          return
        }
        onboardingOptInCheckedRef.current = true
        const onboardingSteps = await loadMobileOnboardingSteps()
        if (stale) {
          return
        }
        if (onboardingSteps.length > 0) {
          router.replace(mobileOnboardingDestination(onboardingSteps))
        }
      })
      void AsyncStorage.getItem('orca:last-visited-worktree').then((raw) => {
        if (stale || !raw) {
          return
        }
        try {
          setLastVisited(JSON.parse(raw))
        } catch {}
      })
      for (const entry of allClientsRef.current) {
        if (entry.client.getState() === 'connected') {
          fetchStats(entry.client, entry.hostId, setStats, () => stale)
          fetchWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => stale)
          fetchAccountsSnapshot(entry.client, entry.hostId, setAccountsByHost, () => stale)
          fetchTaskProviders(entry.client, entry.hostId, setTaskProvidersByHost, () => stale)
        }
      }
      return () => {
        stale = true
      }
    }, [router])
  )

  const sortedHosts = useMemo(
    () => [...hosts].sort((a, b) => b.lastConnected - a.lastConnected),
    [hosts]
  )

  // Why: mirror per-host connection state into hostStates so existing render code (status dots) keeps working.
  useEffect(() => {
    setHostAttempts((prev) => {
      const next: Record<string, number> = { ...prev }
      let changed = false
      for (const entry of allClients) {
        const a = entry.client.getReconnectAttempt()
        if (next[entry.hostId] !== a) {
          next[entry.hostId] = a
          changed = true
        }
      }
      return changed ? next : prev
    })
    setHostLastConnected((prev) => {
      const next: Record<string, number | null> = { ...prev }
      let changed = false
      for (const entry of allClients) {
        const t = entry.client.getLastConnectedAt()
        if (next[entry.hostId] !== t) {
          next[entry.hostId] = t
          changed = true
        }
      }
      return changed ? next : prev
    })
    setHostStates((prev) => {
      const next: Record<string, ConnectionState> = { ...prev }
      let changed = false
      const liveIds = new Set(allClients.map((e) => e.hostId))
      for (const entry of allClients) {
        if (next[entry.hostId] !== entry.state) {
          next[entry.hostId] = entry.state
          changed = true
        }
      }
      // Why: reflect hosts that dropped from allClients, but only if already tracked — else the initial-acquire frame flips all to 'disconnected'.
      for (const host of hosts) {
        if (liveIds.has(host.id)) {
          continue
        }
        if (!host.publicKeyB64 || !host.deviceToken) {
          if (next[host.id] !== 'auth-failed') {
            next[host.id] = 'auth-failed'
            changed = true
          }
          continue
        }
        const prevState = next[host.id]
        if (prevState && prevState !== 'disconnected' && prevState !== 'auth-failed') {
          next[host.id] = 'disconnected'
          changed = true
        }
      }
      // Drop entries for hosts we no longer track at all.
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id) && hosts.some((h) => h.id === id) === false) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allClients, hosts])

  // Per-host notif/accounts subs + one-shot stats on 'connected'; re-runs per (hostId, client) pair, socket stays open so it's cheap.
  useEffect(() => {
    const cleanups: Array<() => void> = []
    for (const entry of allClients) {
      let unsubNotif: (() => void) | null = null
      let unsubAccounts: (() => void) | null = null
      let statsFetched = false
      const wireUp = (state: ConnectionState) => {
        if (state === 'connected') {
          if (!unsubNotif) {
            unsubNotif = subscribeToDesktopNotifications(entry.client, entry.hostId)
          }
          if (!unsubAccounts) {
            unsubAccounts = entry.client.subscribe('accounts.subscribe', null, (payload) => {
              if (!payload || typeof payload !== 'object') {
                return
              }
              const evt = payload as { type?: string; snapshot?: unknown }
              if (evt.type === 'ready' || evt.type === 'snapshot') {
                try {
                  const snapshot = decodeAccountsSnapshot(evt.snapshot)
                  setAccountsByHost((prev) => ({ ...prev, [entry.hostId]: snapshot }))
                } catch {
                  // Keep the last proven snapshot; malformed remote data must
                  // not enter render state or crash the home host cards.
                }
              }
            })
          }
          if (!statsFetched) {
            statsFetched = true
            fetchStats(entry.client, entry.hostId, setStats, () => false)
            fetchWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => false)
            fetchTaskProviders(entry.client, entry.hostId, setTaskProvidersByHost, () => false)
          }
        } else {
          if (unsubNotif) {
            unsubNotif()
            unsubNotif = null
          }
          if (unsubAccounts) {
            unsubAccounts()
            unsubAccounts = null
          }
        }
      }
      wireUp(entry.state)
      const unsubState = entry.client.onStateChange(wireUp)
      cleanups.push(() => {
        unsubState()
        unsubNotif?.()
        unsubAccounts?.()
      })
    }
    return () => {
      for (const c of cleanups) {
        c()
      }
    }
    // Why: key on host-id set + each client's identity so resubs fire when forceReconnect swaps a host's client, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allClients
      .map((e) => `${e.hostId}:${clientKey(e.client)}`)
      .sort()
      .join(',')
  ])

  // Why: prefer the worktree last opened on this device so Resume reflects mobile session history.
  // Why: don't gate on 'connected' so the card doesn't flash empty for ~1s on cold-start; cached data holds until fresh RPC lands.
  const resumeWorktree = useMemo(() => {
    // Why: only surface Resume for connected hosts; a stale worktree taps into a route that can't load.
    if (lastVisited && hostStates[lastVisited.hostId] === 'connected') {
      const cached = getCachedWorktrees(lastVisited.hostId) as WorktreeSummary[] | null
      const match = cached?.find((w) => w.worktreeId === lastVisited.worktreeId)
      if (match) {
        return { hostId: lastVisited.hostId, worktree: match }
      }
    }
    for (const host of sortedHosts) {
      if (hostStates[host.id] !== 'connected') {
        continue
      }
      const info = worktreeInfo[host.id]
      if (info?.lastActiveWorktree) {
        return { hostId: host.id, worktree: info.lastActiveWorktree }
      }
    }
    return null
  }, [sortedHosts, hostStates, worktreeInfo, lastVisited])

  // Why: only show Account usage for connected hosts; stale cached usage would imply live data.
  const accountsHosts = useMemo(() => {
    const items: Array<{ host: HostProfile; snapshot: AccountsSnapshot }> = []
    for (const host of sortedHosts) {
      if (hostStates[host.id] !== 'connected') {
        continue
      }
      const snap = accountsByHost[host.id]
      if (!snap) {
        continue
      }
      // Why: also show hosts whose only usage is the system-default login, else those users see no usage section.
      if (hasRenderableUsage(snap, 'claude') || hasRenderableUsage(snap, 'codex')) {
        items.push({ host, snapshot: snap })
      }
    }
    return items
  }, [sortedHosts, hostStates, accountsByHost])

  const primaryConnectedHost = useMemo(
    () => sortedHosts.find((host) => hostStates[host.id] === 'connected') ?? null,
    [sortedHosts, hostStates]
  )
  const primaryTaskProviders = primaryConnectedHost
    ? (taskProvidersByHost[primaryConnectedHost.id] ?? ['github'])
    : []
  const openTasks = useCallback(
    (provider?: TaskProvider) => {
      if (!primaryConnectedHost) {
        return
      }
      const suffix = provider ? `?taskSource=${provider}` : ''
      router.push(`/h/${primaryConnectedHost.id}/tasks${suffix}`)
    },
    [primaryConnectedHost, router]
  )


  async function handleRemove() {
    if (!confirmRemove) {
      return
    }
    const hostToRemove = confirmRemove
    try {
      await removeHostAndCloseClient(hostToRemove.id, closeHostClient)
      setConfirmRemove(null)
      setHosts(await loadHosts())
    } catch {
      // Why: ConfirmModal closes on confirm; re-open for retry so the failure isn't silent.
      setConfirmRemove(hostToRemove)
      Alert.alert('Could not remove host', 'Please try again.')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ─── Top bar ─── */}
      <View style={styles.topBar}>
        <View style={styles.brandLockup}>
          <View style={styles.logoMark}>
            <OrcaLogo size={18} />
          </View>
          <Text style={styles.brandName}>Orca</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          onPress={() => router.push('/settings')}
        >
          <Settings size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {hosts.length === 0 ? (
        /* ─── Empty state: onboarding ─── */
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
            <Pressable style={styles.primaryButton} onPress={() => router.push('/pair-scan')}>
              <QrCode size={17} color={colors.bgBase} />
              <Text style={styles.primaryButtonText}>Pair Desktop</Text>
            </Pressable>
          </View>

          <View style={styles.stepsSection}>
            <Text style={styles.sectionHeading}>How it works</Text>
            {ONBOARDING_STEPS.map((step, i) => (
              <View key={step.title} style={[styles.stepRow, i > 0 && styles.stepRowBorder]}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        /* ─── Populated state ─── */
        <FlatList
          data={sortedHosts}
          keyExtractor={(h) => h.id}
          // Why: reserve insets.bottom so the last row stays reachable above the system nav bar / home indicator.
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
                    <Text style={styles.statValue}>
                      {stats.totalAgentsSpawned.toLocaleString()}
                    </Text>
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
            const attempts = hostAttempts[item.id] ?? 0
            const lastConnectedAt = hostLastConnected[item.id] ?? null
            const info = worktreeInfo[item.id]
            const verdict = classifyConnection({
              state,
              reconnectAttempts: attempts,
              lastConnectedAt,
              endpoint: item.endpoint
            })
            return (
              <MobileHostCard
                host={item}
                state={state}
                verdict={verdict}
                path={hostPaths[item.id] ?? 'lan'}
                worktreeCounts={
                  info ? { total: info.totalWorktrees, active: info.activeCount } : undefined
                }
                onPress={() => router.push(`/h/${item.id}`)}
                onLongPress={() => {
                  triggerMediumImpact()
                  setActionTarget(item)
                }}
              />
            )
          }}
          ListFooterComponent={<HomeScreenFooter resumeWorktree={resumeWorktree} primaryConnectedHost={primaryConnectedHost} primaryTaskProviders={primaryTaskProviders} openTasks={openTasks} accountsHosts={accountsHosts} />}
        />
      )}

      {/* ─── Action sheets (shared by both states) ─── */}
      <ActionSheetModal
        visible={actionTarget != null}
        title={actionTarget?.name}
        message={actionTarget ? endpointLabel(actionTarget.endpoint) : undefined}
        actions={(() => {
          const host = actionTarget
          if (!host) {
            return []
          }
          const state = hostStates[host.id] ?? 'connecting'
          const isLive =
            state === 'connected' ||
            state === 'connecting' ||
            state === 'handshaking' ||
            state === 'reconnecting'
          // Why: label "Connect" (not "Reconnect") when never connected this session, so the verb matches the action.
          const hasEverConnected = (hostLastConnected[host.id] ?? null) != null
          const items: ActionSheetAction[] = []
          items.push({
            label: hasEverConnected && isLive ? 'Reconnect' : 'Connect',
            icon: RefreshCw,
            onPress: () => {
              setActionTarget(null)
              void forceReconnectHost(host.id)
            }
          })
          if (isLive) {
            items.push({
              label: 'Disconnect',
              icon: PowerOff,
              onPress: () => {
                setActionTarget(null)
                closeHostClient(host.id)
              }
            })
          }
          items.push({
            label: 'Edit host',
            icon: Edit3,
            closeBeforePress: true,
            onPress: () => {
              setActionTarget(null)
              navigateToMobileHostEdit(router, host.id)
            }
          })
          items.push({
            label: 'Remove',
            destructive: true,
            closeBeforePress: true,
            onPress: () => {
              setConfirmRemove(host)
            }
          })
          return items
        })()}
        onClose={() => setActionTarget(null)}
      />

      <ConfirmModal
        visible={confirmRemove != null}
        title="Remove Host"
        message={`Remove "${confirmRemove?.name}"? You can re-pair later.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </SafeAreaView>
  )
}

