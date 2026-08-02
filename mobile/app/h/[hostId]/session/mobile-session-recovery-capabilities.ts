import { useEffect, useRef } from 'react'
import { startRuntimeCapabilityProbe } from '../../../../src/transport/runtime-capability-probe'
import { MOBILE_AI_VAULT_CAPABILITY } from '../../../../src/agent-history/agent-history-capability'
import { supportsMobileQuickCommands } from '../../../../src/terminal/quick-commands'
import { TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY } from '../../../../../src/shared/protocol-version'

type SessionRecoveryContext = Record<string, any>

export function useMobileSessionRecoveryCapabilities(context: SessionRecoveryContext) {
  const {
    client,
    connState,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    setBrowserScreencastSupported,
    setAgentSessionHistorySupported,
    setQuickCommandsSupported,
    setShowQuickCommands
  } = context
  const hostQueryReplyInputSupportedRef = useRef(false)

  useEffect(() => {
    if (connState === 'connected') {
      return
    }
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) clearTimeout(queued.timer)
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
  }, [connState])

  useEffect(() => {
    if (!client || connState !== 'connected') {
      setBrowserScreencastSupported(null)
      setAgentSessionHistorySupported(null)
      setQuickCommandsSupported(null)
      setShowQuickCommands(false)
      hostQueryReplyInputSupportedRef.current = false
      return
    }
    setBrowserScreencastSupported(null)
    setAgentSessionHistorySupported(null)
    setQuickCommandsSupported(null)
    setShowQuickCommands(false)
    hostQueryReplyInputSupportedRef.current = false
    return startRuntimeCapabilityProbe(client, (capabilities) => {
      setBrowserScreencastSupported(capabilities.includes('browser.screencast.v1'))
      setAgentSessionHistorySupported(capabilities.includes(MOBILE_AI_VAULT_CAPABILITY))
      setQuickCommandsSupported(supportsMobileQuickCommands(capabilities))
      hostQueryReplyInputSupportedRef.current = capabilities.includes(
        TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY
      )
    })
  }, [client, connState])

  return { hostQueryReplyInputSupportedRef }
}
