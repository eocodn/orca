import { useEffect, useRef } from 'react'
import { startRuntimeCapabilityProbe } from '../../../../src/transport/runtime-capability-probe'
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
      setQuickCommandsSupported(null)
      setShowQuickCommands(false)
      hostQueryReplyInputSupportedRef.current = false
      return
    }
    setBrowserScreencastSupported(null)
    setQuickCommandsSupported(null)
    setShowQuickCommands(false)
    hostQueryReplyInputSupportedRef.current = false
    return startRuntimeCapabilityProbe(client, (capabilities) => {
      setBrowserScreencastSupported(capabilities.includes('browser.screencast.v1'))
      setQuickCommandsSupported(supportsMobileQuickCommands(capabilities))
      hostQueryReplyInputSupportedRef.current = capabilities.includes(
        TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY
      )
    })
  }, [client, connState])

  return { hostQueryReplyInputSupportedRef }
}
