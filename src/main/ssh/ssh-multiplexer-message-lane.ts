import type { JsonRpcMessage } from './relay-protocol'
import type { MultiplexerWriterLane } from './ssh-multiplexer-transport-writer'

export function messageLane(msg: JsonRpcMessage): MultiplexerWriterLane {
  return 'method' in msg && msg.method === 'pty.data' ? 'ordinary' : 'control'
}
