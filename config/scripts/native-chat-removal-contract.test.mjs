import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const sourceRoot = resolve(projectRoot, 'src')

function collectProductionFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      return collectProductionFiles(entryPath)
    }
    if (!/\.(?:cjs|mjs|ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) {
      return []
    }
    return [entryPath]
  })
}

const retiredNativeChatTests = [
  'mobile/app/h/[hostId]/session/mobile-session-workspace-terminal-interactions.test.ts',
  'mobile/src/onboarding/MobileOnboardingPage.test.ts',
  'mobile/src/onboarding/mobile-onboarding-plan.test.ts',
  'mobile/src/onboarding/mobile-onboarding-screen.test.ts',
  'mobile/src/session/mobile-terminal-action-sheet-actions.test.ts',
  'mobile/src/storage/preferences.test.ts',
  'src/main/ipc/worktrees.test.ts',
  'src/main/runtime/rpc/methods/agent-session.test.ts',
  'src/main/runtime/rpc/methods/session-tabs.test.ts',
  'src/main/window/attach-main-window-services.test.ts',
  'src/renderer/src/runtime/web-session-tabs-sync.test.ts',
  'src/renderer/src/components/settings/ExperimentalPane.test.tsx',
  'src/renderer/src/components/tab-bar/tab-agent-types-by-tab-id.test.ts',
  'src/renderer/src/components/terminal-pane/TerminalContextMenu.test.tsx',
  'src/renderer/src/hooks/useIpcEvents.test.ts',
  'src/renderer/src/lib/agent-launch-prompt-delivery.test.ts',
  'src/renderer/src/lib/launch-agent-in-new-tab-cwd.test.ts',
  'src/renderer/src/lib/launch-agent-in-new-tab-web-runtime.test.ts',
  'src/renderer/src/lib/launch-agent-in-new-tab-windows-quoting.test.ts',
  'src/renderer/src/lib/worktree-activation.test.ts',
  'src/renderer/src/runtime/sync-runtime-graph.test.ts',
  'src/renderer/src/runtime/web-runtime-session.test.ts',
  'src/renderer/src/store/slices/worktree-removal-maps-leak.test.ts',
  'src/renderer/src/web/web-preload-api.test.ts',
  'src/renderer/src/web/web-runtime-client.test.ts',
  'src/main/persistence.test.ts',
  'src/main/runtime/orca-runtime.test.ts',
  'src/main/runtime/remote-runtime-request-connection.integration.test.ts',
  'src/renderer/src/lib/launch-agent-in-new-tab.test.ts',
  'src/renderer/src/lib/launch-work-item-direct.test.ts',
  'src/renderer/src/components/sidebar/folder-workspace-composer-submit.test.ts'
]

describe('Native Chat removal contract', () => {
  it('removes Native Chat-owned source trees and entry modules', () => {
    for (const relativePath of [
      'src/main/native-chat',
      'src/main/ipc/native-chat.ts',
      'src/main/runtime/rpc/methods/native-chat.ts',
      'src/renderer/src/components/native-chat',
      'src/renderer/src/web/web-preload-native-chat-api.ts',
      'src/shared/native-chat-types.ts',
      'mobile/app/native-chat-settings.tsx',
      'mobile/scripts/mock-server-native-chat-scenario.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('removes Native Chat protocol and UI symbols from production sources', () => {
    const forbiddenSource =
      /registerNativeChatHandlers|NATIVE_CHAT_METHODS|nativeChat:(?:readSession|subscribe|unsubscribe|appended)|NativeChatApi|createNativeChatApi|notifyNativeChatLaunchDraftResolved|nativeChatLaunchDraftResolved|runtime:nativeChatLaunchDraftResolved|experimentalNativeChat|openAgentTabsInChatByDefault|nativeChatSessionOptions|viewMode: ['"]chat['"]|toggleNativeChatForLeaf|toggleTabChatView|NativeChatView|MOCK_NATIVE_CHAT|handleMockNativeChatRequest/

    for (const filePath of collectProductionFiles(sourceRoot)) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(forbiddenSource)
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(
        /native-chat(?:[-/]|$)|nativeChat|NativeChat|NATIVE_CHAT|RuntimeNativeChat|NativeChatLaunchDraft|canToggleNativeChat/
      )
    }

    for (const filePath of collectProductionFiles(resolve(projectRoot, 'mobile'))) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(forbiddenSource)
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(
        /native-chat(?:[-/]|$)|nativeChat|NativeChat|NATIVE_CHAT|RuntimeNativeChat|NativeChatLaunchDraft|canToggleNativeChat/
      )
    }

    for (const entry of readdirSync(resolve(sourceRoot, 'renderer/src/i18n/locales'))) {
      if (entry.endsWith('.json')) {
        expect(
          readFileSync(resolve(sourceRoot, 'renderer/src/i18n/locales', entry), 'utf8'),
          entry
        ).not.toMatch(/nativeChat|NativeChat|native-chat/)
      }
    }
  })

  it('retains generic runtime, agent-hook, and terminal session boundaries', () => {
    for (const relativePath of [
      'src/main/agent-hooks/server.ts',
      'src/main/runtime/rpc/methods/agent-session.ts',
      'src/main/runtime/rpc/methods/session-tabs.ts',
      'src/shared/runtime-session-tabs.ts',
      'src/shared/agent-session-resume.ts',
      'mobile/scripts/mock-server-rpc-handlers.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(true)
    }
  })

  it('does not keep Native Chat fixtures in generic test suites', () => {
    const forbidden =
      /nativeChatLaunchDraftResolved|NativeChatLaunchDraft|launchDraftResolution|registerNativeChatHandlers|nativeChatSessionOptions/
    for (const relativePath of retiredNativeChatTests) {
      expect(readFileSync(resolve(projectRoot, relativePath), 'utf8'), relativePath).not.toMatch(
        forbidden
      )
    }
  })
})
