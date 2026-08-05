import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { BottomDrawer } from './BottomDrawer'
import { BottomDrawerModalHost } from './bottom-drawer-modal-host'
import { PickerListDrawer } from './PickerListDrawer'
import { MobileAgentIcon } from './MobileAgentIcon'
import { SmartWorkspaceAdvancedFields } from './SmartWorkspaceAdvancedFields'
import { SmartWorkspaceSourceDrawer } from './SmartWorkspaceSourceDrawer'
import { SmartWorkspaceSourceField } from './SmartWorkspaceSourceField'
import { SetupHookTrustDrawer } from './SetupHookTrustDrawer'
import { colors } from '../theme/mobile-theme'
import { styles } from './new-worktree-modal-styles'

type ViewProps = Record<string, any>

export function NewWorktreeModalView(props: ViewProps) {
  const {
    visible,
    drawerView,
    onClose,
    closeSetupTrust,
    transitionDrawer,
    formSheetVisible,
    formSheetInteractive,
    loading,
    repos,
    selectedRepo,
    repoBadgeColor,
    prepareSelectionPickerOpen,
    composer,
    selectedRepoIsGit,
    sshGate,
    setError,
    openSourceDrawer,
    selectedRepoConnectionId,
    workspaceSshStatusLabel,
    connectSelectedSshRepo,
    selectedAgent,
    setShowAdvanced,
    showAdvanced,
    note,
    setNote,
    setupCommand,
    setupSource,
    setupRunPolicy,
    setupDecisionChoice,
    setSetupDecisionChoice,
    runSetup,
    setRunSetup,
    canCreate,
    handleCreate,
    creating,
    sourceAvailability,
    client,
    pasteRepos,
    repoPickerItems,
    handleRepoSelected,
    pickerAgentOptions,
    setAgentOverridden,
    setSelectedAgent,
    setupTrustPrompt,
    approveSetupTrust,
    skipSetupTrust
  } = props
  return (
    // Why: hosting the form and every picker in one persistent native Modal makes
    // form → repo/agent transitions in-window view swaps, avoiding a
    // dismiss-then-present race that left the dropdowns unresponsive. Native back
    // closes the flow from the form, routes the trust prompt through its in-flight
    // guard, and otherwise returns to the form from a picker.
    <BottomDrawerModalHost
      visible={visible}
      onRequestClose={() => {
        if (drawerView === 'form') {
          onClose()
        } else if (drawerView === 'trust') {
          closeSetupTrust()
        } else {
          transitionDrawer('form')
        }
      }}
    >
      <BottomDrawer visible={formSheetVisible} interactive={formSheetInteractive} onClose={onClose}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Workspace</Text>
          <Text style={styles.subtitle}>
            Pick a repository and agent to spin up a new workspace.
          </Text>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : repos.length === 0 ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.emptyText}>No repositories found</Text>
          </View>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Repository</Text>
              <Pressable
                style={styles.fieldButton}
                onPress={() => {
                  prepareSelectionPickerOpen()
                  transitionDrawer('repo')
                }}
              >
                {selectedRepo ? (
                  <View
                    style={[styles.repoDot, { backgroundColor: repoBadgeColor(selectedRepo) }]}
                  />
                ) : null}
                <Text
                  style={[styles.fieldButtonText, !selectedRepo && styles.fieldButtonPlaceholder]}
                  numberOfLines={1}
                >
                  {selectedRepo?.displayName ?? 'Select a repository'}
                </Text>
                <ChevronDown size={14} color={colors.textMuted} />
              </Pressable>
            </View>

            <SmartWorkspaceSourceField
              composer={composer}
              label={selectedRepoIsGit ? "Name or 'Create From'" : 'Workspace name'}
              disabled={sshGate.requiresConnection}
              interactive={formSheetInteractive}
              onBeforeOpen={() => setError('')}
              onOpenDrawer={openSourceDrawer}
            />

            {composer.forkPushWarning ? (
              <Text style={styles.sourceWarning}>{composer.forkPushWarning}</Text>
            ) : null}

            {selectedRepoConnectionId ? (
              <View style={styles.field}>
                <Text style={styles.label}>SSH Connection</Text>
                <View style={styles.sshBox}>
                  <View style={styles.sshRow}>
                    <View
                      style={[
                        styles.sshDot,
                        sshGate.status === 'connected'
                          ? styles.sshDotConnected
                          : sshGate.connectInProgress
                            ? styles.sshDotProgress
                            : styles.sshDotDisconnected
                      ]}
                    />
                    <View style={styles.sshCopy}>
                      <Text style={styles.sshTitle} numberOfLines={1}>
                        {selectedRepo?.displayName ?? 'Remote repository'}
                      </Text>
                      <Text style={styles.sshSubtitle}>
                        {workspaceSshStatusLabel(sshGate.status)}
                      </Text>
                    </View>
                    {sshGate.status === 'connected' ? null : (
                      <Pressable
                        style={[
                          styles.sshConnectButton,
                          sshGate.connectInProgress && styles.disabled
                        ]}
                        disabled={sshGate.connectInProgress}
                        onPress={() => void connectSelectedSshRepo()}
                      >
                        <Text style={styles.sshConnectText}>
                          {sshGate.connectInProgress ? 'Connecting...' : 'Connect'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  {sshGate.error ? <Text style={styles.errorInline}>{sshGate.error}</Text> : null}
                </View>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Agent</Text>
              <Pressable
                style={[styles.fieldButton, sshGate.requiresConnection && styles.disabled]}
                disabled={sshGate.requiresConnection}
                onPress={() => {
                  prepareSelectionPickerOpen()
                  transitionDrawer('agent')
                }}
              >
                <MobileAgentIcon agentId={selectedAgent.id} size={16} />
                <Text style={styles.fieldButtonText} numberOfLines={1}>
                  {sshGate.requiresConnection ? 'Connect repository first' : selectedAgent.label}
                </Text>
                <ChevronDown size={14} color={colors.textMuted} />
              </Pressable>
            </View>

            <Pressable style={styles.advancedToggle} onPress={() => setShowAdvanced(!showAdvanced)}>
              <Text style={styles.advancedText}>Advanced</Text>
              {showAdvanced ? (
                <ChevronUp size={14} color={colors.textSecondary} />
              ) : (
                <ChevronDown size={14} color={colors.textSecondary} />
              )}
            </Pressable>

            {showAdvanced && (
              <>
                <SmartWorkspaceAdvancedFields
                  composer={composer}
                  selectedRepoIsGit={selectedRepoIsGit}
                />

                <View style={styles.field}>
                  <Text style={styles.label}>Note</Text>
                  <TextInput
                    style={styles.input}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Write a note"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {setupCommand ? (
                  <View style={styles.field}>
                    <View style={styles.setupHeader}>
                      <Text style={styles.label}>Setup script</Text>
                      {setupSource && (
                        <View style={styles.sourceBadge}>
                          <Text style={styles.sourceBadgeText}>
                            {setupSource === 'orca.yaml' ? 'ORCA.YAML' : 'HOOKS'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.setupBox}>
                      {setupRunPolicy === 'ask' ? (
                        <View style={styles.setupChoiceRow}>
                          <Pressable
                            style={[
                              styles.setupChoiceButton,
                              setupDecisionChoice === 'run' && styles.setupChoiceButtonSelected
                            ]}
                            onPress={() => setSetupDecisionChoice('run')}
                          >
                            <Text style={styles.setupChoiceText}>Run</Text>
                          </Pressable>
                          <Pressable
                            style={[
                              styles.setupChoiceButton,
                              setupDecisionChoice === 'skip' && styles.setupChoiceButtonSelected
                            ]}
                            onPress={() => setSetupDecisionChoice('skip')}
                          >
                            <Text style={styles.setupChoiceText}>Skip</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.setupToggleRow}>
                          <Text style={styles.setupToggleLabel}>Run setup command</Text>
                          <Switch
                            value={runSetup}
                            onValueChange={setRunSetup}
                            trackColor={{ false: colors.borderSubtle, true: colors.textSecondary }}
                            thumbColor={colors.textPrimary}
                            style={styles.setupSwitch}
                          />
                        </View>
                      )}
                      <View style={styles.setupCommandBlock}>
                        <Text style={styles.setupCommand}>{setupCommand}</Text>
                      </View>
                    </View>
                  </View>
                ) : null}
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
                disabled={!canCreate}
                onPress={() => void handleCreate()}
              >
                {creating ? (
                  <ActivityIndicator size="small" color={colors.bgBase} />
                ) : (
                  <Text style={styles.createText}>
                    {sshGate.requiresConnection ? 'Connect Repository' : 'Create Workspace'}
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </BottomDrawer>

      {/* Why: list drawers stay outside the form's ScrollView, and the transition
          state lets each hosted overlay finish hiding before the next appears. */}
      <SmartWorkspaceSourceDrawer
        visible={visible && drawerView === 'source'}
        client={client}
        composer={composer}
        availability={sourceAvailability}
        repoId={selectedRepo?.id ?? null}
        repos={pasteRepos}
        sshReady={!sshGate.requiresConnection}
        onRepoChange={(repoId) => {
          const nextRepo = repos.find((repo) => repo.id === repoId)
          if (nextRepo) {
            setSelectedRepo(nextRepo)
          }
        }}
        onClose={() => transitionDrawer('form')}
      />

      <PickerListDrawer
        visible={visible && drawerView === 'repo'}
        title="Repository"
        items={repoPickerItems}
        selectedId={selectedRepo?.id ?? ''}
        onSelect={(item) => handleRepoSelected(item.repo)}
        onClose={() => transitionDrawer('form')}
        renderIcon={(item) => {
          return <View style={[styles.repoDot, { backgroundColor: repoBadgeColor(item.repo) }]} />
        }}
      />

      <PickerListDrawer
        visible={visible && drawerView === 'agent'}
        title="Agent"
        items={pickerAgentOptions}
        selectedId={selectedAgent.id}
        onSelect={(agent) => {
          setAgentOverridden(true)
          setSelectedAgent(agent)
        }}
        onClose={() => transitionDrawer('form')}
        renderIcon={(agent) => <MobileAgentIcon agentId={agent.id} size={18} />}
      />

      <SetupHookTrustDrawer
        visible={visible && drawerView === 'trust' && setupTrustPrompt != null}
        prompt={setupTrustPrompt}
        busy={creating}
        onRunOnce={() => void approveSetupTrust(false)}
        onAlwaysTrust={() => void approveSetupTrust(true)}
        onDontRun={skipSetupTrust}
        onClose={closeSetupTrust}
      />
    </BottomDrawerModalHost>
  )
}
