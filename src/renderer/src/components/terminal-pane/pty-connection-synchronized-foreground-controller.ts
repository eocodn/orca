import { FOREGROUND_SYNCHRONIZED_FRAME_INTERACTIVE_WINDOW_MS } from './pty-connection-runtime-state'
import {
  containsCursorRestore,
  containsSynchronizedOutputEnd,
  containsSynchronizedOutputStart,
  shouldSynchronizedOutputRemainActive
} from './pty-connection-routing-policy'

type PtyConnectionSynchronizedForegroundControllerArgs = {
  protectedOutput: boolean
  now: () => number
  getLastTerminalInputAt: () => number
}

export function createPtyConnectionSynchronizedForegroundController({
  protectedOutput,
  now,
  getLastTerminalInputAt
}: PtyConnectionSynchronizedForegroundControllerArgs) {
  let active = false
  // Why: a split close inherits whether the frame was interactive when it opened.
  let interactive = false

  return {
    observe(data: string, foreground: boolean) {
      const protectedForeground = protectedOutput && foreground
      const started = protectedForeground && containsSynchronizedOutputStart(data)
      const ended = protectedForeground && containsSynchronizedOutputEnd(data)
      const synchronizedOutput = protectedForeground && (active || started || ended)
      const nextActive = protectedForeground && shouldSynchronizedOutputRemainActive(data, active)
      const nativeWindowsCursorRestore = protectedForeground && containsCursorRestore(data)

      // Why: same-chunk close+open must classify the new frame from its own open time.
      if (synchronizedOutput && started) {
        interactive =
          now() - getLastTerminalInputAt() <= FOREGROUND_SYNCHRONIZED_FRAME_INTERACTIVE_WINDOW_MS
      } else if (!nextActive && !ended) {
        interactive = false
      }

      const latencySensitive = synchronizedOutput && interactive
      active = nextActive

      return {
        synchronizedOutput,
        latencySensitive,
        nativeWindowsCursorRestore,
        stripTransientCursorShows: protectedForeground,
        coalesceForeground: synchronizedOutput && ended,
        holdForeground: synchronizedOutput && nextActive
      }
    }
  }
}
