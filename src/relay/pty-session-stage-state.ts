import type * as NodePty from 'node-pty'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { RelayPtySourcePublication } from './relay-pty-source-publication'
import type {
  ManagedPty,
  PendingPtyOutput,
  PtyProcessSummary,
  RelayAgentSessionCreateResult,
  RelayPtyWorktreeRemovalCoordinator,
  SerializedPtyEntry,
  PtyEnvAugmenter,
  PtyExitListener
} from './pty-session-stage-contracts'
import { DEFAULT_GRACE_TIME_MS } from './pty-session-stage-contracts'
import type { RelayPtySourceOutput } from './relay-pty-source-output'
import { ClaimedAgentPtyOwnerRegistry } from '../shared/claimed-agent-pty-owner'

export class PtyHandler {
  protected ptys = new Map<string, ManagedPty>()
  protected nextId = 1
  protected dispatcher: RelayDispatcher
  protected graceTimeMs: number
  protected graceTimer: ReturnType<typeof setTimeout> | null = null
  protected outputFlushTimer: ReturnType<typeof setTimeout> | null = null
  protected pendingOutputByPty = new Map<string, PendingPtyOutput[]>()
  protected pendingExitByPty = new Map<
    string,
    { id: string; code: number; incarnationId: string }
  >()
  protected pausedOutputPtys = new Set<string>()
  protected consumerPausedOutputPtys = new Set<string>()
  protected removeLegacyCapacityListener: (() => void) | null = null
  protected sourcePublication: RelayPtySourcePublication | null = null
  protected lastInputAtByPty = new Map<string, number>()
  protected interactiveOutputCharsByPty = new Map<string, number>()
  protected pendingSpawnCount = 0
  protected pendingReviveIds = new Set<string>()
  protected creationFenced = false
  protected pendingCreationDrainResolvers = new Set<() => void>()
  protected worktreeRemovalCoordinator: RelayPtyWorktreeRemovalCoordinator | null = null
  protected disposePromise: Promise<void> | null = null
  protected ptyModule: typeof NodePty | null = null
  protected ptyModuleLoadPromise: Promise<typeof NodePty | null> | null = null
  protected reloadPtyModuleFromDisk = false
  // Why: single optional slot is intentional — callers compose externally; a throw is swallowed so it can't block cleanup.
  protected exitListener: PtyExitListener | null = null
  // Why: env augmenters run on every spawn so each PTY sees live hook coords without the dispatcher knowing about agent hooks.
  protected envAugmenters: PtyEnvAugmenter[] = []
  protected readonly agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  protected readonly agentSessionCreateOperations = new Map<
    string,
    Promise<RelayAgentSessionCreateResult>
  >()

  constructor(dispatcher: RelayDispatcher, graceTimeMs = DEFAULT_GRACE_TIME_MS) {
    this.dispatcher = dispatcher
    this.graceTimeMs = graceTimeMs
    this.registerHandlers()
    this.removeLegacyCapacityListener =
      this.dispatcher.onLegacyPtyCapacity?.(() => this.handleLegacyCapacity()) ?? null
  }

