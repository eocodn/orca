import { describe, expect, it } from 'vitest'
import {
  ClaudeSwitcherMenu,
  CodexSwitcherMenu,
  InlineUsageBars,
  ProviderDetailsMenu,
  ProviderSegment
} from './StatusBar'
import {
  ClaudeSwitcherMenu as splitClaudeSwitcherMenu,
  CodexSwitcherMenu as splitCodexSwitcherMenu,
  InlineUsageBars as splitInlineUsageBars,
  ProviderDetailsMenu as splitProviderDetailsMenu,
  ProviderSegment as splitProviderSegment
} from './status-bar-provider-menus'

describe('StatusBar facade exports', () => {
  it('preserves the legacy provider menu named exports', () => {
    expect({
      ClaudeSwitcherMenu,
      CodexSwitcherMenu,
      InlineUsageBars,
      ProviderDetailsMenu,
      ProviderSegment
    }).toEqual({
      ClaudeSwitcherMenu: splitClaudeSwitcherMenu,
      CodexSwitcherMenu: splitCodexSwitcherMenu,
      InlineUsageBars: splitInlineUsageBars,
      ProviderDetailsMenu: splitProviderDetailsMenu,
      ProviderSegment: splitProviderSegment
    })
  })
})
