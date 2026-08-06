/* State contracts and draft normalization for RepositoryHooksSection. */
import type {
  HookCommandSourcePolicy,
  OrcaHooks,
  Repo,
  RepoHookSettings
} from '../../../../shared/types'
import { DEFAULT_REPO_HOOK_SETTINGS } from './SettingsConstants'
import { translate } from '@/i18n/i18n'

export type RepositoryHooksSectionProps = {
  repo: Repo
  yamlHooks: OrcaHooks | null
  hasHooksFile: boolean
  hooksInspectionReady: boolean
  mayNeedUpdate: boolean
  copiedTemplate: boolean
  forceVisible?: boolean
  onCopyTemplate: () => void
  onUpdateHookSettings: (settings: RepoHookSettings) => void
}

export type PolicyOption<P> = { policy: P; label: string; description: string }
export const LOCAL_HOOK_NAMES = ['setup', 'archive'] as const
export type LocalHookName = (typeof LOCAL_HOOK_NAMES)[number]
export type LocalHookField = {
  name: LocalHookName
  label: string
  description: string
  placeholder: string
}
export type HookSettingsPolicyDraft = Partial<
  Pick<RepoHookSettings, 'setupRunPolicy' | 'setupAgentStartupPolicy' | 'commandSourcePolicy'>
>

// Why: this is a literal issue-command template token, not app data for i18next to fill.
export const ARTIFACT_URL_TEMPLATE_TOKEN = '{{artifact_url}}'
export const EXAMPLE_TEMPLATE = `scripts:
  setup: |
    pnpm worktree:setup
  archive: |
    echo "Cleaning up before archive"
issueCommand: |
  Complete {{artifact_url}}`

export function getHookSettingsDraft(hookSettings: Repo['hookSettings']): RepoHookSettings {
  return {
    ...DEFAULT_REPO_HOOK_SETTINGS,
    ...hookSettings,
    scripts: {
      ...DEFAULT_REPO_HOOK_SETTINGS.scripts,
      ...hookSettings?.scripts
    }
  }
}

export function areHookSettingsDraftsEqual(a: RepoHookSettings, b: RepoHookSettings): boolean {
  return (
    a.mode === b.mode &&
    a.setupRunPolicy === b.setupRunPolicy &&
    a.setupAgentStartupPolicy === b.setupAgentStartupPolicy &&
    a.commandSourcePolicy === b.commandSourcePolicy &&
    a.scripts.setup === b.scripts.setup &&
    a.scripts.archive === b.scripts.archive
  )
}

export type LocalCommandSourcePolicyNotice =
  | { kind: 'checking' }
  | { kind: 'action'; policy: 'local-only' | 'run-both'; label: string }

export function getLocalCommandSourcePolicyNotice({
  hooksInspectionReady,
  currentPolicy,
  setupScript,
  archiveScript,
  hasSharedScript
}: {
  hooksInspectionReady: boolean
  currentPolicy: HookCommandSourcePolicy
  setupScript: string | undefined
  archiveScript: string | undefined
  hasSharedScript: boolean
}): LocalCommandSourcePolicyNotice | null {
  if (!setupScript?.trim() && !archiveScript?.trim()) {
    return null
  }
  if (currentPolicy !== 'shared-only') {
    return null
  }
  if (!hooksInspectionReady) {
    return { kind: 'checking' }
  }
  return hasSharedScript
    ? {
        kind: 'action',
        policy: 'run-both',
        label: translate('auto.components.settings.RepositoryHooksSection.8d6c56bff8', 'Run both')
      }
    : {
        kind: 'action',
        policy: 'local-only',
        label: translate(
          'auto.components.settings.RepositoryHooksSection.8bfe65fc60',
          'Use local commands'
        )
      }
}

export {
  YAML_STATE_STYLES,
  getSetupRunPolicyOptions,
  getCommandSourcePolicyOptions,
  getCommandSourceLabel,
  getLocalHookFields,
  getEnvVars,
  getYamlStateCopy
} from './repository-hooks-model-copy'
