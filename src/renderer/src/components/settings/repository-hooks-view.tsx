// Concrete surface implementation for RepositoryHooksSection.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: repository hook saves and issue-command overrides synchronize debounced persistence state with external repo settings. */
import type {
  HookCommandSourcePolicy,
  OrcaHooks,
  RepoHookSettings,
  SetupAgentStartupPolicy,
  SetupRunPolicy
} from '../../../../shared/types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getRepositoryLocalCommandsSectionId } from './repository-settings-targets'
import { translate } from '@/i18n/i18n'
import type {
  RepositoryHooksSectionProps,
  HookSettingsPolicyDraft,
  getSetupRunPolicyOptions,
  getCommandSourcePolicyOptions,
  getLocalHookFields,
  getYamlStateCopy,
  getLocalCommandSourcePolicyNotice
} from './repository-hooks-model-repository-hooks-section-props'
import { ARTIFACT_URL_TEMPLATE_TOKEN } from './repository-hooks-model-repository-hooks-section-props'
import {
  SegmentedPolicyToggle,
  LocalCommandSourceNotice
} from './repository-hooks-model-get-parse-error-fixes'
import { ScriptEditor } from './repository-hooks-model-script-editor'
import { RepositoryHooksAdvancedSection } from './repository-hooks-view-advanced-section'

type RepositoryHooksViewProps = {
  repo: RepositoryHooksSectionProps['repo']
  forceVisible: boolean
  flushScriptDraftOnUnmount: (node: HTMLElement | null) => void
  localHookFields: ReturnType<typeof getLocalHookFields>
  hookSettingsDraft: RepoHookSettings
  hasSharedSetupScript: boolean
  sharedSetupScript?: string
  hasSharedArchiveScript: boolean
  sharedArchiveScript?: string
  updateScriptDraft: (hookName: 'setup' | 'archive', nextScript: string) => void
  commitScriptDraft: () => void
  selectedSetupRunPolicy: SetupRunPolicy
  selectedSetupAgentStartupPolicy: SetupAgentStartupPolicy
  setupRunPolicyOptions: ReturnType<typeof getSetupRunPolicyOptions>
  updateHookSettingsPolicyDraft: (updates: HookSettingsPolicyDraft) => void
  localCommandSourceNotice: ReturnType<typeof getLocalCommandSourcePolicyNotice>
  issueCommandDraft: string
  setIssueCommandDraft: (value: string) => void
  commitIssueCommand: () => Promise<void>
  hasSharedIssueCommand: boolean
  issueCommandSaveError: string | null
  advancedMatchesSearch: boolean
  isAdvancedOpen: boolean
  setIsAdvancedOpen: (open: boolean) => void
  commandSourcePolicyOptions: ReturnType<typeof getCommandSourcePolicyOptions>
  selectedCommandSourcePolicy: HookCommandSourcePolicy
  yamlState: string
  yamlStateCopy: ReturnType<typeof getYamlStateCopy>
  parseErrorFixes: readonly string[]
  yamlHooks: OrcaHooks | null
  copiedTemplate: boolean
  onCopyTemplate: () => void
}

