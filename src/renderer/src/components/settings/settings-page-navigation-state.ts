// Concrete settings page navigation.
// Concrete surface implementation for Settings.tsx
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalSettings, OrcaHooks, ProjectHostSetup, Repo } from '../../../../shared/types'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { applyDocumentTheme } from '@/lib/document-theme'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import { getSettingsSectionSearchEntries, rankSettingsSearchItems } from './settings-search'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import {
  isWindowsTerminalCapabilityHost,
  useLocalWindowsTerminalCapabilities,
  useWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { useWindowsTerminalCapabilityOwnerKey } from '@/hooks/useWindowsTerminalCapabilityOwnerKey'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import {
  isWebClientLocation,
  useSettingsNavigationMetadata
} from '@/hooks/useSettingsNavigationMetadata'
import type {
  SettingsNavGroup,
  SettingsNavInstallStatus,
  SettingsNavSection,
  SettingsNavTarget
} from '@/lib/settings-navigation-types'
import { LINEAR_AGENT_SKILL_NAMES } from '@/lib/agent-feature-install-commands'
import { getLinearAgentSkillNavInstallStatus } from '@/lib/agent-skill-nav-install-status'
import { deriveNeededSectionIds, getInitialMountedSectionIds } from './settings-load-performance'
import { getProjectHostSetupProjectionFromState } from '../../store/selectors'
import { getRepoHostIdentity } from '../../store/slices/repo-host-identity'
import {
  buildRepoIdToHostSelection,
  buildRepoIdToRepresentative,
  buildSettingsProjectList,
  getSettingsProjectHostRepo,
  getSettingsTargetHostSelection,
  removeSettingsProjectFromAllHosts,
  resolveSettingsTargetRepoId
} from './settings-project-list'

import {
  DevToolsPane,
  SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID,
  SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS,
  getSettingsSectionId,
  getFallbackVisibleSection,
  getSettingsNavGroupDefinitionsForSearch,
  getSettingsScrollTarget,
  scrollSubsectionIntoView,
  readSourceControlAiSettings,
  cancelPendingSettingsSubsectionScrollFrame,
  isEditableTarget
} from './settings-navigation-model'

export function useSettingsPageNavigation(context: Record<string, any>): Record<string, any> {
  const {
    settings,
    repos,
    projects,
    projectHostSetups,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    settingsSearchQuery,
    setSettingsSearchQuery,
    settingsProjectList,
    setRepoHooksMap,
    isWindows,
    isWebClient,
    linearConnected,
    linearSkill,
    skillFreshnessApplies,
    activeSectionId,
    setActiveSectionId,
    mountedSectionIds,
    setMountedSectionIds,
    pendingNavRequestTick,
    setPendingNavRequestTick,
    setHiddenExperimentalUnlocked,
    contentScrollRef,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    pendingSubsectionScrollFrameRef,
    repoHooksRequestSeqRef,
    hasUnsavedSourceControlAiPromptChanges,
    confirmDiscardSourceControlAiPromptChanges
  } = context

  const applyTheme = useCallback((theme: 'system' | 'dark' | 'light') => {
    applyDocumentTheme(theme)
  }, [])

  const displayedGitUsername = repos[0]?.gitUsername ?? ''
  const baseNavSections = useSettingsNavigationMetadata()
  const {
    installed: linearSkillInstalled,
    loading: linearSkillLoading,
    skills: linearSkills
  } = linearSkill
  const capabilityInstallStatusBySectionId = useMemo(() => {
    const applicableFreshnessInventory = skillFreshnessApplies ? skillFreshnessInventory : null
    const next = new Map<string, SettingsNavInstallStatus>()
    if (linearConnected) {
      next.set(
        'linear',
        getLinearAgentSkillNavInstallStatus({
          skills: linearSkills,
          installed: linearSkillInstalled,
          loading: linearSkillLoading,
          inventory: applicableFreshnessInventory
        })
      )
    }
    return next
  }, [
    linearConnected,
    linearSkillInstalled,
    linearSkillLoading,
    linearSkills,
    settings,
    skillFreshnessApplies,
    skillFreshnessInventory,
  ])
  const navSections = useMemo(
    () =>
      baseNavSections.map((section) => {
        const installStatus = capabilityInstallStatusBySectionId.get(section.id)
        return installStatus ? { ...section, installStatus } : section
      }),
    [baseNavSections, capabilityInstallStatusBySectionId]
  )
  const navSectionById = useMemo(
    () => new Map(navSections.map((section) => [section.id, section] as const)),
    [navSections]
  )
  const getSectionSearchEntries = (sectionId: string) => {
    const section = navSectionById.get(sectionId)
    return section ? getSettingsSectionSearchEntries(section) : []
  }

  const visibleNavSections = useMemo(() => {
    const rankedSections = rankSettingsSearchItems(
      settingsSearchQuery,
      navSections,
      getSettingsSectionSearchEntries
    ).map(({ item }) => item)
    if (
      !hasUnsavedSourceControlAiPromptChanges ||
      rankedSections.some((section) => section.id === 'git')
    ) {
      return rankedSections
    }
    const gitSection = navSectionById.get('git')
    return gitSection ? [...rankedSections, gitSection] : rankedSections
  }, [hasUnsavedSourceControlAiPromptChanges, navSectionById, navSections, settingsSearchQuery])
  const visibleSectionIds = useMemo(
    () => new Set(visibleNavSections.map((section) => section.id)),
    [visibleNavSections]
  )
  const projectByRepoId = useMemo(() => {
    const projection = getProjectHostSetupProjectionFromState({
      repos,
      projects,
      projectHostSetups
    })
    const projectById = new Map(projection.projects.map((project) => [project.id, project]))
    const nextProjectByRepoId = new Map<string, (typeof projection.projects)[number]>()
    for (const setup of projection.setups) {
      const project = projectById.get(setup.projectId)
      if (project && setup.repoId.trim()) {
        nextProjectByRepoId.set(setup.repoId, project)
      }
    }
    return nextProjectByRepoId
  }, [projectHostSetups, projects, repos])
  const neededSectionIds = useMemo(
    () =>
      deriveNeededSectionIds({
        navSectionIds: navSections.map((section) => section.id),
        mountedSectionIds,
        activeSectionId,
        pendingSectionId: pendingNavSectionRef.current,
        query: settingsSearchQuery,
        visibleSectionIds
      }),
    [activeSectionId, mountedSectionIds, navSections, settingsSearchQuery, visibleSectionIds]
  )
  const windowsTerminalCapabilityOwnerKey = useWindowsTerminalCapabilityOwnerKey(
    settings?.activeRuntimeEnvironmentId
  )
  const runtimeTarget = useMemo(() => getActiveRuntimeTarget(settings), [settings])
  const capabilityLoadTarget = useMemo(
    () => (isWebClient ? { kind: 'local' as const } : runtimeTarget),
    [isWebClient, runtimeTarget]
  )
  const hasActiveRuntimeEnvironment = Boolean(settings?.activeRuntimeEnvironmentId?.trim())
  const needsRepoWindowsRuntimeCapabilities = [...neededSectionIds].some((sectionId) =>
    sectionId.startsWith('repo-')
  )
  const needsLocalWindowsRuntimeCapabilities =
    (isWindows || isWebClient) &&
    (neededSectionIds.has('agents') || neededSectionIds.has('general'))
  const shouldLoadWindowsTerminalCapabilities =
    hasActiveRuntimeEnvironment ||
    ((isWindows || isWebClient) &&
      (neededSectionIds.has('terminal') ||
        neededSectionIds.has('accounts') ||
        needsRepoWindowsRuntimeCapabilities ||
        (runtimeTarget.kind === 'local' && needsLocalWindowsRuntimeCapabilities)))
  // Why: terminal, account, and repository settings describe the active execution host.
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    shouldLoadWindowsTerminalCapabilities,
    true,
    windowsTerminalCapabilityOwnerKey,
    capabilityLoadTarget
  )
  // Why: global agent and project defaults belong to the desktop, not its active remote.
  const remoteViewLocalWindowsRuntimeCapabilities = useLocalWindowsTerminalCapabilities(
    needsLocalWindowsRuntimeCapabilities && runtimeTarget.kind === 'environment' && !isWebClient,
    true,
    'local'
  )
  const localWindowsRuntimeCapabilities =
    runtimeTarget.kind === 'local' || isWebClient
      ? windowsTerminalCapabilities
      : remoteViewLocalWindowsRuntimeCapabilities
  // Why: only supported-but-unavailable WSL (Windows) should render disabled controls, not unsupported WSL (macOS/Linux).
  const runtimeWslSupportedPlatform = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: runtimeTarget,
    hostPlatform: windowsTerminalCapabilities.hostPlatform
  })
  const localWslSupportedPlatform = isWindowsTerminalCapabilityHost({
    isWindowsRenderer: isWindows,
    isWebClient,
    target: { kind: 'local' },
    hostPlatform: localWindowsRuntimeCapabilities.hostPlatform
  })
  const isWindowsTerminalHost = runtimeWslSupportedPlatform

  if ([...neededSectionIds].some((id) => !mountedSectionIds.has(id))) {
    // Why: record newly needed sections during render so panes don't wait for a follow-up Effect.
    setMountedSectionIds(neededSectionIds)
  }

  // Why: load hooks for the selected host's repo id, not the representative id (they differ for non-default hosts).
  const neededRepos = useMemo(() => {
    const reposByHostIdentity = new Map<string, Repo>()
    for (const settingsProject of settingsProjectList) {
      if (!neededSectionIds.has(`repo-${settingsProject.representativeRepoId}`)) {
        continue
      }
      const repo = getSettingsProjectHostRepo(
        settingsProject,
        repos,
        settingsProjectHostSelection[settingsProject.projectId],
        settingsProjectSetupSelection[settingsProject.projectId]
      )
      if (repo) {
        reposByHostIdentity.set(getRepoHostIdentity(repo), repo)
      }
    }
    return [...reposByHostIdentity.values()]
  }, [
    neededSectionIds,
    repos,
    settingsProjectHostSelection,
    settingsProjectList,
    settingsProjectSetupSelection
  ])

  useEffect(() => {
    const repoHostIdentitySet = new Set(repos.map(getRepoHostIdentity))
    setRepoHooksMap((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([identity]) => repoHostIdentitySet.has(identity))
      ) as Record<string, { hasHooks: boolean; hooks: OrcaHooks | null; mayNeedUpdate: boolean }>
      return Object.keys(next).length === Object.keys(previous).length ? previous : next
    })
  }, [repos])

  useEffect(() => {
    if (neededRepos.length === 0) {
      return
    }

    let stale = false
    const requestSeq = ++repoHooksRequestSeqRef.current
    const liveRepoHostIdentities = new Set(repos.map(getRepoHostIdentity))

    void Promise.all(
      neededRepos.map(async (repo) => {
        const repoHostIdentity = getRepoHostIdentity(repo)
        if (isFolderRepo(repo)) {
          setRepoHooksMap((previous) => {
            if (previous[repoHostIdentity]) {
              return previous
            }
            return {
              ...previous,
              [repoHostIdentity]: { hasHooks: false, hooks: null, mayNeedUpdate: false }
            }
          })
          return
        }
        try {
          const hostId = getRepoExecutionHostId(repo)
          const parsedHost = parseExecutionHostId(hostId)
          const result = await checkRuntimeHooks(
            {
              activeRuntimeEnvironmentId:
                parsedHost?.kind === 'runtime' ? parsedHost.environmentId : null
            },
            repo.id,
            hostId
          )
          if (stale || requestSeq !== repoHooksRequestSeqRef.current) {
            return
          }
          setRepoHooksMap((previous) => {
            if (!liveRepoHostIdentities.has(repoHostIdentity)) {
              return previous
            }
            return { ...previous, [repoHostIdentity]: result }
          })
        } catch {
          // Keep last known value on transient failures.
          if (stale || requestSeq !== repoHooksRequestSeqRef.current) {
            return
          }
          setRepoHooksMap((previous) => {
            if (!liveRepoHostIdentities.has(repoHostIdentity)) {
              return previous
            }
            if (previous[repoHostIdentity]) {
              return previous
            }
            return {
              ...previous,
              [repoHostIdentity]: { hasHooks: false, hooks: null, mayNeedUpdate: false }
            }
          })
        }
      })
    )

    return () => {
      stale = true
    }
  }, [neededRepos, repos])

  useEffect(() => {
    const scrollTargetId = pendingScrollTargetRef.current
    const pendingNavSectionId = pendingNavSectionRef.current

    // Why: subsection deep links clear a stale filter that could hide the target row; pane-level links keep it to force-open the matching section.
    if (
      scrollTargetId &&
      pendingNavSectionId &&
      scrollTargetId !== pendingNavSectionId &&
      settingsSearchQuery.trim() !== ''
    ) {
      setSettingsSearchQuery('')
      return
    }

    if (scrollTargetId && pendingNavSectionId && visibleSectionIds.has(pendingNavSectionId)) {
      // Why: inactive panes don't render; activate the pane first, then find the subsection next render.
      if (activeSectionId !== pendingNavSectionId) {
        setActiveSectionId(pendingNavSectionId)
        return
      }
      const container = contentScrollRef.current
      if (container) {
        container.scrollTo({ top: 0 })
      }
      // Why: deep links can target a row inside the already-visible pane.
      if (scrollTargetId !== pendingNavSectionId) {
        // Why: target can arrive before the lazy section mounts; keep pending refs until it does.
        if (!getSettingsScrollTarget(scrollTargetId, container)) {
          return
        }
        const scrollToSubsection = (): void => {
          scrollSubsectionIntoView(scrollTargetId, contentScrollRef.current)
        }
        scrollToSubsection()
        cancelPendingSettingsSubsectionScrollFrame(pendingSubsectionScrollFrameRef)
        let completed = false
        let frameId: number | undefined
        frameId = requestAnimationFrame(() => {
          completed = true
          if (pendingSubsectionScrollFrameRef.current === frameId) {
            pendingSubsectionScrollFrameRef.current = null
          }
          scrollToSubsection()
        })
        if (!completed) {
          pendingSubsectionScrollFrameRef.current = frameId
        }
      }
      setActiveSectionId(pendingNavSectionId)
      pendingNavSectionRef.current = null
      pendingScrollTargetRef.current = null
      return
    }

    if (!visibleSectionIds.has(activeSectionId) && visibleNavSections.length > 0) {
      setActiveSectionId(getFallbackVisibleSection(visibleNavSections)?.id ?? activeSectionId)
    }
  }, [
    activeSectionId,
    pendingNavRequestTick,
    setSettingsSearchQuery,
    settingsSearchQuery,
    visibleSectionIds,
    visibleNavSections
  ])

  const scrollToSection = useCallback(
    async (
      sectionId: string,
      modifiers?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
    ): Promise<void> => {
      if (sectionId !== activeSectionId && !(await confirmDiscardSourceControlAiPromptChanges())) {
        return
      }
      // Why: Shift-click the Experimental row unlocks the hidden power-user group (session-only).
      if (sectionId === 'experimental' && modifiers?.shiftKey) {
        setHiddenExperimentalUnlocked((previous) => !previous)
      }
      const container = contentScrollRef.current
      if (container) {
        container.scrollTo({ top: 0 })
      }
      if (settingsSearchQuery.trim() !== '') {
        // Why: clear the search filter so selecting a result shows that pane, not the stale query's.
        setSettingsSearchQuery('')
      }
      setActiveSectionId(sectionId)
    },
    [
      activeSectionId,
      confirmDiscardSourceControlAiPromptChanges,
      setSettingsSearchQuery,
      settingsSearchQuery
    ]
  )

  return {
    applyTheme,
    baseNavSections,
    navSections,
    navSectionById,
    getSectionSearchEntries,
    visibleNavSections,
    visibleSectionIds,
    projectByRepoId,
    neededSectionIds,
    windowsTerminalCapabilities,
    localWindowsRuntimeCapabilities,
    localWslSupportedPlatform,
    isWindowsTerminalHost,
    neededRepos,
    scrollToSection
  }
}
