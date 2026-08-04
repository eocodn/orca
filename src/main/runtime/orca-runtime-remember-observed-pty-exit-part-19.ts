import type { TerminalOutputSourceRange, PtyIncarnationId, RuntimePtyDataAdmission } from './orca-runtime-symbols'
import { OrcaRuntimeResolveRuntimeGitTargetPart18 } from './orca-runtime-resolve-runtime-git-target-part-18'

export class OrcaRuntimeRememberObservedPtyExitPart19 extends OrcaRuntimeResolveRuntimeGitTargetPart18 {
  protected rememberObservedPtyExit(ptyId: string, incarnationId: PtyIncarnationId): void {
    const observed = this.observedPtyExitIncarnations.get(ptyId)
    if (observed) {
      if (observed.size >= 128 && !observed.has(incarnationId)) {
        // Why: a mounted PTY id can be reused forever; retain a bounded exact-proof window and let provider liveness prove older cleanup tombstones.
        const oldest = observed.values().next().value
        if (oldest !== undefined) {
          observed.delete(oldest)
        }
      }
      observed.add(incarnationId)
      return
    }
    this.observedPtyExitIncarnations.set(ptyId, new Set([incarnationId]))
  }
  protected assertPtyDidNotExitBeforeRegistration(
    ptyId: string,
    candidateIncarnation?: PtyIncarnationId
  ): void {
    if (this.earlyExitedPtyIncarnations.has(ptyId)) {
      const exitedIncarnation = this.earlyExitedPtyIncarnations.get(ptyId) ?? null
      const nextIncarnation = candidateIncarnation ?? null
      if (
        exitedIncarnation === null ||
        nextIncarnation === null ||
        exitedIncarnation === nextIncarnation
      ) {
        throw new Error('agent_session_exited_during_start')
      }
      this.earlyExitedPtyIncarnations.delete(ptyId)
    }
  }
  preparePtyExecutionContext(
    ptyId: string,
    wslDistro: string | null,
    options: { resetIncarnation?: boolean; preserveExisting?: boolean } = {}
  ): boolean {
    const pty = this.ptysById.get(ptyId)
    const hadExistingContext = this.wslDistroByPtyId.has(ptyId) || pty !== undefined
    if (options.preserveExisting && hadExistingContext) {
      // Why: attach-time settings are only a fallback; a live PTY's recorded
      // execution namespace remains authoritative until its provider replies.
      return false
    }

    if (options.resetIncarnation) {
      // Why: an explicit new lifecycle supersedes an unidentifiable exit from the reused PTY id.
      this.earlyExitedPtyIncarnations.delete(ptyId)
      this.disposeHeadlessTerminal(ptyId)
      this.osc7ScanTailByPtyId.delete(ptyId)
      this.terminalCwdByPtyId.delete(ptyId)
      this.terminalFileUriHostnameByPtyId.delete(ptyId)
      this.wslDistroByPtyId.delete(ptyId)
    }

    const previous = this.wslDistroByPtyId.get(ptyId) ?? null
    if (wslDistro) {
      this.wslDistroByPtyId.set(ptyId, wslDistro)
    } else {
      this.wslDistroByPtyId.delete(ptyId)
    }
    if (pty) {
      pty.wslDistro = wslDistro
    }
    if (!options.resetIncarnation && previous !== wslDistro && this.headlessTerminals.has(ptyId)) {
      // Why: bytes parsed with two distro namespaces would leave an internally
      // inconsistent CWD; rebuild from the provider's authoritative snapshot.
      this.terminalCwdByPtyId.delete(ptyId)
      this.replaceHeadlessTerminalAfterExecutionContextChange(ptyId)
    }
    return options.resetIncarnation === true || !hadExistingContext || previous !== wslDistro
  }

  /** Record the spawn launch command so the per-PTY Command Code detector can
   *  arm from it (renderer startupCommand parity). Best-effort: a chunk that
   *  beats this call falls back to the detector's banner arming. */
  noteTerminalSpawnCommand(ptyId: string, command: string | null | undefined): void {
    const trimmed = typeof command === 'string' ? command.trim() : ''
    if (trimmed.length > 0) {
      this.terminalSpawnCommandsByPtyId.set(ptyId, trimmed)
    }
  }
  resetPtyModelAfterMigrationFailure(ptyId: string): void {
    this.providerSnapshotPreferredPtys.add(ptyId)
    this.disposeHeadlessTerminal(ptyId)
  }
  quarantinePtyAfterPublicationFailure(ptyId: string, incarnationId?: PtyIncarnationId): void {
    const pty = this.ptysById.get(ptyId)
    if (pty && incarnationId && pty.incarnationId && pty.incarnationId !== incarnationId) {
      return
    }
    this.invalidateAllHandlesForPty(ptyId)
    this.rendererGraphLivenessBlockedPtys.add(ptyId)
    this.disposeHeadlessTerminal(ptyId)
    if (pty?.connected) {
      this.markPtyDisconnected(pty)
    }
  }

  /**
   * Handles incoming data from a PTY process, running agent detection,
   * updating terminal tail buffers, and triggering foreground agent refreshes.
   */
  acceptPtyDataBounded(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars = data.length,
    transformed = false,
    sourceRanges: readonly TerminalOutputSourceRange[] | undefined,
    incarnationId: PtyIncarnationId
  ): RuntimePtyDataAdmission {
    let completion: Promise<void> | null = null
    let admitted = false
    const sequence = this.onPtyData(
      ptyId,
      data,
      at,
      sequenceChars,
      transformed,
      (receipt) => {
        completion = receipt
      },
      sourceRanges,
      (value) => {
        admitted = value
      },
      incarnationId
    )
    if (!completion) {
      throw new Error('PTY model admission receipt was not captured')
    }
    return Object.freeze({ admitted, sequence, completion })
  }
  acceptsPtyDataForCurrentLifecycle(ptyId: string): boolean {
    if (this.earlyExitedPtyIncarnations.has(ptyId)) {
      return false
    }
    if (this.pendingPtyRegistrationIncarnations.has(ptyId)) {
      return true
    }
    const pty = this.ptysById.get(ptyId)
    return pty ? pty.connected : true
  }
  protected acceptsPtyDataForIncarnation(ptyId: string, incarnationId: PtyIncarnationId): boolean {
    if (this.earlyExitedPtyIncarnations.has(ptyId)) {
      return false
    }
    const pty = this.ptysById.get(ptyId)
    if (this.pendingPtyRegistrationIncarnations.has(ptyId)) {
      const pending = this.pendingPtyRegistrationIncarnations.get(ptyId) ?? null
      if (pending === incarnationId) {
        return true
      }
      if (pending === null && pty?.incarnationId !== incarnationId) {
        // Why: byte zero can prove the pending physical owner before spawn resolves.
        this.pendingPtyRegistrationIncarnations.set(ptyId, incarnationId)
        return true
      }
      return false
    }
    if (this.headlessPtyIncarnationById.get(ptyId) === incarnationId) {
      return true
    }
    return Boolean(pty?.connected && pty.incarnationId === incarnationId)
  }
}
