import {
  INITIAL_MODE_2031_REPLY_SCAN_STATE,
  scanMode2031ReplyDecision,
  type Mode2031ReplyDecision
} from '../../../../shared/terminal-color-scheme-protocol'

export function createPtyConnectionMode2031ReplyScanController() {
  let state = INITIAL_MODE_2031_REPLY_SCAN_STATE

  return {
    scan(data: string): Mode2031ReplyDecision {
      const result = scanMode2031ReplyDecision(state, data)
      state = result.state
      return result.decision
    },
    reset(): void {
      state = INITIAL_MODE_2031_REPLY_SCAN_STATE
    }
  }
}
