import { defineStreamingMethod, type RpcAnyMethod } from '../core'
import { TerminalSubscribe } from './terminal-schemas'
import { handleTerminalSubscribe } from './terminal-subscribe-stream'

export const TERMINAL_SUBSCRIBE_METHODS: RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'terminal.subscribe',
    params: TerminalSubscribe,
    handler: handleTerminalSubscribe
  })
]