  // Why: each later stage supplies these hooks; explicit throws keep incomplete intermediate stages observable.
  protected registerHandlers(): void {
    this.unimplementedStageHook('registerHandlers')
  }
  protected handleLegacyCapacity(): void {
    this.unimplementedStageHook('handleLegacyCapacity')
  }
  protected enqueuePtyOutput(
    _id: string,
    _data: string,
    _meta?: { rawLength?: number; transformed?: boolean; seq?: number }
  ): void {
    this.unimplementedStageHook('enqueuePtyOutput')
  }
  protected flushPtyOutput(_id: string, _capturedQueue?: PendingPtyOutput[]): boolean {
    return this.unimplementedStageHook('flushPtyOutput')
  }
  protected publishPendingExit(_id: string): void {
    this.unimplementedStageHook('publishPendingExit')
  }
  protected clearPtyInputState(_id: string): void {
    this.unimplementedStageHook('clearPtyInputState')
  }
  protected pendingProducerBytes(_id: string): number {
    return this.unimplementedStageHook('pendingProducerBytes')
  }
  protected pausePtyOutput(_id: string): void {
    this.unimplementedStageHook('pausePtyOutput')
  }
  protected maybeResumePtyOutput(_id: string): void {
    this.unimplementedStageHook('maybeResumePtyOutput')
  }
  protected scheduleOutputFlush(_delayMs: number): void {
    this.unimplementedStageHook('scheduleOutputFlush')
  }
  protected clearOutputFlushTimerIfIdle(): void {
    this.unimplementedStageHook('clearOutputFlushTimerIfIdle')
  }
  protected publishPtyOutput(
    id: string,
    output: RelayPtySourceOutput,
    interactive: boolean
  ): boolean {
    return this.unimplementedStageHook(
      `publishPtyOutput:${id}:${interactive}:${output.data.length}`
    )
  }
  protected spawn(params: Record<string, unknown>, context?: RequestContext): Promise<unknown> {
    return this.unimplementedStageHook(
      `spawn:${Object.keys(params).length}:${context !== undefined}`
    )
  }
  protected attach(params: Record<string, unknown>, context?: RequestContext): Promise<unknown> {
    return this.unimplementedStageHook(
      `attach:${Object.keys(params).length}:${context !== undefined}`
    )
  }
  protected shutdown(_params: Record<string, unknown>): Promise<void> {
    return this.unimplementedStageHook('shutdown')
  }
  protected sendSignal(_params: Record<string, unknown>): Promise<void> {
    return this.unimplementedStageHook('sendSignal')
  }
  protected getCwd(_params: Record<string, unknown>): Promise<string> {
    return this.unimplementedStageHook('getCwd')
  }
  protected getInitialCwd(_params: Record<string, unknown>): Promise<string> {
    return this.unimplementedStageHook('getInitialCwd')
  }
  protected getSize(
    params: Record<string, unknown>
  ): Promise<{ cols: number; rows: number } | null> {
    return this.unimplementedStageHook(`getSize:${Object.keys(params).length}`)
  }
  protected resizeIfCurrent(params: Record<string, unknown>): Promise<{ applied: boolean }> {
    return this.unimplementedStageHook(`resizeIfCurrent:${Object.keys(params).length}`)
  }
  protected clearBuffer(_params: Record<string, unknown>): Promise<void> {
    return this.unimplementedStageHook('clearBuffer')
  }
  protected hasChildProcesses(_params: Record<string, unknown>): Promise<boolean> {
    return this.unimplementedStageHook('hasChildProcesses')
  }
  protected getForegroundProcess(params: Record<string, unknown>): Promise<string | null> {
    return this.unimplementedStageHook(`getForegroundProcess:${Object.keys(params).length}`)
  }
  protected inspectProcess(_params: Record<string, unknown>): Promise<{
    foregroundProcess: string | null
    hasChildProcesses: boolean
  }> {
    return this.unimplementedStageHook('inspectProcess')
  }
  protected listProcesses(): Promise<PtyProcessSummary[]> {
    return this.unimplementedStageHook('listProcesses')
  }
  protected serialize(_params: Record<string, unknown>): Promise<string> {
    return this.unimplementedStageHook('serialize')
  }
  protected revive(_params: Record<string, unknown>): Promise<void> {
    return this.unimplementedStageHook('revive')
  }
  protected writeData(_params: Record<string, unknown>): void {
    this.unimplementedStageHook('writeData')
  }
  protected resize(_params: Record<string, unknown>): void {
    this.unimplementedStageHook('resize')
  }
  protected requestGracefulKill(
    managed: ManagedPty,
    fallbackAction: 'terminate stale' | 'force-kill'
  ): void {
    this.unimplementedStageHook(`requestGracefulKill:${managed.id}:${fallbackAction}`)
  }
  protected reviveEntry(entry: SerializedPtyEntry): Promise<void> {
    return this.unimplementedStageHook(`reviveEntry:${entry.id}`)
  }

  private unimplementedStageHook(name: string): never {
    throw new Error(`PTY handler stage hook is not implemented: ${name}`)
  }
}
