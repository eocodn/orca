// Concrete surface implementation for RepositoryHooksSection.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: repository hook saves and issue-command overrides synchronize debounced persistence state with external repo settings. */
import type {
  HookCommandSourcePolicy,
  OrcaHooks,
  RepoHookSettings,
  SetupAgentStartupPolicy,
  SetupRunPolicy
} from '../../../../shared/types'
import { AlertTriangle, ChevronRight } from 'lucide-react'
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
import {
  ARTIFACT_URL_TEMPLATE_TOKEN,
  YAML_STATE_STYLES,
  getCommandSourceLabel
} from './repository-hooks-model-repository-hooks-section-props'
import {
  PolicyOptionGrid,
  SegmentedPolicyToggle,
  ExampleTemplateCard,
  YamlScriptBlock,
  LocalCommandSourceNotice
} from './repository-hooks-model-get-parse-error-fixes'
import { ScriptEditor } from './repository-hooks-model-script-editor'

function renderYamlScriptPreview(hooks: OrcaHooks | null): string {
  const formatScript = (key: string, command?: string): string =>
    command ? `\n  ${key}: |\n${command.replace(/^/gm, '    ')}` : ''
  const issueCommand = hooks?.issueCommand
    ? `\nissueCommand: |\n${hooks.issueCommand.replace(/^/gm, '  ')}`
    : ''
  return `scripts:${formatScript('setup', hooks?.scripts.setup)}${formatScript('archive', hooks?.scripts.archive)}${issueCommand}`
}

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

      <SearchableSetting
        title={translate('auto.components.settings.RepositoryHooksSection.c9bc1bfd8f', 'Advanced')}
        description={translate(
          'auto.components.settings.RepositoryHooksSection.610d90fdbd',
          'Command source and orca.yaml details.'
        )}
        forceVisible={forceVisible}
        keywords={[
          'advanced',
          'command source',
          'orca.yaml',
          'shared',
          'local',
          'both',
          'authoritative'
        ]}
      >
        <details
          className="group rounded-2xl border border-border/50 bg-background/80 shadow-sm"
          open={advancedMatchesSearch || isAdvancedOpen}
          onToggle={(event) => {
            if (advancedMatchesSearch) {
              event.currentTarget.open = true
              return
            }
            setIsAdvancedOpen(event.currentTarget.open)
          }}
        >
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"
            onClick={(event) => {
              if (advancedMatchesSearch) {
                event.preventDefault()
              }
            }}
          >
            <div className="flex items-center gap-2">
              <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
              <h5 className="text-sm font-semibold">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.c9bc1bfd8f',
                  'Advanced'
                )}
              </h5>
              <span className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.RepositoryHooksSection.bbbd6e0bc4',
                  'Command source & orca.yaml'
                )}
              </span>
            </div>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
              {getCommandSourceLabel(selectedCommandSourcePolicy)}
            </span>
          </summary>

          <div className="space-y-5 border-t border-border/50 px-4 py-4">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {translate(
                    'auto.components.settings.RepositoryHooksSection.32fec28f5b',
                    'Command Source'
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {translate(
                    'auto.components.settings.RepositoryHooksSection.ac9038d2cc',
                    'When both'
                  )}{' '}
                  <code className="rounded bg-muted px-1 py-0.5">
                    {translate(
                      'auto.components.settings.RepositoryHooksSection.39da2ae12f',
                      'orca.yaml'
                    )}
                  </code>{' '}
                  {translate(
                    'auto.components.settings.RepositoryHooksSection.3397879bee',
                    'and local commands exist, choose which run.'
                  )}
                </p>
              </div>
              <PolicyOptionGrid
                options={commandSourcePolicyOptions}
                selected={selectedCommandSourcePolicy}
                onSelect={(policy) =>
                  updateHookSettingsPolicyDraft({ commandSourcePolicy: policy })
                }
                columns="md:grid-cols-3"
              />
            </div>

            <div className={`space-y-3 rounded-xl border p-3 ${YAML_STATE_STYLES[yamlState].card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p
                    className={`text-sm font-medium ${YAML_STATE_STYLES[yamlState].titleClassName}`}
                  >
                    {yamlStateCopy.heading}
                  </p>
                  <p className="text-xs text-muted-foreground">{yamlStateCopy.description}</p>
                </div>
              </div>

              {yamlState === 'loaded' ? (
                <YamlScriptBlock content={renderYamlScriptPreview(yamlHooks)} />
              ) : yamlState === 'invalid' ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-background/60 p-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p>
                        {translate(
                          'auto.components.settings.RepositoryHooksSection.af49e2a19e',
                          'The file is present, but Orca could not find valid `scripts` or `issueCommand` definitions.'
                        )}
                      </p>
                      <ol className="space-y-1.5 pl-4 text-[11.5px]">
                        {parseErrorFixes.map((fix) => (
                          <li key={fix} className="list-decimal leading-5">
                            {fix}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                  <ExampleTemplateCard
                    copiedTemplate={copiedTemplate}
                    onCopyTemplate={onCopyTemplate}
                  />
                </div>
              ) : (
                <ExampleTemplateCard
                  copiedTemplate={copiedTemplate}
                  onCopyTemplate={onCopyTemplate}
                />
              )}
            </div>
          </div>
        </details>
      </SearchableSetting>
    </section>
  )
}
