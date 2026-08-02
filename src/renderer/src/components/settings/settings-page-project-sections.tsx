import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host'
import { translate } from '@/i18n/i18n'
import { getRepoHostIdentity } from '../../store/slices/repo-host-identity'
import { RepositoryPane } from './RepositoryPane'
import { SettingsSection } from './SettingsSection'

export function SettingsPageProjectSections({
  context
}: {
  context: Record<string, any>
}): React.JSX.Element {
  const {
    settingsProjectList,
    repos,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    repoHooksMap,
    projectByRepoId,
    isSectionMounted,
    getSectionSearchEntries,
    updateRepo,
    removeProjectAllHosts,
    updateProject,
    windowsTerminalCapabilities,
    isWindowsTerminalHost
  } = context

  return (
    <>
                {settingsProjectList.map((settingsProject) => {
                  const repoSectionId = `repo-${settingsProject.representativeRepoId}`
                  // Why: use the switcher-selected host's repo so identity/host-specific edits follow "Available Hosts".
                  const repo = getSettingsProjectHostRepo(
                    settingsProject,
                    repos,
                    settingsProjectHostSelection[settingsProject.projectId],
                    settingsProjectSetupSelection[settingsProject.projectId]
                  )
                  if (!repo) {
                    return null
                  }
                  const repoHostIdentity = getRepoHostIdentity(repo)
                  const repoHooksState = repoHooksMap[repoHostIdentity]
                  const project = projectByRepoId.get(repo.id) ?? settingsProject.project

                  return (
                    <SettingsSection
                      key={repoSectionId}
                      id={repoSectionId}
                      title={translate(
                        'auto.components.settings.Settings.3bf149e873',
                        'Project Settings > {{value0}}',
                        { value0: project.displayName }
                      )}
                      description={repo.path}
                      searchEntries={getSectionSearchEntries(repoSectionId)}
                    >
                      {isSectionMounted(repoSectionId) ? (
                        // Why: re-key per host so same-id hosts don't reuse the prior host's drafts/effects.
                        <RepositoryPane
                          key={repoHostIdentity}
                          repo={repo}
                          yamlHooks={repoHooksState?.hooks ?? null}
                          hasHooksFile={repoHooksState?.hasHooks ?? false}
                          hooksInspectionReady={Boolean(repoHooksState)}
                          mayNeedUpdate={repoHooksState?.mayNeedUpdate ?? false}
                          updateRepo={updateRepo}
                          removeProject={() => void removeProjectAllHosts(settingsProject.setups)}
                          project={project}
                          selectedProjectSetupId={
                            settingsProjectSetupSelection[settingsProject.projectId]
                          }
                          isLocalWindowsProject={
                            getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
                            isWindowsTerminalHost
                          }
                          wslAvailable={windowsTerminalCapabilities.wslAvailable}
                          wslDistros={windowsTerminalCapabilities.wslDistros}
                          wslCapabilitiesLoading={windowsTerminalCapabilities.isLoading}
                          updateProject={updateProject}
                        />
                      ) : null}
                    </SettingsSection>
                  )
                })}

    </>
  )
}