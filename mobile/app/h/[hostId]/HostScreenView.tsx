import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router'
import {
  Search,
  X,
  Pin,
  List,
  SlidersHorizontal,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Moon,
  Filter,
  Check,
  UserCircle,
  PanelLeftClose,
  SquareTerminal
} from 'lucide-react-native'
import type { RpcClient } from '../../../src/transport/rpc-client'
import { loadHosts, updateLastConnected } from '../../../src/transport/host-store'
import { removeHostAndCloseClient } from '../../../src/transport/host-removal-lifecycle'
import {
  useHostClient,
  useCloseHost,
  useForceReconnect
} from '../../../src/transport/client-context'
import { useWorktreeResync } from '../../../src/transport/use-worktree-resync'
import { startHostWorktreeRefresh } from '../../../src/worktree/host-worktree-refresh'
import {
  useLastConnectedAt,
  useReconnectAttempt
} from '../../../src/transport/client-context-connection-metrics'
import {
  classifyConnection,
  type ConnectionVerdict
} from '../../../src/transport/connection-health'
import type { RpcSuccess } from '../../../src/transport/types'
import { StatusDot } from '../../../src/components/StatusDot'
import { NewWorktreeModalController } from '../../../src/components/NewWorktreeModalController'
import { NewWorkspaceFab, FAB_SIZE } from '../../../src/components/NewWorkspaceFab'
import { MobileRepoIcon } from '../../../src/components/MobileRepoIcon'
import { WorktreeListRow } from '../../../src/components/WorktreeListRow'
import { useNow } from '../../../src/hooks/use-now'
import { useActiveWorktreeScroll } from '../../../src/hooks/use-active-worktree-scroll'
import type { RepoIcon } from '../../../../src/shared/repo-icon'
import { PickerModal } from '../../../src/components/PickerModal'
import { ActionSheetContent } from '../../../src/components/ActionSheetModal'
import { buildWorktreeNavigationActions } from '../../../src/agent-history/worktree-navigation-actions'
import { floatingWorkspaceSessionPath } from '../../../src/session/floating-workspace'
import { ConfirmModal } from '../../../src/components/ConfirmModal'
import { BottomDrawer } from '../../../src/components/BottomDrawer'
import { useHostProtocolGates } from '../../../src/components/HostProtocolGate'
import { AuthFailedBanner } from '../../../src/components/AuthFailedBanner'
import { MobileSearchField } from '../../../src/components/MobileSearchField'
import { WorkspaceDetailPlaceholder } from '../../../src/components/WorkspaceDetailPlaceholder'
import { getCachedWorktrees, setCachedWorktrees } from '../../../src/cache/worktree-cache'
import { setCachedRepos } from '../../../src/cache/repo-cache'
import { colors, spacing } from '../../../src/theme/mobile-theme'
import { useResponsiveLayout } from '../../../src/layout/responsive-layout'
import { leaveHostRoute } from '../../../src/host-route-exit'
import { loadPinnedIds, savePinnedIds } from '../../../src/storage/preferences'
import {
  createInitialHostRouteActionState,
  resolveHostRouteActionState,
  setHostRouteNewWorktreeVisible
} from '../../../src/host-route-action-state'
import {
  applyDesktopViewSettings,
  groupModeToDesktop,
  type MobileGroupMode,
  type MobileSortMode,
  type MobileViewState,
  type WorkspaceViewSettings
} from '../../../src/worktree/workspace-view-settings'
import {
  getWorktreeStatus,
  isWorktreePinned,
  type FilterState,
  type Worktree
} from '../../../src/worktree/workspace-list-sections'
import { useWorkspaceSections } from '../../../src/worktree/use-workspace-sections'
import { getMobileWorkspaceLineageGroupKey } from '../../../src/worktree/mobile-workspace-lineage'
import { areWorktreeListsEqual } from '../../../src/worktree/worktree-list-snapshot'
import { repoColor } from '../../../src/worktree/repo-color'
import {
  WORKSPACE_GROUP_OPTIONS as GROUP_OPTIONS,
  WORKSPACE_SORT_OPTIONS as SORT_OPTIONS
} from '../../../src/worktree/workspace-list-picker-options'
import type { RepoSummary } from '../../../src/worktree/host-worktree-rpc-types'
import type { WorkspaceStatusDefinition } from '../../../../src/shared/types'
import { DEFAULT_MOBILE_WORKSPACE_STATUSES } from '../../../src/worktree/mobile-workspace-statuses'

