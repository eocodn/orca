/* Concrete surface implementation for AgentsPane.tsx. */
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  getAgentGeneratedTabTitlesDescription,
  getAgentGeneratedTabTitlesTitle
} from './agent-generated-tab-title-copy'
import type { AgentsPaneProps } from './agents-pane-surface-agents-pane-props-section'
export function AgentGeneratedTabTitlesSetting({
  settings,
  updateSettings
}: AgentsPaneProps): React.JSX.Element {
  const enabled = settings.tabAutoGenerateTitle === true
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={getAgentGeneratedTabTitlesTitle()}
        description={getAgentGeneratedTabTitlesDescription()}
        checked={enabled}
        onChange={() =>
          updateSettings({
            tabAutoGenerateTitle: !enabled
          })
        }
        ariaLabel={getAgentGeneratedTabTitlesTitle()}
      />
    </section>
  )
}