export function RepositoryHooksView({
  repo,
  forceVisible,
  flushScriptDraftOnUnmount,
  localHookFields,
  hookSettingsDraft,
  hasSharedSetupScript,
  sharedSetupScript,
  hasSharedArchiveScript,
  sharedArchiveScript,
  updateScriptDraft,
  commitScriptDraft,
  selectedSetupRunPolicy,
  selectedSetupAgentStartupPolicy,
  setupRunPolicyOptions,
  updateHookSettingsPolicyDraft,
  localCommandSourceNotice,
  issueCommandDraft,
  setIssueCommandDraft,
  commitIssueCommand,
  hasSharedIssueCommand,
  issueCommandSaveError,
  advancedMatchesSearch,
  isAdvancedOpen,
  setIsAdvancedOpen,
  commandSourcePolicyOptions,
  selectedCommandSourcePolicy,
  yamlState,
  yamlStateCopy,
  parseErrorFixes,
  yamlHooks,
  copiedTemplate,
  onCopyTemplate
}: RepositoryHooksViewProps): React.JSX.Element {
  return (
    <section ref={flushScriptDraftOnUnmount} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {translate(
            'auto.components.settings.RepositoryHooksSection.ff082fe7c6',
            'Worktree Hooks'
          )}
        </h2>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryHooksSection.8567127a40',
            'Scripts that run when worktrees are created or archived. Local scripts are stored on this machine; `orca.yaml` scripts are shared with your team.'
          )}
        </p>
      </div>

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryHooksSection.52b31baf02',
          'Setup Script'
        )}
        description={translate(
          'auto.components.settings.RepositoryHooksSection.30d555acd2',
          'Local and shared scripts that run after a new worktree is created.'
        )}
        forceVisible={forceVisible}
        keywords={[
          'setup',
          'script',
          'command',
          'local',
          'local settings scripts',
          'orca.yaml',
          'orca.yaml hooks',
          'hook'
        ]}
      >
        <ScriptEditor
          key={`${repo.id}:setup`}
          field={localHookFields[0]}
          value={hookSettingsDraft.scripts.setup ?? ''}
          hasShared={hasSharedSetupScript}
          sharedScript={sharedSetupScript}
          onChange={(next) => updateScriptDraft('setup', next)}
          onCommit={commitScriptDraft}
          sectionId={getRepositoryLocalCommandsSectionId(repo.id)}
        />
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryHooksSection.fb6bebcf7e',
          'When to Run Setup'
        )}
        description={translate(
          'auto.components.settings.RepositoryHooksSection.63e1783173',
          'Choose the default behavior when a setup script is available.'
        )}
        forceVisible={forceVisible}
        keywords={['setup run policy', 'ask', 'run by default', 'skip by default']}
      >
        <div className="space-y-4 rounded-2xl border border-border/50 bg-background/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h5 className="text-sm font-semibold">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.793dcee97d',
                  'When to run'
                )}
              </h5>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.21fb607a87',
                  'Default behavior when a new worktree is created.'
                )}
              </p>
            </div>
            <SegmentedPolicyToggle
              options={setupRunPolicyOptions}
              selected={selectedSetupRunPolicy}
              onSelect={(policy) => updateHookSettingsPolicyDraft({ setupRunPolicy: policy })}
            />
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
            <div className="min-w-0 space-y-1">
              <h5 className="text-sm font-semibold">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.waitForSetupBeforeAgent',
                  'Wait for setup to complete before starting agent'
                )}
              </h5>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.waitForSetupBeforeAgentHelp',
                  'Turn this on when setup installs dependencies, MCP servers, or config files the agent needs during startup.'
                )}
              </p>
            </div>
            <SettingsSwitch
              checked={selectedSetupAgentStartupPolicy === 'wait-for-setup'}
              onChange={() =>
                updateHookSettingsPolicyDraft({
                  setupAgentStartupPolicy:
                    selectedSetupAgentStartupPolicy === 'wait-for-setup'
                      ? 'start-immediately'
                      : 'wait-for-setup'
                })
              }
              ariaLabel={translate(
                'auto.components.settings.RepositoryHooksSection.waitForSetupBeforeAgent',
                'Wait for setup to complete before starting agent'
              )}
            />
          </div>
        </div>
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryHooksSection.9a100323ff',
          'Archive Script'
        )}
        description={translate(
          'auto.components.settings.RepositoryHooksSection.b91a0f297d',
          'Local and shared scripts that run before a worktree is archived.'
        )}
        forceVisible={forceVisible}
        keywords={[
          'archive',
          'script',
          'command',
          'local',
          'local settings scripts',
          'orca.yaml',
          'orca.yaml hooks',
          'hook'
        ]}
      >
        <ScriptEditor
          key={`${repo.id}:archive`}
          field={localHookFields[1]}
          value={hookSettingsDraft.scripts.archive ?? ''}
          hasShared={hasSharedArchiveScript}
          sharedScript={sharedArchiveScript}
          onChange={(next) => updateScriptDraft('archive', next)}
          onCommit={commitScriptDraft}
        />
      </SearchableSetting>

      {localCommandSourceNotice ? (
        <LocalCommandSourceNotice
          notice={localCommandSourceNotice}
          onSelectPolicy={(policy) =>
            updateHookSettingsPolicyDraft({ commandSourcePolicy: policy })
          }
        />
      ) : null}

      <SearchableSetting
        title={translate(
          'auto.components.settings.RepositoryHooksSection.13394103bd',
          'Custom GitHub Issue Command'
        )}
        description={translate(
          'auto.components.settings.RepositoryHooksSection.2cc27dc12b',
          'Optional per-user override for the linked-issue command.'
        )}
        forceVisible={forceVisible}
        keywords={['github issue command', 'issue command', 'workflow', 'agent', 'github']}
      >
        <div className="space-y-3 rounded-2xl border border-border/50 bg-background/80 p-4 shadow-sm">
          <div className="space-y-1">
            <h5 className="text-sm font-semibold">
              {translate(
                'auto.components.settings.RepositoryHooksSection.13394103bd',
                'Custom GitHub Issue Command'
              )}
            </h5>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.RepositoryHooksSection.b997331366',
                'Optional override. Use'
              )}{' '}
              <code className="rounded bg-muted px-1 py-0.5">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.c85c2c88a2',
                  '{{artifact_url}}',
                  { artifact_url: ARTIFACT_URL_TEMPLATE_TOKEN }
                )}
              </code>{' '}
              {translate(
                'auto.components.settings.RepositoryHooksSection.70ad20f883',
                'for the linked issue or PR URL.'
              )}
            </p>
          </div>
          <textarea
            value={issueCommandDraft}
            aria-label={translate(
              'auto.components.settings.RepositoryHooksSection.13394103bd',
              'Custom GitHub Issue Command'
            )}
            onChange={(e) => setIssueCommandDraft(e.target.value)}
            onBlur={commitIssueCommand}
            placeholder={translate(
              'auto.components.settings.RepositoryHooksSection.4084720f47',
              'Complete {{artifact_url}}',
              { artifact_url: ARTIFACT_URL_TEMPLATE_TOKEN }
            )}
            rows={4}
            spellCheck={false}
            className="w-full min-w-0 resize-y rounded-md border border-input bg-muted/20 px-3 py-2 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none placeholder:italic placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryHooksSection.52aef29e69',
              'Leave blank to use the repo default from'
            )}{' '}
            <code className="rounded bg-muted px-1 py-0.5">
              {translate('auto.components.settings.RepositoryHooksSection.39da2ae12f', 'orca.yaml')}
            </code>
            {hasSharedIssueCommand
              ? '.'
              : translate(
                  'auto.components.settings.RepositoryHooksSection.9b12f15b1e',
                  'when one exists.'
                )}
          </p>
          {issueCommandSaveError ? (
            <p className="text-xs text-destructive">{issueCommandSaveError}</p>
          ) : null}
        </div>
      </SearchableSetting>

      <RepositoryHooksAdvancedSection
        forceVisible={forceVisible}
        advancedMatchesSearch={advancedMatchesSearch}
        isAdvancedOpen={isAdvancedOpen}
        setIsAdvancedOpen={setIsAdvancedOpen}
        commandSourcePolicyOptions={commandSourcePolicyOptions}
        selectedCommandSourcePolicy={selectedCommandSourcePolicy}
        updateHookSettingsPolicyDraft={updateHookSettingsPolicyDraft}
        yamlState={yamlState}
        yamlStateCopy={yamlStateCopy}
        yamlHooks={yamlHooks}
        parseErrorFixes={parseErrorFixes}
        copiedTemplate={copiedTemplate}
        onCopyTemplate={onCopyTemplate}
      />
    </section>
  )
}
