type ReattachLiveDataSettlement = {
  deliveredChunks: number
  ptyId: string | null
  streamGeneration: number
}

type PtyConnectionReattachLiveDataSettlementControllerArgs = {
  finishLiveDataDeferral: (
    deliver: boolean,
    acceptedGeneration: number
  ) => ReattachLiveDataSettlement | null
  flushTerminalOutput: () => void
  waitForReplayWritesParsed: () => Promise<void>
  isDisposed: () => boolean
  isVisible: () => boolean
  getPtyId: () => string | null
  isGenerationCurrent: (generation: number) => boolean
  enforceScrollIntent: () => void
}

export function createPtyConnectionReattachLiveDataSettlementController({
  finishLiveDataDeferral,
  flushTerminalOutput,
  waitForReplayWritesParsed,
  isDisposed,
  isVisible,
  getPtyId,
  isGenerationCurrent,
  enforceScrollIntent
}: PtyConnectionReattachLiveDataSettlementControllerArgs) {
  return {
    finish(deliver: boolean, acceptedGeneration: number): void {
      const settlement = finishLiveDataDeferral(deliver, acceptedGeneration)
      if (!settlement || settlement.deliveredChunks <= 0) {
        return
      }

      // Why: replay precedes newer live bytes; reapply scroll intent only after those bytes parse and authority is still current.
      flushTerminalOutput()
      void waitForReplayWritesParsed().then(() => {
        if (
          isDisposed() ||
          !isVisible() ||
          getPtyId() !== settlement.ptyId ||
          !isGenerationCurrent(settlement.streamGeneration)
        ) {
          return
        }
        enforceScrollIntent()
      })
    }
  }
}
