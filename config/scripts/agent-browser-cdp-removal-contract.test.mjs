import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const read = (relativePath) => readFileSync(resolve(projectRoot, relativePath), 'utf8')

describe('agent-browser/CDP automation removal contract', () => {
  it('removes the agent-browser automation bridge', () => {
    for (const relativePath of [
      'src/main/browser/agent-browser-bridge.ts',
      'src/main/browser/agent-browser-command-bridge.ts',
      'src/main/browser/cdp-bridge.ts',
      'src/main/browser/cdp-ws-proxy.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('removes package and packaging references', () => {
    expect(read('package.json')).not.toMatch(/agent-browser/)
    expect(read('pnpm-lock.yaml')).not.toMatch(/agent-browser@/)
    expect(read('config/electron-builder.config.cjs')).not.toMatch(/agent-browser/)
    expect(existsSync(resolve(projectRoot, 'config/scripts/terminal-e2e-helpers.mjs'))).toBe(false)
  })

  it('keeps the embedded BrowserPane and navigation services', () => {
    expect(
      existsSync(resolve(projectRoot, 'src/renderer/src/components/browser-pane/BrowserPane.tsx'))
    ).toBe(true)
    expect(existsSync(resolve(projectRoot, 'src/main/browser/browser-manager.ts'))).toBe(true)
    expect(existsSync(resolve(projectRoot, 'src/main/ports/advertised-url-watcher.ts'))).toBe(true)
  })

  it('retains BrowserPane runtime navigation contracts', () => {
    const pane = read('src/renderer/src/components/browser-pane/BrowserPane.tsx')
    const rpcMethods = read('src/main/runtime/rpc/methods/index.ts')
    expect(rpcMethods).toContain('BROWSER_CORE_METHODS')
    expect(rpcMethods).toContain('BROWSER_EXTRA_METHODS')
    expect(rpcMethods).toContain('BROWSER_SCREENCAST_METHODS')
    for (const method of [
      'browser.tabCreate',
      'browser.tabClose',
      'browser.goto',
      'browser.screencast'
    ]) {
      expect(pane).toContain(method)
    }
  })

  it('routes retained runtime browser input through BrowserManager pages', () => {
    expect(existsSync(resolve(projectRoot, 'src/main/browser/browser-page-runtime.ts'))).toBe(true)
    const runtime = read('src/main/runtime/orca-runtime-browser-screencast-part-87.ts')
    expect(runtime).not.toMatch(/agent-browser|cdp-bridge|browserCommands|AgentBrowserBridge/)
    expect(runtime).toContain('BrowserPageRuntime')
  })
})
