import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('PTY connection owner boundaries', () => {
  it('routes deferred SSH saved-session composition through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { runPtyConnectionSshDeferredSession } from './pty-connection-ssh-deferred-session-controller'"
    )
    expect(orchestrator).not.toContain('runPtyConnectionDeferredSshConnect({')
    expect(orchestrator).not.toContain('runPtyConnectionSshConnectSettlement({')
    expect(orchestrator).not.toContain('runPtyConnectionSavedSshReattach({')
    expect(controller).toContain('export function runPtyConnectionSshDeferredSession(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes SSH deferred-connect entry policy through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const route = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-route.ts'
    )

    expect(orchestrator).toContain(
      "import { runPtyConnectionSshDeferredRoute } from './pty-connection-ssh-deferred-route'"
    )
    expect(orchestrator).not.toContain('const gate = resolveSshPaneConnectGate({')
    expect(orchestrator).not.toContain('if (gate.enterDeferredFlow &&')
    expect(route).toContain('export function runPtyConnectionSshDeferredRoute(')
    expect(route.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes deferred SSH connect composition through its concrete controller', () => {
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-deferred-ssh-connect-controller.ts'
    )

    expect(composition).toContain(
      "import { runPtyConnectionDeferredSshConnect } from './pty-connection-deferred-ssh-connect-controller'"
    )
    expect(composition).not.toContain(
      'const promptAdmission = await runPtyConnectionSshPromptAdmission('
    )
    expect(controller).toContain('export async function runPtyConnectionDeferredSshConnect(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes shared SSH connection settlement through its concrete controller', () => {
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-connect-settlement-controller.ts'
    )

    expect(composition).toContain(
      "import { runPtyConnectionSshConnectSettlement } from './pty-connection-ssh-connect-settlement-controller'"
    )
    expect(composition).not.toContain('const connectResult = await waitForSshConnection(')
    expect(controller).toContain('export async function runPtyConnectionSshConnectSettlement(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes SSH prompt admission through its concrete controller', () => {
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-prompt-admission-controller.ts'
    )

    expect(composition).toContain(
      "import { runPtyConnectionSshPromptAdmission } from './pty-connection-ssh-prompt-admission-controller'"
    )
    expect(composition).not.toContain('let needsPrompt = false')
    expect(controller).toContain('export async function runPtyConnectionSshPromptAdmission(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes user-initiated SSH connect waiting through its concrete controller', () => {
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-prompt-wait-controller.ts'
    )

    expect(composition).toContain(
      "import { waitForUserInitiatedSshConnect } from './pty-connection-ssh-prompt-wait-controller'"
    )
    expect(composition).not.toContain(
      'const outcome = await new Promise<UserInitiatedSshConnectOutcome>'
    )
    expect(controller).toContain('export function waitForUserInitiatedSshConnect(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes general deferred reattach through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-session.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-deferred-reattach-controller.ts'
    )

    expect(session).toContain(
      "import { runPtyConnectionDeferredReattach } from './pty-connection-deferred-reattach-controller'"
    )
    expect(orchestrator).not.toContain(
      'allowInitialIdleCacheSeed = true\n      recordPtyConnectDiagnostic(`pane=${pane.id} -> REATTACH'
    )
    expect(controller).toContain('export function runPtyConnectionDeferredReattach(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes saved SSH session reattach through its concrete controller', () => {
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-saved-ssh-reattach-controller.ts'
    )

    expect(composition).toContain(
      "import { runPtyConnectionSavedSshReattach } from './pty-connection-saved-ssh-reattach-controller'"
    )
    expect(composition).not.toContain(
      'if (pendingSessionId) {\n            if (isLegacyWorkerAutomaticResumeBlocked())'
    )
    expect(controller).toContain('export function runPtyConnectionSavedSshReattach(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes reattach failure fallback through its concrete controller', () => {
    const restoredSession = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-session.ts'
    )
    const restoredComposition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-fallback.ts'
    )
    const composition = read(
      'src/renderer/src/components/terminal-pane/pty-connection-ssh-deferred-session-controller.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-reattach-fallback-controller.ts'
    )
    const fallbackUsers = `${restoredComposition}\n${composition}`

    expect(fallbackUsers).toContain(
      "import { createPtyConnectionReattachFallbackController } from './pty-connection-reattach-fallback-controller'"
    )
    expect(fallbackUsers.match(/createPtyConnectionReattachFallbackController\(\{/g)).toHaveLength(
      2
    )
    expect(composition).toContain('runPtyConnectionSavedSshReattach({')
    expect(restoredSession).toContain('runPtyConnectionDeferredReattach({')
    expect(controller).toContain('export function createPtyConnectionReattachFallbackController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes restored-session fallback policy through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const normalSession = read(
      'src/renderer/src/components/terminal-pane/pty-connection-normal-route-session.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-session.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-fallback.ts'
    )

    expect(normalSession).toContain('runPtyConnectionRestoredReattachSession')
    expect(normalSession).toContain("from './pty-connection-restored-reattach-session'")
    expect(orchestrator).not.toContain(
      "import { createPtyConnectionRestoredReattachFallback } from './pty-connection-restored-reattach-fallback'"
    )
    expect(session).toContain(
      "import { createPtyConnectionRestoredReattachFallback } from './pty-connection-restored-reattach-fallback'"
    )
    expect(orchestrator).not.toContain('createPtyConnectionReattachFallbackController({')
    expect(owner).toContain('export function createPtyConnectionRestoredReattachFallback(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes restored reattach composition through its concrete session owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const normalSession = read(
      'src/renderer/src/components/terminal-pane/pty-connection-normal-route-session.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-restored-reattach-session.ts'
    )

    expect(normalSession).toContain('runPtyConnectionRestoredReattachSession')
    expect(normalSession).toContain("from './pty-connection-restored-reattach-session'")
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionDeferredReattach } from './pty-connection-deferred-reattach-controller'"
    )
    expect(orchestrator).not.toContain('createFallbackHandlers: (sessionId, coldRestoreStartup) =>')
    expect(session).toContain(
      "import { runPtyConnectionDeferredReattach } from './pty-connection-deferred-reattach-controller'"
    )
    expect(session).toContain('export function runPtyConnectionRestoredReattachSession(')
    expect(session.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes non-reattach attach and spawn decisions through its concrete owner', () => {
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-spawn-session.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-spawn-route.ts'
    )

    expect(session).toContain(
      "import { runPtyConnectionAttachSpawnRoute } from './pty-connection-attach-spawn-route'"
    )
    expect(session).not.toContain('} else if (attachPtyId) {')
    expect(owner).toContain('export function runPtyConnectionAttachSpawnRoute(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes attach/spawn and pending adoption composition through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const normalSession = read(
      'src/renderer/src/components/terminal-pane/pty-connection-normal-route-session.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-spawn-session.ts'
    )

    expect(normalSession).toContain('runPtyConnectionAttachSpawnSession')
    expect(normalSession).toContain("from './pty-connection-attach-spawn-session'")
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionAttachSpawnRoute } from './pty-connection-attach-spawn-route'"
    )
    expect(orchestrator).not.toContain(
      "import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'"
    )
    expect(session).toContain(
      "import { runPtyConnectionAttachSpawnRoute } from './pty-connection-attach-spawn-route'"
    )
    expect(session).toContain(
      "import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'"
    )
    expect(session).toContain('export function runPtyConnectionAttachSpawnSession(')
    expect(session.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes normal PTY session execution through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-normal-route-session.ts'
    )

    expect(orchestrator).toContain(
      "import { runPtyConnectionNormalRouteSession } from './pty-connection-normal-route-session'"
    )
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionFreshOrColdRestore } from './pty-connection-fresh-or-cold-restore'"
    )
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionRestoredReattachSession } from './pty-connection-restored-reattach-session'"
    )
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionAttachSpawnSession } from './pty-connection-attach-spawn-session'"
    )
    expect(orchestrator).not.toContain('if (deferredReattachSessionId) {')
    expect(session).toContain(
      "import { runPtyConnectionFreshOrColdRestore } from './pty-connection-fresh-or-cold-restore'"
    )
    expect(session).toContain('runPtyConnectionRestoredReattachSession')
    expect(session).toContain("from './pty-connection-restored-reattach-session'")
    expect(session).toContain('runPtyConnectionAttachSpawnSession')
    expect(session).toContain("from './pty-connection-attach-spawn-session'")
    expect(session).toContain('export function runPtyConnectionNormalRouteSession(')
    expect(session.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-vs-cold restore selection through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-normal-route-session.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-fresh-or-cold-restore.ts'
    )

    expect(session).toContain(
      "import { runPtyConnectionFreshOrColdRestore } from './pty-connection-fresh-or-cold-restore'"
    )
    expect(orchestrator).not.toContain(
      'if (sleptRemoteColdRestoreStartup || hasSleepingAgentSession) {'
    )
    expect(owner).toContain('export function runPtyConnectionFreshOrColdRestore(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-shell restored viewport preparation through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-fresh-shell-viewport.ts'
    )

    expect(orchestrator).toContain(
      "import { preparePtyConnectionFreshShellViewport } from './pty-connection-fresh-shell-viewport'"
    )
    expect(orchestrator).not.toContain('const consumeRestoredViewportBlankingMarker =')
    expect(orchestrator).not.toContain('const writeFreshShellViewportBlanking =')
    expect(owner).toContain('export function preparePtyConnectionFreshShellViewport(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-spawn preflight through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const preflight = read(
      'src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-preflight.ts'
    )

    expect(orchestrator).toContain(
      "import { runPtyConnectionFreshSpawnPreflight } from './pty-connection-fresh-spawn-preflight'"
    )
    const startFreshSpawn = orchestrator.slice(
      orchestrator.indexOf('const startFreshSpawn ='),
      orchestrator.indexOf("let foregroundRefreshRiskScanTail = ''")
    )
    expect(startFreshSpawn).not.toContain('if (isLegacyWorkerAutomaticResumeBlocked()) {')
    expect(startFreshSpawn).not.toContain(
      'clearPaneMode2031State()\n      clearHiddenOutputRestoreState()'
    )
    expect(startFreshSpawn).not.toContain('if (connectionId && startupOverride?.command) {')
    expect(preflight).toContain('export function runPtyConnectionFreshSpawnPreflight(')
    expect(preflight.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-spawn connect and result settlement through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionFreshSpawnController } from './pty-connection-fresh-spawn-controller'"
    )
    expect(orchestrator).not.toContain('const spawnedRaw = transport.connect(')
    expect(orchestrator).not.toContain('const processedSpawnPromise:')
    expect(controller).toContain('export function createPtyConnectionFreshSpawnController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-spawn registry settlement through its concrete tracker', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const tracker = read(
      'src/renderer/src/components/terminal-pane/pty-connection-spawn-tracker.ts'
    )

    expect(orchestrator).toContain(
      "import { trackPtyConnectionSpawn } from './pty-connection-spawn-tracker'"
    )
    expect(orchestrator).not.toContain('pendingSpawnByPaneKey.set(')
    expect(orchestrator).not.toContain('pendingSpawnByPaneKey.delete(')
    expect(tracker).toContain('export function trackPtyConnectionSpawn(')
    expect(tracker.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes pending-spawn adoption through its concrete controller', () => {
    const session = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-spawn-session.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-pending-spawn-controller.ts'
    )

    expect(session).toContain(
      "import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'"
    )
    expect(session).not.toContain('const pendingSpawn = pendingSpawnByPaneKey.get(')
    expect(controller).toContain('export function createPtyConnectionPendingSpawnController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes restored PTY candidate selection through its concrete resolver', () => {
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-route-observation.ts'
    )
    const resolver = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-candidate.ts'
    )

    expect(owner).toContain(
      "import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'"
    )
    expect(owner).not.toContain('const candidateReattachSessionId =')
    expect(owner).not.toContain('const candidateHasEagerBuffer =')
    expect(resolver).toContain('export function resolvePtyConnectionAttachCandidate(')
    expect(resolver.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes attach-route observation and cleanup through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-route-observation.ts'
    )

    expect(orchestrator).toContain(
      "import { preparePtyConnectionAttachRouteObservation } from './pty-connection-attach-route-observation'"
    )
    expect(orchestrator).not.toContain('const existingPtyClaimedBySibling = Boolean(')
    expect(orchestrator).not.toContain(
      'if (sleptRemoteRuntimeSessionId) {\n      deps.syncPanePtyLayoutBinding(pane.id, null)'
    )
    expect(owner).toContain('export function preparePtyConnectionAttachRouteObservation(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY attach execution through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionAttachController } from './pty-connection-attach-controller'"
    )
    expect(orchestrator).not.toContain('transport.attach({')
    expect(orchestrator).not.toContain('const attachRetainedLegacyPty =')
    expect(controller).toContain('export function createPtyConnectionAttachController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY reattach attempt lifecycle through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-reattach-attempt-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionReattachAttemptController } from './pty-connection-reattach-attempt-controller'"
    )
    expect(orchestrator).not.toContain('let expiredReattachError = false')
    expect(orchestrator).not.toContain('const trackedReattachPromise =')
    expect(controller).toContain('export function createPtyConnectionReattachAttemptController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes deferred startup grid scheduling through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-startup-grid-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionStartupGridController } from './pty-connection-startup-grid-controller'"
    )
    expect(orchestrator).not.toContain('let startupGridSettleHandle:')
    expect(orchestrator).not.toContain('const runDeferredConnect =')
    expect(controller).toContain('export function createPtyConnectionStartupGridController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY session liveness reconciliation through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-liveness-reconcile-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSessionLivenessReconcileController } from './pty-connection-session-liveness-reconcile-controller'"
    )
    expect(orchestrator).not.toContain('const reconcileIfSessionDead =')
    expect(orchestrator).not.toContain('const reconcileIfSessionMissing =')
    expect(controller).toContain(
      'export function createPtyConnectionSessionLivenessReconcileController('
    )
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY size reassertion through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-size-reassertion-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSizeReassertionController } from './pty-connection-size-reassertion-controller'"
    )
    expect(orchestrator).not.toContain('const ptySizeReassertion =')
    expect(orchestrator).not.toContain('const scheduleForegroundGridDriftCheck =')
    expect(controller).toContain('export function createPtyConnectionSizeReassertionController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes post-spawn PTY size convergence through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-spawn-size-reconcile-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSpawnSizeReconcileController } from './pty-connection-spawn-size-reconcile-controller'"
    )
    expect(orchestrator).not.toContain('let ptySizeReconcileHandle:')
    expect(orchestrator).not.toContain('const reconcilePtySizeAfterSpawn =')
    expect(controller).toContain('export function createPtyConnectionSpawnSizeReconcileController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes observed pane geometry through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-pane-geometry-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionPaneGeometryController } from './pty-connection-pane-geometry-controller'"
    )
    expect(orchestrator).not.toContain('const handleObservedPaneGeometry =')
    expect(orchestrator).not.toContain('const geometryReportObserver =')
    expect(controller).toContain('export function createPtyConnectionPaneGeometryController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY resize forwarding through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-resize-forwarding-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionResizeForwardingController } from './pty-connection-resize-forwarding-controller'"
    )
    expect(orchestrator).not.toContain('const forwardPtyResize =')
    expect(orchestrator).not.toContain('const onHeldPtyResizeFlush =')
    expect(controller).toContain('export function createPtyConnectionResizeForwardingController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes remote viewport claim state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-remote-viewport-claim-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionRemoteViewportClaimController } from './pty-connection-remote-viewport-claim-controller'"
    )
    expect(orchestrator).not.toContain('let visibleRemoteViewportClaimPtyId: string | null = null')
    expect(orchestrator).not.toContain('const claimViewportForUserActivity =')
    expect(controller).toContain(
      'export function createPtyConnectionRemoteViewportClaimController('
    )
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY exit lifecycle through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-exit-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionExitController } from './pty-connection-exit-controller'"
    )
    expect(orchestrator).not.toContain('const onExit = (ptyId: string')
    expect(orchestrator).not.toContain('let handledExitPtyId: string | null = null')
    expect(controller).toContain('export function createPtyConnectionExitController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes agent notification timing through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-agent-notification-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionAgentNotificationController } from './pty-connection-agent-notification-controller'"
    )
    expect(orchestrator).not.toContain('const scheduleAgentTaskCompleteNotification =')
    expect(orchestrator).not.toContain('let pendingTerminalBellNotification =')
    expect(controller).toContain('export function createPtyConnectionAgentNotificationController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })
})