import { styles } from './host-screen-styles'
import { HostScreenOverlays } from './HostScreenOverlays'

type ViewProps = Record<string, any>

function ListSeparator() {
  return <View style={styles.separator} />
}

export function HostScreenView(props: ViewProps) {
  const { embedded, onHideSidebar, hostId, client, connState, reconnectAttempts, lastConnectedAt, forceReconnectHost, leaveHost, hostName, hostCapabilities, floatingWorkspaceEnabled, showSearch, setShowSearch, showFilterModal, setShowFilterModal, activeFilterCount, selectedSortLabel, sortMode, handleSortChange, groupMode, handleGroupChange, filters, toggleHideSleeping, toggleHideDefaultBranch, uniqueRepos, toggleRepoFilter, clearFilters, search, setSearch, error, worktreesLoaded, refreshing, fetchWorktrees, displayWorktrees, sections, sectionListRef, onScrollToIndexFailed, toggleCollapsed, collapsedGroups, repoIconsByName, repoColorsByName, now, openWorktreeSession, openFloatingWorkspace, actionTarget, setActionTarget, confirmDelete, setConfirmDelete, handleDeleteWorktree, confirmRemoveHost, setConfirmRemoveHost, handleRemoveHost, newWorktreeModalRef, showNewWorktree, setShowNewWorktreeVisible, existingWorktreePaths, worktrees, navigateFromHostList, newWorktreeModalVisibleRef, openNewWorktreeModal, togglePin, toggleWorktreeLineage, isWideLayout, contentMaxWidth, insets, pathname, router, isErrorVerdict, setSleptIds, pinnedIds } = props
  const [localSortPickerVisible, setLocalSortPickerVisible] = useState(false)
  const [localGroupPickerVisible, setLocalGroupPickerVisible] = useState(false)
  // Why: the split runtime still passes the pre-split list contract; keep picker state local until it forwards these values.
  const showSortPicker = props.showSortPicker ?? localSortPickerVisible
  const setShowSortPicker = props.showSortPicker === undefined ? setLocalSortPickerVisible : props.setShowSortPicker
  const showGroupPicker = props.showGroupPicker ?? localGroupPickerVisible
  const setShowGroupPicker = props.showGroupPicker === undefined ? setLocalGroupPickerVisible : props.setShowGroupPicker
  const rawSections = props.rawSections ?? sections
  const uniqueRepoColors = props.uniqueRepoColors ?? new Map(uniqueRepos.map((repo: { name: string; color: string }) => [repo.name, repo.color]))
  const onRefresh = props.onRefresh ?? (() => void fetchWorktrees())
  const isReadOnly = props.isReadOnly ?? connState === 'auth-failed'
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topChrome}>
        <View style={styles.statusBar}>
          <Pressable
            style={styles.backButton}
            onPress={leaveHost}
            accessibilityRole="button"
            accessibilityLabel="Back to hosts"
            hitSlop={8}
          >
            <ChevronLeft size={22} color={colors.textPrimary} />
          </Pressable>
          {(() => {
            const headerVerdict = classifyConnection({
              state: connState,
              reconnectAttempts,
              lastConnectedAt
            })
            return (
              <>
                <View style={styles.hostIdentity}>
                  <StatusDot state={connState} verdict={headerVerdict} />
                  <Text style={styles.hostNameText} numberOfLines={1}>
                    {hostName || 'Host'}
                  </Text>
                </View>
                {connState !== 'connected' &&
                  (() => {
                    // Why: auth-failed has its own banner, so suppress the Reconnect button for that verdict.
                    const verdict = headerVerdict
                    const isError = isErrorVerdict(verdict)
                    const showReconnectButton = isError && hostId && verdict.kind !== 'auth-failed'
                    if (!showReconnectButton) {
                      return null
                    }
                    return (
                      <Pressable
                        style={styles.reconnectButton}
                        onPress={() => void forceReconnectHost(hostId!)}
                        hitSlop={8}
                      >
                        <Text style={styles.reconnectButtonText}>Reconnect</Text>
                      </Pressable>
                    )
                  })()}
              </>
            )
          })()}
          {!embedded && floatingWorkspaceEnabled ? (
            <Pressable
              style={[
                styles.floatingWorkspaceHeaderButton,
                connState !== 'connected' && styles.toolbarIconDisabled
              ]}
              onPress={openFloatingWorkspace}
              disabled={connState !== 'connected'}
              accessibilityRole="button"
              accessibilityLabel="Floating Workspace"
              hitSlop={8}
            >
              <SquareTerminal
                size={18}
                color={connState === 'connected' ? colors.textPrimary : colors.textMuted}
              />
            </Pressable>
          ) : null}
          {embedded && onHideSidebar ? (
            <Pressable
              style={styles.sidebarCollapseButton}
              onPress={onHideSidebar}
              accessibilityRole="button"
              accessibilityLabel="Hide sidebar"
              hitSlop={8}
            >
              <PanelLeftClose size={14} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {/* Filter/sort/group toolbar */}
        {embedded ? (
          <View style={styles.embeddedToolbar}>
            <View style={styles.embeddedToolbarRow}>
              <Pressable
                style={[
                  styles.filterChip,
                  styles.embeddedFilterChip,
                  activeFilterCount > 0 && styles.filterChipActive
                ]}
                onPress={() => setShowFilterModal(true)}
                accessibilityRole="button"
                accessibilityLabel={`Filter workspaces${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
              >
                <Filter
                  size={12}
                  color={activeFilterCount > 0 ? colors.textPrimary : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    activeFilterCount > 0 && styles.filterChipTextActive
                  ]}
                  numberOfLines={1}
                >
                  Filter{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.modeButton, styles.embeddedModeButton]}
                onPress={() => setShowSortPicker(true)}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${selectedSortLabel}`}
              >
                <SlidersHorizontal size={14} color={colors.textSecondary} />
                <Text style={styles.sortLabel} numberOfLines={1}>
                  {selectedSortLabel}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.modeButton, styles.embeddedModeButton]}
                onPress={() => setShowGroupPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Group workspaces"
              >
                <Layers size={14} color={colors.textSecondary} />
                <Text style={styles.sortLabel} numberOfLines={1}>
                  {groupMode === 'none'
                    ? 'Group'
                    : groupMode === 'workspaceStatus'
                      ? 'Status'
                      : groupMode === 'repo'
                        ? 'Repo'
                        : 'PR'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.embeddedToolbarRow}>
              <Pressable
                style={[
                  styles.embeddedToolbarIconButton,
                  connState !== 'connected' && styles.toolbarIconDisabled
                ]}
                onPress={() => navigateFromHostList(`/h/${hostId}/accounts`)}
                disabled={connState !== 'connected'}
                accessibilityRole="button"
                accessibilityLabel="Accounts"
              >
                <UserCircle
                  size={16}
                  color={connState === 'connected' ? colors.textSecondary : colors.textMuted}
                />
              </Pressable>

              <Pressable
                style={[
                  styles.embeddedToolbarIconButton,
                  connState !== 'connected' && styles.toolbarIconDisabled
                ]}
                onPress={() => navigateFromHostList(`/h/${hostId}/tasks`)}
                disabled={connState !== 'connected'}
                accessibilityRole="button"
                accessibilityLabel="Tasks"
              >
                <List
                  size={16}
                  color={connState === 'connected' ? colors.textSecondary : colors.textMuted}
                />
              </Pressable>

              {floatingWorkspaceEnabled ? (
                <Pressable
                  style={[
                    styles.embeddedToolbarIconButton,
                    connState !== 'connected' && styles.toolbarIconDisabled
                  ]}
                  onPress={openFloatingWorkspace}
                  disabled={connState !== 'connected'}
                  accessibilityRole="button"
                  accessibilityLabel="Floating Workspace"
                >
                  <SquareTerminal
                    size={18}
                    color={connState === 'connected' ? colors.textSecondary : colors.textMuted}
                  />
                </Pressable>
              ) : null}

              <Pressable
                style={[
                  styles.embeddedToolbarIconButton,
                  connState !== 'connected' && styles.toolbarIconDisabled
                ]}
                onPress={openNewWorktreeModal}
                disabled={connState !== 'connected'}
                accessibilityRole="button"
                accessibilityLabel="New workspace"
              >
                <Plus
                  size={16}
                  color={connState === 'connected' ? colors.textPrimary : colors.textMuted}
                />
              </Pressable>

              <Pressable
                style={styles.embeddedToolbarIconButton}
                onPress={() => setShowSearch((s) => !s)}
                accessibilityRole="button"
                accessibilityLabel={showSearch ? 'Close search' : 'Search workspaces'}
              >
                {showSearch ? (
                  <X size={16} color={colors.textSecondary} />
                ) : (
                  <Search size={16} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.toolbar}>
            <Pressable
              style={[styles.filterChip, activeFilterCount > 0 && styles.filterChipActive]}
              onPress={() => setShowFilterModal(true)}
            >
              <Filter
                size={12}
                color={activeFilterCount > 0 ? colors.textPrimary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.filterChipText,
                  activeFilterCount > 0 && styles.filterChipTextActive
                ]}
              >
                Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Text>
            </Pressable>

            <Pressable style={styles.modeButton} onPress={() => setShowSortPicker(true)}>
              <SlidersHorizontal size={14} color={colors.textSecondary} />
              <Text style={styles.sortLabel} numberOfLines={1}>
                {selectedSortLabel}
              </Text>
            </Pressable>

            <Pressable style={styles.modeButton} onPress={() => setShowGroupPicker(true)}>
              <Layers size={14} color={colors.textSecondary} />
              <Text style={styles.sortLabel} numberOfLines={1}>
                {groupMode === 'none'
                  ? 'Group'
                  : groupMode === 'workspaceStatus'
                    ? 'Status'
                    : groupMode === 'repo'
                      ? 'Repo'
                      : 'PR'}
              </Text>
            </Pressable>

            <View style={styles.toolbarSpacer} />

            <Pressable
              style={styles.searchToggle}
              onPress={() => navigateFromHostList(`/h/${hostId}/accounts`)}
              disabled={connState !== 'connected'}
            >
              <UserCircle
                size={16}
                color={connState === 'connected' ? colors.textSecondary : colors.textMuted}
              />
            </Pressable>

            <Pressable
              style={styles.searchToggle}
              onPress={() => navigateFromHostList(`/h/${hostId}/tasks`)}
              disabled={connState !== 'connected'}
            >
              <List
                size={16}
                color={connState === 'connected' ? colors.textSecondary : colors.textMuted}
              />
            </Pressable>

            <Pressable style={styles.searchToggle} onPress={() => setShowSearch((s) => !s)}>
              {showSearch ? (
                <X size={16} color={colors.textSecondary} />
              ) : (
                <Search size={16} color={colors.textSecondary} />
              )}
            </Pressable>
          </View>
        )}
      </View>

      {/* Auth failed banner */}
      {connState === 'auth-failed' && (
        <AuthFailedBanner
          canRetry={!!hostId}
          onRetry={() => hostId && void forceReconnectHost(hostId)}
          onRepair={() => router.push('/pair-scan')}
          onRemove={() => setConfirmRemoveHost(true)}
        />
      )}

      {/* Search bar */}
      {showSearch && (
        <View style={styles.searchBar}>
          <MobileSearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search worktrees…"
            autoFocus
            // Why: new key per open remounts the focus effect across rapid toggles so the keyboard reappears.
            focusKey={showSearch}
            accessibilityLabel="Search worktrees"
          />
        </View>
      )}

      {/* Loading state */}
      {((connState === 'connecting' || connState === 'reconnecting') &&
        displayWorktrees.length === 0) ||
      (connState === 'connected' && !worktreesLoaded && displayWorktrees.length === 0) ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : null}

      {/* Empty state */}
      {connState === 'connected' && worktreesLoaded && sections.length === 0 && (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {search
              ? 'No matching worktrees'
              : activeFilterCount > 0
                ? 'No worktrees match filters'
                : 'No worktrees'}
          </Text>
        </View>
      )}

      {sections.length > 0 && (
        <SectionList
          ref={sectionListRef}
          sections={sections}
          keyExtractor={(w) => w.sectionListKey ?? w.worktreeId}
          stickySectionHeadersEnabled={false}
          // Why: keep the search IME up while tapping clear / scrolling results.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollToIndexFailed={onScrollToIndexFailed}
          // Why: edge-to-edge under the system nav bar; insets.bottom keeps the last row above it.
          contentContainerStyle={[
            styles.list,
            // Reserve room so the last row stays tappable above the phone's floating "+" (embedded uses the toolbar +).
            { paddingBottom: (embedded ? spacing.lg : FAB_SIZE + spacing.xl) + insets.bottom },
            isWideLayout &&
              !embedded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
          ]}
          renderSectionHeader={({ section }) => {
            if (!section.title) {
              return null
            }
            const isCollapsed = collapsedGroups.has(section.key)
            const rawSection = rawSections.find((s) => s.key === section.key)
            const count = rawSection?.data.length ?? 0
            const repoSectionColor =
              groupMode === 'repo' ? uniqueRepoColors.get(section.title) : null
            const repoSectionIcon = groupMode === 'repo' ? repoIconsByName.get(section.title) : null
            return (
              <Pressable style={styles.sectionHeader} onPress={() => toggleCollapsed(section.key)}>
                {isCollapsed ? (
                  <ChevronRight size={12} color={colors.textMuted} style={styles.sectionIcon} />
                ) : (
                  <ChevronDown size={12} color={colors.textMuted} style={styles.sectionIcon} />
                )}
                {section.icon === 'pin' && (
                  <Pin size={12} color={colors.textMuted} style={styles.sectionIcon} />
                )}
                {groupMode === 'repo' ? (
                  <View style={styles.sectionRepoIcon}>
                    <MobileRepoIcon
                      repoIcon={repoSectionIcon}
                      size={14}
                      color={repoSectionColor ?? colors.textSecondary}
                    />
                  </View>
                ) : null}
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>{count}</Text>
              </Pressable>
            )
          }}
          ItemSeparatorComponent={ListSeparator}
          // Why (#8498): manual pull-to-refresh forces a fresh snapshot after a stale-cache reconnect.
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textSecondary}
              colors={[colors.textSecondary]}
            />
          }
          renderItem={({ item }) => (
            <WorktreeListRow
              item={item}
              isReadOnly={isReadOnly}
              now={now}
              status={getWorktreeStatus(item)}
              repoColor={uniqueRepoColors.get(item.repo) ?? repoColor(item.repo)}
              repoIcon={repoIconsByName.get(item.repo) ?? null}
              hideRepo={groupMode === 'repo'}
              onPress={openWorktreeSession}
              onLongPress={item.workspaceKind === 'folder-workspace' ? undefined : setActionTarget}
              onToggleLineage={toggleWorktreeLineage}
            />
          )}
        />
      )}

      {/* Floating "new workspace" button — phone only; embedded sidebars keep the toolbar +. */}
      {!embedded && (
        <NewWorkspaceFab onPress={openNewWorktreeModal} disabled={connState !== 'connected'} />
      )}

      <PickerModal
        visible={showSortPicker}
        title="Sort By"
        options={SORT_OPTIONS}
        selected={sortMode}
        onSelect={handleSortChange}
        onClose={() => setShowSortPicker(false)}
      />

      <PickerModal
        visible={showGroupPicker}
        title="Group By"
        options={GROUP_OPTIONS}
        selected={groupMode}
        onSelect={handleGroupChange}
        onClose={() => setShowGroupPicker(false)}
      />

      <HostScreenOverlays {...{showFilterModal,setShowFilterModal,activeFilterCount,clearFilters,filters,toggleHideSleeping,toggleHideDefaultBranch,uniqueRepos,toggleRepoFilter,actionTarget,setActionTarget,confirmDelete,setConfirmDelete,handleDeleteWorktree,hostId,hostCapabilities,navigateFromHostList,client,setSleptIds,pinnedIds,togglePin,confirmRemoveHost,setConfirmRemoveHost,hostName,handleRemoveHost,newWorktreeModalRef,showNewWorktree,existingWorktreePaths,worktrees,newWorktreeModalVisibleRef,fetchWorktrees,setShowNewWorktreeVisible}} />
    </SafeAreaView>
  )
}
