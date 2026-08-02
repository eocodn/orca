// Concrete surface implementation for RepositoryHooksSection.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: repository hook saves and issue-command overrides synchronize debounced persistence state with external repo settings. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HookCommandSourcePolicy,
  OrcaHooks,
  Repo,
  RepoHookSettings,
  SetupAgentStartupPolicy,
  SetupRunPolicy
} from '../../../../shared/types'
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { useAppStore } from '@/store'
import { readRuntimeIssueCommand, writeRuntimeIssueCommand } from '@/runtime/runtime-hooks-client'
import { DEFAULT_REPO_HOOK_SETTINGS } from './SettingsConstants'
import { resolveHookCommandSourcePolicy } from '../../../../shared/hook-command-source-policy'
import { getRepositoryLocalCommandsSectionId } from './repository-settings-targets'
import { matchesSettingsSearch } from './settings-search'
import { translate } from '@/i18n/i18n'
import { getRepositoryHookScriptTextareaRows } from '@/lib/script-textarea-rows'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'

import { LOCAL_HOOK_NAMES, ARTIFACT_URL_TEMPLATE_TOKEN, EXAMPLE_TEMPLATE, getHookSettingsDraft, areHookSettingsDraftsEqual, getLocalCommandSourcePolicyNotice, YAML_STATE_STYLES, getSetupRunPolicyOptions, getCommandSourcePolicyOptions, getCommandSourceLabel, getLocalHookFields, getEnvVars, getYamlStateCopy } type { RepositoryHooksSectionProps, PolicyOption, LocalHookName, HookSettingsPolicyDraft, LocalHookField, LocalCommandSourcePolicyNotice } from './repository-hooks-model-repository-hooks-section-props'
import { getParseErrorFixes, PolicyOptionGrid, SegmentedPolicyToggle, ExampleTemplateCard, YamlScriptBlock, EnvVarChips, SaveIndicator, LocalCommandSourceNotice } type { SaveStatus, ScriptEditorProps } from './repository-hooks-model-get-parse-error-fixes'
import { ScriptEditor } from './repository-hooks-model-script-editor'
export { LOCAL_HOOK_NAMES, ARTIFACT_URL_TEMPLATE_TOKEN, EXAMPLE_TEMPLATE, getHookSettingsDraft, areHookSettingsDraftsEqual, getLocalCommandSourcePolicyNotice, YAML_STATE_STYLES, getSetupRunPolicyOptions, getCommandSourcePolicyOptions, getCommandSourceLabel, getLocalHookFields, getEnvVars, getYamlStateCopy, getParseErrorFixes, PolicyOptionGrid, SegmentedPolicyToggle, ExampleTemplateCard, YamlScriptBlock, EnvVarChips, SaveIndicator, LocalCommandSourceNotice, ScriptEditor }
export type { RepositoryHooksSectionProps, PolicyOption, LocalHookName, HookSettingsPolicyDraft, LocalHookField, LocalCommandSourcePolicyNotice, SaveStatus, ScriptEditorProps }

