import type { AgentTabActionId, KeybindingDefinition } from "./keybinding-contract"
import type { TuiAgent } from "./types"
import { ALL_TUI_AGENTS, TUI_AGENT_DISPLAY_NAMES } from "./tui-agent-display-names"
import { platformBindings } from "./keybinding-definition-shared"
import { KEYBINDING_DEFINITION_GROUP_ONE } from "./keybinding-definition-group-one"
import { KEYBINDING_DEFINITION_GROUP_TWO } from "./keybinding-definition-group-two"

export function agentTabActionId(agent: TuiAgent): AgentTabActionId {
  return `tab.newAgent.${agent}`
}

// Why: one bindable action per agent; all ship unassigned since tab.newAgent covers the default, and Settings hides disabled agents.
function buildAgentTabKeybindingDefinitions(): KeybindingDefinition[] {
  return ALL_TUI_AGENTS.map((agent) => ({
    id: agentTabActionId(agent),
    title: `New ${TUI_AGENT_DISPLAY_NAMES[agent]} tab`,
    group: 'Agents',
    scope: 'tabs',
    searchKeywords: [
      'shortcut',
      'tab',
      'agent',
      'new',
      'launch',
      agent,
      TUI_AGENT_DISPLAY_NAMES[agent].toLowerCase()
    ],
    defaultBindings: platformBindings([])
  }))
}


export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  ...KEYBINDING_DEFINITION_GROUP_ONE,
  ...KEYBINDING_DEFINITION_GROUP_TWO,
  ...buildAgentTabKeybindingDefinitions()
]