export function RepositoryHooksSection({
  repo,
  yamlHooks,
  hasHooksFile,
  hooksInspectionReady,
  mayNeedUpdate,
  copiedTemplate,
  forceVisible = false,
  onCopyTemplate,
  onUpdateHookSettings
}: RepositoryHooksSectionProps): React.JSX.Element {
  // Why: this component uses the lightweight translate() helper; subscribe here
  // so render-time option/copy builders refresh when the UI language changes.
  useTranslation()
  const settingsSearchQuery = useAppStore((s) => s.settingsSearchQuery)
  const selectedHostId = getRepoExecutionHostId(repo)
  const repoHostIdentity = `${selectedHostId}\0${repo.id}`
  const hookRuntimeSettings = useMemo(() => {
    const parsedHost = parseExecutionHostId(selectedHostId)
    return {
      activeRuntimeEnvironmentId: parsedHost?.kind === 'runtime' ? parsedHost.environmentId : null
    }
  }, [selectedHostId])
  const yamlState = yamlHooks
    ? 'loaded'
    : hasHooksFile
      ? mayNeedUpdate
        ? 'update-available'
        : 'invalid'
      : 'missing'

  const [hookSettingsDraft, setHookSettingsDraft] = useState(() =>
    getHookSettingsDraft(repo.hookSettings)
  )
  const hookSettingsDraftRef = useRef(hookSettingsDraft)
  hookSettingsDraftRef.current = hookSettingsDraft
  const localCommandsRepoIdentityRef = useRef(repoHostIdentity)
  const localCommandsDraftDirtyRef = useRef(false)
  const localCommandsAutosaveTimerRef = useRef<number | null>(null)
  const persistRef = useRef(onUpdateHookSettings)
  persistRef.current = onUpdateHookSettings
  const localCommandsPersistForRepoRef = useRef(onUpdateHookSettings)

  const selectedSetupRunPolicy: SetupRunPolicy =
    hookSettingsDraft.setupRunPolicy ?? 'run-by-default'
  const selectedSetupAgentStartupPolicy: SetupAgentStartupPolicy =
    hookSettingsDraft.setupAgentStartupPolicy ?? 'start-immediately'
  const setupRunPolicyOptions = getSetupRunPolicyOptions()
  const commandSourcePolicyOptions = getCommandSourcePolicyOptions()
  const localHookFields = getLocalHookFields()
  const yamlStateCopy = getYamlStateCopy(yamlState)
  const parseErrorFixes = getParseErrorFixes()

  const [issueCommandDraft, setIssueCommandDraft] = useState('')
  const [hasSharedIssueCommand, setHasSharedIssueCommand] = useState(false)
  const [issueCommandSaveError, setIssueCommandSaveError] = useState<string | null>(null)
  const issueCommandDraftRef = useRef(issueCommandDraft)
  issueCommandDraftRef.current = issueCommandDraft
  const lastCommittedIssueCommandRef = useRef('')

  const syncHookSettingsDraft = useCallback((next: RepoHookSettings) => {
    if (areHookSettingsDraftsEqual(hookSettingsDraftRef.current, next)) {
      return
    }
    hookSettingsDraftRef.current = next
    setHookSettingsDraft(next)
  }, [])

  const persistHookSettings = useCallback((next: RepoHookSettings) => {
    hookSettingsDraftRef.current = next
    setHookSettingsDraft(next)
    localCommandsDraftDirtyRef.current = false
    persistRef.current(next)
  }, [])

  const clearLocalCommandsAutosaveTimer = useCallback(() => {
    if (localCommandsAutosaveTimerRef.current !== null) {
      window.clearTimeout(localCommandsAutosaveTimerRef.current)
      localCommandsAutosaveTimerRef.current = null
    }
  }, [])

  const flushScriptDraft = useCallback(
    (persistHookSettings?: (settings: RepoHookSettings) => void) => {
      clearLocalCommandsAutosaveTimer()
      if (!localCommandsDraftDirtyRef.current) {
        return
      }
      localCommandsDraftDirtyRef.current = false
      const persist = persistHookSettings ?? persistRef.current
      persist(hookSettingsDraftRef.current)
    },
    [clearLocalCommandsAutosaveTimer]
  )

  const queueScriptDraftPersist = useCallback(() => {
    localCommandsDraftDirtyRef.current = true
    clearLocalCommandsAutosaveTimer()
    // Why: repo settings persistence may be an SSH RPC; coalesce typing bursts
    // so a pasted script does not enqueue one repo.update call per character.
    localCommandsAutosaveTimerRef.current = window.setTimeout(() => {
      flushScriptDraft()
    }, 700)
  }, [clearLocalCommandsAutosaveTimer, flushScriptDraft])

  const updateScriptDraft = useCallback(
    (hookName: LocalHookName, nextScript: string) => {
      const current = hookSettingsDraftRef.current
      const next: RepoHookSettings = {
        ...current,
        scripts: {
          ...current.scripts,
          [hookName]: nextScript
        }
      }
      hookSettingsDraftRef.current = next
      setHookSettingsDraft(next)
      // Why: changing local commands should not silently change Command Source;
      // if local commands are excluded, the warning below offers an explicit switch.
      queueScriptDraftPersist()
    },
    [queueScriptDraftPersist]
  )

  const commitScriptDraft = useCallback(() => {
    flushScriptDraft()
  }, [flushScriptDraft])

  // Why: unmount can happen before textareas blur; the root ref preserves the
  // pending local-command save without paying for a cleanup-only Effect.
  const flushScriptDraftOnUnmount = useCallback(
    (node: HTMLElement | null): void => {
      if (node === null) {
        flushScriptDraft()
      }
    },
    [flushScriptDraft]
  )

  const updateHookSettingsPolicyDraft = useCallback(
    (updates: HookSettingsPolicyDraft) => {
      persistHookSettings({ ...hookSettingsDraftRef.current, ...updates })
    },
    [persistHookSettings]
  )

  // Why: repo switches reset state before textareas can blur, so flush the
  // dirty draft through the previous repo's captured updater.
  useEffect(() => {
    const next = getHookSettingsDraft(repo.hookSettings)
    const isSameRepo = localCommandsRepoIdentityRef.current === repoHostIdentity

    if (isSameRepo) {
      localCommandsPersistForRepoRef.current = onUpdateHookSettings
      if (!localCommandsDraftDirtyRef.current) {
        syncHookSettingsDraft(next)
      }
      return
    }

    flushScriptDraft(localCommandsPersistForRepoRef.current)
    localCommandsRepoIdentityRef.current = repoHostIdentity
    localCommandsPersistForRepoRef.current = onUpdateHookSettings
    hookSettingsDraftRef.current = next
    setHookSettingsDraft(next)
  }, [
    flushScriptDraft,
    onUpdateHookSettings,
    repo.hookSettings,
    repoHostIdentity,
    syncHookSettingsDraft
  ])

  useEffect(() => {
    let cancelled = false
    const repoId = repo.id

    setIssueCommandDraft('')
    setHasSharedIssueCommand(false)
    setIssueCommandSaveError(null)

    // Why: the pane can show a host other than the globally focused runtime;
    // route both runtime RPC and local/SSH IPC by the selected repo owner.
    void readRuntimeIssueCommand(hookRuntimeSettings, repoId, selectedHostId)
      .then((result) => {
        if (cancelled) {
          return
        }
        const localContent = result.localContent ?? ''
        setIssueCommandDraft(localContent)
        setHasSharedIssueCommand(Boolean(result.sharedContent))
        lastCommittedIssueCommandRef.current = localContent
      })
      .catch(() => {
        if (!cancelled) {
          setIssueCommandDraft('')
          setHasSharedIssueCommand(false)
          lastCommittedIssueCommandRef.current = ''
        }
      })

    return () => {
      cancelled = true
      const draft = issueCommandDraftRef.current.trim()
      if (draft !== lastCommittedIssueCommandRef.current) {
        void writeRuntimeIssueCommand(hookRuntimeSettings, repoId, draft, selectedHostId).catch(
          (err) => {
            console.error('[RepositoryHooksSection] Failed to save issue command on unmount:', err)
          }
        )
      }
    }
  }, [hookRuntimeSettings, repo.id, repoHostIdentity, selectedHostId])

  const commitIssueCommand = useCallback(async (): Promise<void> => {
    const trimmed = issueCommandDraft.trim()
    setIssueCommandDraft(trimmed)
    try {
      await writeRuntimeIssueCommand(hookRuntimeSettings, repo.id, trimmed, selectedHostId)
      lastCommittedIssueCommandRef.current = trimmed
      setIssueCommandSaveError(null)
    } catch (err) {
      console.error('[RepositoryHooksSection] Failed to write issue command:', err)
      const message = err instanceof Error ? err.message : 'Failed to save GitHub issue command.'
      setIssueCommandSaveError(message)
      toast.error(message)
    }
  }, [hookRuntimeSettings, issueCommandDraft, repo.id, selectedHostId])

  const sharedSetupScript = yamlHooks?.scripts.setup
  const sharedArchiveScript = yamlHooks?.scripts.archive
  const hasSharedSetupScript = Boolean(sharedSetupScript?.trim())
  const hasSharedArchiveScript = Boolean(sharedArchiveScript?.trim())
  const hasSharedScript = Boolean(sharedSetupScript?.trim() || sharedArchiveScript?.trim())
  const hasLocalScript = Boolean(
    hookSettingsDraft.scripts.setup?.trim() || hookSettingsDraft.scripts.archive?.trim()
  )
  const selectedCommandSourcePolicy: HookCommandSourcePolicy = resolveHookCommandSourcePolicy(
    hookSettingsDraft.commandSourcePolicy,
    { hasLocalScript }
  )
  const localCommandSourceNotice = getLocalCommandSourcePolicyNotice({
    hooksInspectionReady,
    currentPolicy: selectedCommandSourcePolicy,
    setupScript: hookSettingsDraft.scripts.setup,
    archiveScript: hookSettingsDraft.scripts.archive,
    hasSharedScript
  })
  const advancedMatchesSearch =
    settingsSearchQuery.trim() !== '' &&
    matchesSettingsSearch(settingsSearchQuery, {
      title: translate('auto.components.settings.RepositoryHooksSection.c9bc1bfd8f', 'Advanced'),
      description: translate(
        'auto.components.settings.RepositoryHooksSection.610d90fdbd',
        'Command source and orca.yaml details.'
      ),
      keywords: [
        translate('auto.components.settings.RepositoryHooksSection.c5a55a2d2e', 'advanced'),
        translate('auto.components.settings.RepositoryHooksSection.4611b78617', 'command source'),
        translate('auto.components.settings.RepositoryHooksSection.39da2ae12f', 'orca.yaml'),
        translate('auto.components.settings.RepositoryHooksSection.d2b3016c20', 'shared'),
        translate('auto.components.settings.RepositoryHooksSection.2d03a514db', 'local'),
        translate('auto.components.settings.RepositoryHooksSection.0518758f38', 'both'),
   return (
    <RepositoryHooksView
      repo={repo}
      forceVisible={forceVisible}
      flushScriptDraftOnUnmount={flushScriptDraftOnUnmount}
      localHookFields={localHookFields}
      hookSettingsDraft={hookSettingsDraft}
      hasSharedSetupScript={hasSharedSetupScript}
      sharedSetupScript={sharedSetupScript}
      hasSharedArchiveScript={hasSharedArchiveScript}
      sharedArchiveScript={sharedArchiveScript}
      updateScriptDraft={updateScriptDraft}
      commitScriptDraft={commitScriptDraft}
      selectedSetupRunPolicy={selectedSetupRunPolicy}
      selectedSetupAgentStartupPolicy={selectedSetupAgentStartupPolicy}
      setupRunPolicyOptions={setupRunPolicyOptions}
      updateHookSettingsPolicyDraft={updateHookSettingsPolicyDraft}
      localCommandSourceNotice={localCommandSourceNotice}
      issueCommandDraft={issueCommandDraft}
      setIssueCommandDraft={setIssueCommandDraft}
      commitIssueCommand={commitIssueCommand}
      hasSharedIssueCommand={hasSharedIssueCommand}
      issueCommandSaveError={issueCommandSaveError}
      advancedMatchesSearch={advancedMatchesSearch}
      isAdvancedOpen={isAdvancedOpen}
      setIsAdvancedOpen={setIsAdvancedOpen}
      commandSourcePolicyOptions={commandSourcePolicyOptions}
      selectedCommandSourcePolicy={selectedCommandSourcePolicy}
      yamlState={yamlState}
      yamlStateCopy={yamlStateCopy}
      parseErrorFixes={parseErrorFixes}
      yamlHooks={yamlHooks}
      copiedTemplate={copiedTemplate}
      onCopyTemplate={onCopyTemplate}
    />
  )      onCopyTemplate={onCopyTemplate}
                />
              )}
            </div>
          </div>
        </details>
      </SearchableSetting>
    </section>
  )
}

export function renderYamlScriptPreview(hooks: OrcaHooks | null): string {
  const fmt = (key: string, cmd?: string): string =>
    cmd ? `\n  ${key}: |\n${cmd.replace(/^/gm, '    ')}` : ''
  const issueCommand = hooks?.issueCommand
    ? `\nissueCommand: |\n${hooks.issueCommand.replace(/^/gm, '  ')}`
    : ''
  return `scripts:${fmt('setup', hooks?.scripts.setup)}${fmt('archive', hooks?.scripts.archive)}${issueCommand}`
}
